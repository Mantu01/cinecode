import fs from "node:fs";
import path from "node:path";

export interface AuditIssue {
  type: "vulnerability" | "license" | "asset";
  severity: "critical" | "high" | "moderate" | "low" | "info";
  packageOrFile: string;
  title: string;
  description: string;
  remediation?: string;
}

export interface AuditScanOptions {
  readonly projectDir?: string;
  readonly mediaDir?: string;
}

export interface AuditReport {
  timestamp: string;
  scannedRoots: { readonly project: string; readonly media: string };
  scannedDependencies: number;
  scannedAssets: number;
  issues: AuditIssue[];
  status: "pass" | "warn" | "fail";
  summary: {
    critical: number;
    high: number;
    moderate: number;
    low: number;
    licenseFlags: number;
  };
}

const ALLOWED_LICENSES = new Set([
  "mit",
  "apache-2.0",
  "bsd-2-clause",
  "bsd-3-clause",
  "isc",
  "unlicense",
  "0bsd",
  "cc0-1.0",
]);

const COPYLEFT_LICENSES = new Set([
  "gpl-2.0",
  "gpl-3.0",
  "agpl-3.0",
  "lgpl-2.1",
  "lgpl-3.0",
  "mpl-2.0",
]);

export async function runSecurityAudit(options: string | AuditScanOptions = process.cwd()): Promise<AuditReport> {
  const projectDir = typeof options === "string" ? options : (options.projectDir ?? process.cwd());
  const mediaDir = typeof options === "string" ? path.join(projectDir, "media") : (options.mediaDir ?? path.join(projectDir, "media"));
  const issues: AuditIssue[] = [];
  let scannedDeps = 0;
  let scannedAssets = 0;

  const pkgJsonPath = path.join(projectDir, "package.json");
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
      const allDeps = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
      };

      for (const [dep, version] of Object.entries(allDeps)) {
        scannedDeps++;
        const depPkgPath = path.join(projectDir, "node_modules", dep, "package.json");
        let license = "UNKNOWN";

        if (fs.existsSync(depPkgPath)) {
          try {
            const depPkg = JSON.parse(fs.readFileSync(depPkgPath, "utf8"));
            license = typeof depPkg.license === "string" ? depPkg.license : typeof depPkg.license === "object" ? depPkg.license.type : "UNKNOWN";
          } catch {
            // Note: ignore corrupt dependency package.json
          }
        }

        const normalizedLic = license.toLowerCase().trim();
        if (COPYLEFT_LICENSES.has(normalizedLic)) {
          issues.push({
            type: "license",
            severity: "high",
            packageOrFile: `${dep}@${version}`,
            title: `Copyleft license detected: ${license}`,
            description: `Package '${dep}' uses ${license}, which may impose copyleft requirements on generated commercial video assets.`,
            remediation: `Consider replacing '${dep}' with an MIT or Apache-2.0 licensed alternative.`,
          });
        } else if (!ALLOWED_LICENSES.has(normalizedLic) && normalizedLic !== "unknown") {
          issues.push({
            type: "license",
            severity: "moderate",
            packageOrFile: `${dep}@${version}`,
            title: `Non-standard license: ${license}`,
            description: `Package '${dep}' uses license '${license}'. Verify commercial terms.`,
          });
        }
      }
    } catch {
      // Note: ignore missing project package.json
    }
  }

  if (fs.existsSync(mediaDir)) {
    try {
      const files = fs.readdirSync(mediaDir, { recursive: true }) as string[];
      for (const file of files) {
        if (typeof file !== "string") continue;
        scannedAssets++;
        const ext = path.extname(file).toLowerCase();
        if (ext === ".ttf" || ext === ".otf" || ext === ".woff2") {
          issues.push({
            type: "asset",
            severity: "info",
            packageOrFile: file,
            title: "Font asset embedded",
            description: `Verify desktop/commercial video embedding rights for font '${file}'.`,
          });
        }
      }
    } catch {
      // Note: ignore unreadable assets directory
    }
  }

  const critical = issues.filter((i) => i.severity === "critical").length;
  const high = issues.filter((i) => i.severity === "high").length;
  const moderate = issues.filter((i) => i.severity === "moderate").length;
  const low = issues.filter((i) => i.severity === "low").length;
  const licenseFlags = issues.filter((i) => i.type === "license").length;

  const status = critical > 0 || high > 0 ? "fail" : moderate > 0 ? "warn" : "pass";

  return {
    timestamp: new Date().toISOString(),
    scannedRoots: { project: projectDir, media: mediaDir },
    scannedDependencies: scannedDeps,
    scannedAssets: scannedAssets,
    issues,
    status,
    summary: { critical, high, moderate, low, licenseFlags },
  };
}
