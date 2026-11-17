import { Command } from "commander";
import { EXIT_CODES, ExitSignal } from "./exit-codes.js";
import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { loadCinecodeIgnore } from "../config/ignore.js";

export interface PublishOptions {
  provider?: "aws" | "gcs" | "local";
  bucket?: string;
  region?: string;
  dest?: string;
}

export interface PublishResult {
  success: boolean;
  target: string;
  message: string;
}

interface LocalPublishConfig {
  destination?: string;
}

function respectIgnore(projectDir: string, relativePath: string): boolean {
  return loadCinecodeIgnore(projectDir).shouldIgnore(relativePath);
}

async function uploadToS3(outputPath: string, options: PublishOptions): Promise<PublishResult> {
  const bucket = options.bucket ?? process.env.CINECODE_S3_BUCKET;
  if (!bucket) {
    return { success: false, target: outputPath, message: "S3 bucket missing — pass --bucket or set CINECODE_S3_BUCKET" };
  }
  const mod = await importS3Client();
  if (!mod) {
    return { success: false, target: outputPath, message: "@aws-sdk/client-s3 is not installed — run: pnpm add @aws-sdk/client-s3 --filter=cinecode" };
  }
  const client = new mod.S3Client({ region: options.region ?? process.env.AWS_REGION });
  const key = path.basename(outputPath);
  await client.send(new mod.PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: fs.readFileSync(outputPath),
    ContentType: "video/mp4",
  }));
  const region = options.region ?? process.env.AWS_REGION ?? "us-east-1";
  const url = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  return { success: true, target: url, message: `Uploaded '${key}' to S3 bucket '${bucket}'` };
}

interface S3LikeClient {
  send(command: unknown): Promise<unknown>;
}

interface S3LikeModule {
  S3Client: new (config: { region?: string }) => S3LikeClient;
  PutObjectCommand: new (input: { Bucket: string; Key: string; Body: Buffer; ContentType: string }) => unknown;
}

async function importS3Client(): Promise<S3LikeModule | null> {
  const specifier = "@aws-sdk/client-s3";
  try {
    return (await import(specifier)) as unknown as S3LikeModule;
  } catch {
    return null;
  }
}

interface GcsLikeModule {
  Storage: new () => { bucket(name: string): { upload(path: string, options: { destination: string; contentType: string }): Promise<unknown> } };
}

async function importGcsStorage(): Promise<GcsLikeModule | null> {
  const specifier = "@google-cloud/storage";
  try {
    return (await import(specifier)) as unknown as GcsLikeModule;
  } catch {
    return null;
  }
}

async function uploadToGcs(outputPath: string, options: PublishOptions): Promise<PublishResult> {
  const bucket = options.bucket ?? process.env.CINECODE_GCS_BUCKET;
  if (!bucket) {
    return { success: false, target: outputPath, message: "GCS bucket missing — pass --bucket or set CINECODE_GCS_BUCKET" };
  }
  const mod = await importGcsStorage();
  if (!mod) {
    return { success: false, target: outputPath, message: "@google-cloud/storage is not installed — run: pnpm add @google-cloud/storage --filter=cinecode" };
  }
  const key = path.basename(outputPath);
  await new mod.Storage().bucket(bucket).upload(outputPath, { destination: key, contentType: "video/mp4" });
  const url = `https://storage.googleapis.com/${bucket}/${key}`;
  return { success: true, target: url, message: `Uploaded '${key}' to GCS bucket '${bucket}'` };
}

async function publishLocally(outputPath: string, options: PublishOptions): Promise<PublishResult> {
  const configPath = path.join(process.cwd(), ".cinecode-publish.json");
  let destination = options.dest;
  if (!destination && fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as LocalPublishConfig;
      destination = config.destination;
    } catch {
      void 0;
    }
  }
  if (!destination) {
    return { success: false, target: outputPath, message: "Local provider needs --dest or .cinecode-publish.json {\"destination\": \"...\"}" };
  }
  const target = path.resolve(destination, path.basename(outputPath));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(outputPath, target);
  return { success: true, target, message: `Copied output to ${target}` };
}

export async function publishOutput(outputPath: string, options: PublishOptions = {}): Promise<PublishResult> {
  if (!fs.existsSync(outputPath)) {
    return { success: false, target: outputPath, message: `Output file not found: ${outputPath}` };
  }
  const projectDir = path.dirname(path.resolve(outputPath));
  if (respectIgnore(projectDir, path.basename(outputPath))) {
    return { success: false, target: outputPath, message: "Output matches .cinecodeignore patterns — publish refused" };
  }
  switch (options.provider ?? "local") {
    case "aws":
      return uploadToS3(outputPath, options);
    case "gcs":
      return uploadToGcs(outputPath, options);
    default:
      return publishLocally(outputPath, options);
  }
}

export function createPublishCommand(): Command {
  return new Command("publish")
    .description("Publish a rendered output to S3, GCS, or a local destination")
    .argument("<outputPath>", "Rendered output file to publish")
    .option("--provider <provider>", "Publish provider: aws | gcs | local", "local")
    .option("--bucket <bucket>", "Target bucket (or env CINECODE_S3_BUCKET / CINECODE_GCS_BUCKET)")
    .option("--region <region>", "AWS region (or env AWS_REGION)")
    .option("--dest <dir>", "Local destination directory")
    .action(async (outputPath: string, options: PublishOptions) => {
      console.log(`Publishing '${outputPath}' via ${options.provider ?? "local"} provider...`);
      const result = await publishOutput(outputPath, options);
      if (result.success) {
        console.log(pc.green(`✔ ${result.message}`));
        console.log(pc.cyan(result.target));
      } else {
        console.error(pc.red(`✖ ${result.message}`));
        throw new ExitSignal(EXIT_CODES.environment);
      }
    });
}
