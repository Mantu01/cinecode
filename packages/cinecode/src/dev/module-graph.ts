import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { ManifestEntryBase } from "../core/types/manifest.js";
import type { ManifestProject } from "../manifest/index.js";
import type { DevNode } from "./types.js";

const IMPORT_REGEX = /(?:import|export)\s+(?:.*?from\s+)?['"](\.[^'"]+)['"]|require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
const MEDIA_REGEX = /['"`]([^'"`]+\.(?:png|jpg|jpeg|webp|avif|mp4|mov|webm|wav|mp3|aac|svg|gif))['"`]/gi;
const RESOLVE_EXTENSIONS = [".ts", ".js", ".mjs", ".cjs", ".mts", ".cts", ".json"];

function resolveRelativeImport(fromFile: string, specifier: string): string | null {
  const dir = dirname(fromFile);
  const target = resolve(dir, specifier);
  if (existsSync(target)) return target;

  // TypeScript ESM extension substitution: .js -> .ts / .tsx, .mjs -> .mts
  if (target.endsWith(".js")) {
    const tsFile = target.slice(0, -3) + ".ts";
    if (existsSync(tsFile)) return tsFile;
    const tsxFile = target.slice(0, -3) + ".tsx";
    if (existsSync(tsxFile)) return tsxFile;
  }
  if (target.endsWith(".mjs")) {
    const mtsFile = target.slice(0, -4) + ".mts";
    if (existsSync(mtsFile)) return mtsFile;
  }
  if (target.endsWith(".cjs")) {
    const ctsFile = target.slice(0, -4) + ".cts";
    if (existsSync(ctsFile)) return ctsFile;
  }

  for (const ext of RESOLVE_EXTENSIONS) {
    const withExt = target + ext;
    if (existsSync(withExt)) return withExt;
  }
  for (const ext of RESOLVE_EXTENSIONS) {
    const indexWithExt = join(target, `index${ext}`);
    if (existsSync(indexWithExt)) return indexWithExt;
  }

  return null;
}

// Transitive module graph tracking direct and indirect dependencies for incremental updates
export class ModuleGraph {
  readonly nodes: DevNode[];
  private readonly directByFile = new Map<string, DevNode[]>();
  private readonly reverseDeps = new Map<string, Set<string>>();
  private readonly mediaByFile = new Map<string, Set<string>>();
  private readonly maxTrackedFiles = 500;

  constructor(project: ManifestProject, rootDir: string) {
    const nodes: DevNode[] = [];
    const add = (kind: DevNode["kind"], entries: readonly ManifestEntryBase[] | undefined): void => {
      for (const entry of entries ?? []) {
        if (!entry.file) continue;
        const file = resolve(rootDir, entry.file);
        nodes.push({ id: entry.id, kind, file, name: entry.name ?? entry.id });
      }
    };
    add("image", project.manifest.images);
    add("audio", project.manifest.audio);
    add("scene", project.manifest.scenes);
    add("timeline", project.manifest.timelines);
    this.nodes = nodes;

    for (const node of nodes) {
      const list = this.directByFile.get(node.file) ?? [];
      list.push(node);
      this.directByFile.set(node.file, list);
    }

    this.buildTransitiveGraph(rootDir);
  }

  private buildTransitiveGraph(rootDir: string): void {
    const visited = new Set<string>();
    const queue: string[] = [];

    for (const node of this.nodes) {
      if (existsSync(node.file)) queue.push(node.file);
    }

    while (queue.length > 0 && visited.size < this.maxTrackedFiles) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      try {
        const source = readFileSync(current, "utf-8");
        let match: RegExpExecArray | null;
        while ((match = IMPORT_REGEX.exec(source)) !== null) {
          const specifier = match[1] ?? match[2];
          if (!specifier) continue;
          const resolvedPath = resolveRelativeImport(current, specifier);
          if (resolvedPath && resolvedPath.startsWith(rootDir)) {
            let dependents = this.reverseDeps.get(resolvedPath);
            if (!dependents) {
              dependents = new Set<string>();
              this.reverseDeps.set(resolvedPath, dependents);
            }
            dependents.add(current);
            if (!visited.has(resolvedPath)) queue.push(resolvedPath);
          }
        }
        let mediaMatch: RegExpExecArray | null;
        MEDIA_REGEX.lastIndex = 0;
        while ((mediaMatch = MEDIA_REGEX.exec(source)) !== null) {
          const raw = mediaMatch[1];
          if (raw) {
            for (const node of this.nodes) {
              if (node.file === current) {
                this.registerMediaReference(raw, node.id);
              }
            }
          }
        }
      } catch {
        // Note: Unreadable or binary file
      }
    }
  }

  registerMediaReference(mediaFilePath: string, nodeId: string): void {
    const abs = resolve(mediaFilePath);
    const base = basename(mediaFilePath);
    for (const key of [abs, base]) {
      let set = this.mediaByFile.get(key);
      if (!set) {
        set = new Set<string>();
        this.mediaByFile.set(key, set);
      }
      set.add(nodeId);
    }
  }

  nodesUsingMedia(mediaFilePath: string): readonly string[] {
    const abs = resolve(mediaFilePath);
    const base = basename(mediaFilePath);
    const set = new Set<string>();
    for (const id of this.mediaByFile.get(abs) ?? []) set.add(id);
    for (const id of this.mediaByFile.get(base) ?? []) set.add(id);
    return [...set];
  }

  // Returns all DevNodes transitively affected by changes to `file`
  affected(file: string): DevNode[] {
    const target = resolve(file);
    const affectedFiles = new Set<string>([target]);
    const queue = [target];

    while (queue.length > 0) {
      const curr = queue.shift()!;
      const dependents = this.reverseDeps.get(curr);
      if (dependents) {
        for (const dep of dependents) {
          if (!affectedFiles.has(dep)) {
            affectedFiles.add(dep);
            queue.push(dep);
          }
        }
      }
    }

    const resultNodes: DevNode[] = [];
    const seenNodeIds = new Set<string>();

    for (const f of affectedFiles) {
      const direct = this.directByFile.get(f);
      if (direct) {
        for (const node of direct) {
          if (!seenNodeIds.has(node.id)) {
            seenNodeIds.add(node.id);
            resultNodes.push(node);
          }
        }
      }
    }

    return resultNodes;
  }

  get(id: string): DevNode | undefined {
    return this.nodes.find((node) => node.id === id);
  }

  allTrackedFiles(): readonly string[] {
    const all = new Set<string>();
    for (const node of this.nodes) all.add(node.file);
    for (const f of this.reverseDeps.keys()) all.add(f);
    return [...all];
  }
}
