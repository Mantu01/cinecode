import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));

function resolveViewerDir(): string {
  // Built location: dist/viewer; source location: src/dev/static
  const candidates = [
    resolve(currentDir, "..", "..", "viewer"),
    resolve(currentDir, "..", "..", "dist", "viewer"),
    resolve(currentDir, "static"),
    resolve(currentDir, "..", "src", "dev", "static"),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, "index.html"))) return dir;
  }
  return join(currentDir, "static");
}

const viewerDir = resolveViewerDir();

export interface ViewerDocument {
  readonly html: string;
  readonly nonce: string;
  readonly headers: Record<string, string>;
}

export function getViewerDocument(): ViewerDocument {
  const nonce = randomBytes(16).toString("base64");
  const indexPath = join(viewerDir, "index.html");
  let rawHtml = "<!doctype html><html><head><title>Cinecode</title></head><body>Viewer asset not found</body></html>";
  try {
    rawHtml = readFileSync(indexPath, "utf-8");
  } catch {
    // Note: Fallback if missing
  }

  const html = rawHtml.replace(/\{\{NONCE\}\}/g, nonce);
  const csp = `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'nonce-${nonce}'; script-src 'self' 'nonce-${nonce}'; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; form-action 'none'`;

  const headers: Record<string, string> = {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-cache, no-store, must-revalidate",
  };

  return { html, nonce, headers };
}

export function getViewerAsset(filename: string): { readonly content: Buffer; readonly contentType: string } | null {
  const clean = filename.replace(/^\/+/, "").replace(/\.\./g, "");
  const filePath = join(viewerDir, clean);
  if (!existsSync(filePath)) return null;

  try {
    const content = readFileSync(filePath);
    let contentType = "application/octet-stream";
    if (clean.endsWith(".css")) contentType = "text/css; charset=utf-8";
    else if (clean.endsWith(".js")) contentType = "application/javascript; charset=utf-8";
    else if (clean.endsWith(".png")) contentType = "image/png";
    else if (clean.endsWith(".svg")) contentType = "image/svg+xml";
    return { content, contentType };
  } catch {
    return null;
  }
}
