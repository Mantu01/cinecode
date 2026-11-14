import { createHash, createHmac, createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { toArrayBuffer, type MediaProbe, type MediaResolver, type ResolveContext } from "../resolver-types.js";

interface CloudTarget {
  readonly scheme: "s3" | "gs";
  readonly bucket: string;
  readonly key: string;
}

function parseCloudUri(uri: string): CloudTarget | null {
  const match = /^(s3|gs):\/\/([^/]+)\/(.+)$/i.exec(uri);
  if (!match) return null;
  return {
    scheme: match[1]!.toLowerCase() as "s3" | "gs",
    bucket: match[2]!,
    key: decodeURIComponent(match[3]!),
  };
}

function encodeKey(key: string): string {
  return key.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

interface S3Request {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

function signS3Request(bucket: string, key: string): S3Request {
  const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";
  const accessKey = process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
  const sessionToken = process.env.AWS_SESSION_TOKEN;
  const endpoint = process.env.AWS_ENDPOINT;
  const path = `/${encodeKey(key)}`;
  const url = endpoint
    ? `${endpoint.replace(/\/$/, "")}/${bucket}${path}`
    : `https://${bucket}.s3.${region}.amazonaws.com${path}`;

  if (!accessKey || !secretKey) return { url, headers: {} };

  const parsed = new URL(url);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex("");
  const headers: Record<string, string> = {
    host: parsed.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (sessionToken) headers["x-amz-security-token"] = sessionToken;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [
    "GET",
    parsed.pathname,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, dateStamp), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  headers.Authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url,
    headers: {
      Authorization: headers.Authorization,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...(sessionToken ? { "x-amz-security-token": sessionToken } : {}),
    },
  };
}

interface CachedToken {
  readonly token: string;
  readonly expiresAt: number;
}

let gcsToken: CachedToken | null = null;

interface ServiceAccount {
  readonly client_email: string;
  readonly private_key: string;
  readonly token_uri?: string;
}

function readServiceAccount(): ServiceAccount | null {
  const inline = process.env.GCP_SERVICE_ACCOUNT_KEY;
  const file = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  try {
    const raw = inline ?? (file ? readFileSync(file, "utf-8") : null);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ServiceAccount;
    if (!parsed.client_email || !parsed.private_key) return null;
    return parsed;
  } catch {
    return null;
  }
}

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function requestGcsToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/devstorage.read_only",
    aud: account.token_uri ?? "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(account.private_key);
  const assertion = `${header}.${claims}.${base64Url(signature)}`;

  const response = await fetch(account.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) {
    throw new Error(`GCS authentication failed: HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!payload.access_token) throw new Error("GCS authentication response did not contain an access token");
  gcsToken = { token: payload.access_token, expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000 - 60_000 };
  return gcsToken.token;
}

async function resolveGcsToken(): Promise<string | null> {
  if (process.env.GCP_ACCESS_TOKEN) return process.env.GCP_ACCESS_TOKEN;
  if (gcsToken && gcsToken.expiresAt > Date.now()) return gcsToken.token;
  const account = readServiceAccount();
  if (!account) return null;
  return requestGcsToken(account);
}

export class CloudMediaResolver implements MediaResolver {
  readonly name = "cloud";

  canResolve(uri: string): boolean {
    return /^(s3|gs):\/\//i.test(uri);
  }

  async resolve(uri: string, context: ResolveContext): Promise<ArrayBuffer> {
    const cached = await context.cache.getRemote(uri);
    if (cached) return toArrayBuffer(cached);

    const target = parseCloudUri(uri);
    if (!target) throw new Error(`Unsupported cloud media URI: ${uri}`);

    const request = target.scheme === "s3"
      ? signS3Request(target.bucket, target.key)
      : await this.buildGcsRequest(target);

    let response: Response;
    try {
      response = await fetch(request.url, { headers: request.headers });
    } catch (error) {
      throw new Error(
        `Failed to fetch ${uri}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }

    if (!response.ok) {
      const hint = target.scheme === "s3"
        ? "Check AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_REGION."
        : "Set GCP_ACCESS_TOKEN or GCP_SERVICE_ACCOUNT_KEY.";
      throw new Error(`Failed to fetch ${uri}: HTTP ${response.status}. ${hint}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await context.cache.setRemote(uri, buffer);
    return toArrayBuffer(buffer);
  }

  async probe(uri: string, context: ResolveContext): Promise<MediaProbe> {
    try {
      const buffer = await this.resolve(uri, context);
      return { sizeBytes: buffer.byteLength };
    } catch {
      return {};
    }
  }

  private async buildGcsRequest(
    target: CloudTarget,
  ): Promise<{ readonly url: string; readonly headers: Readonly<Record<string, string>> }> {
    const url = `https://storage.googleapis.com/${target.bucket}/${encodeKey(target.key)}`;
    const token = await resolveGcsToken();
    return { url, headers: token ? { Authorization: `Bearer ${token}` } : {} };
  }
}
