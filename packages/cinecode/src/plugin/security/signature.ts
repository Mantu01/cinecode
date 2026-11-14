import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as ed from "@noble/ed25519";

export type PluginVerificationMode = "strict" | "warn" | "off";

export interface VerificationOptions {
  mode?: PluginVerificationMode;
  trustedKeys?: string[];
}

export interface SignatureVerificationResult {
  valid: boolean;
  status: "verified" | "unsigned" | "invalid_signature" | "skipped";
  publicKey?: string;
  checksum?: string;
  error?: string;
}

export const OFFICIAL_CINECODE_PUBLIC_KEY = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";

export function computePackageChecksum(pluginDir: string): string {
  const hash = crypto.createHash("sha256");
  const pkgJsonPath = path.join(pluginDir, "package.json");
  if (fs.existsSync(pkgJsonPath)) {
    hash.update(fs.readFileSync(pkgJsonPath));
  }

  const manifestPath = path.join(pluginDir, "cinecode.json");
  if (fs.existsSync(manifestPath)) {
    hash.update(fs.readFileSync(manifestPath));
  }

  const indexJs = path.join(pluginDir, "dist", "index.js");
  const indexTs = path.join(pluginDir, "src", "index.ts");
  if (fs.existsSync(indexJs)) {
    hash.update(fs.readFileSync(indexJs));
  } else if (fs.existsSync(indexTs)) {
    hash.update(fs.readFileSync(indexTs));
  }

  return hash.digest("hex");
}

export async function signPluginPackage(pluginDir: string, privateKeyHex: string): Promise<string> {
  const checksum = computePackageChecksum(pluginDir);
  const msg = new TextEncoder().encode(checksum);
  const privKey = Buffer.from(privateKeyHex, "hex");
  const sigBytes = await ed.signAsync(msg, privKey);
  const pubKeyBytes = await ed.getPublicKeyAsync(privKey);

  const sigData = {
    checksum,
    signature: Buffer.from(sigBytes).toString("hex"),
    publicKey: Buffer.from(pubKeyBytes).toString("hex"),
    timestamp: new Date().toISOString(),
  };

  const sigFilePath = path.join(pluginDir, "signature.sig");
  fs.writeFileSync(sigFilePath, JSON.stringify(sigData, null, 2));
  return sigData.signature;
}

export async function verifyPluginSignature(
  pluginDir: string,
  options: VerificationOptions = {},
): Promise<SignatureVerificationResult> {
  const mode = options.mode ?? "warn";
  if (mode === "off") {
    return { valid: true, status: "skipped" };
  }

  const sigFilePath = path.join(pluginDir, "signature.sig");
  if (!fs.existsSync(sigFilePath)) {
    if (mode === "strict") {
      return {
        valid: false,
        status: "unsigned",
        error: `Plugin at '${pluginDir}' is unsigned and verification mode is 'strict'.`,
      };
    }
    return { valid: true, status: "unsigned" };
  }

  try {
    const raw = fs.readFileSync(sigFilePath, "utf8");
    const sigData = JSON.parse(raw);
    const { checksum, signature, publicKey } = sigData;

    const currentChecksum = computePackageChecksum(pluginDir);
    if (currentChecksum !== checksum) {
      return {
        valid: false,
        status: "invalid_signature",
        publicKey,
        checksum: currentChecksum,
        error: `Checksum mismatch. Expected ${checksum}, found ${currentChecksum}`,
      };
    }

    const trusted = new Set([OFFICIAL_CINECODE_PUBLIC_KEY, ...(options.trustedKeys || [])]);
    if (!trusted.has(publicKey) && mode === "strict") {
      return {
        valid: false,
        status: "invalid_signature",
        publicKey,
        error: `Public key ${publicKey} is not in trusted keys list.`,
      };
    }

    const msg = new TextEncoder().encode(checksum);
    const sigBytes = Buffer.from(signature, "hex");
    const pubBytes = Buffer.from(publicKey, "hex");

    const valid = await ed.verifyAsync(sigBytes, msg, pubBytes);
    return {
      valid,
      status: valid ? "verified" : "invalid_signature",
      publicKey,
      checksum,
      error: valid ? undefined : "Signature cryptographic verification failed.",
    };
  } catch (err) {
    return {
      valid: false,
      status: "invalid_signature",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
