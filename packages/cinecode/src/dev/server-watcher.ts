import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { CONFIG_FILENAMES } from "../config/project.js";
import { createError, ErrorCode } from "../errors/index.js";
import { createProjectResolver } from "../cli/resolve/project-resolver.js";
import { runCheck, type CheckReport } from "../cli/gate/check.js";
import { disposeUserModuleCache, invalidateUserModules } from "../loader/index.js";
import { ModuleGraph } from "./module-graph.js";
import { PROTOCOL_VERSION } from "./protocol.js";
import { invalidateSessionNode } from "./server-ws.js";
import type { DevNode } from "./types.js";
import type { PreviewServerContext } from "./server-types.js";

export function computeValidationKey(context: PreviewServerContext): string {
  const hash = createHash("sha256");
  const files = new Set([context.options.configPath, ...context.graph.allTrackedFiles()]);
  for (const file of files) {
    hash.update(file);
    try {
      hash.update(readFileSync(file));
    } catch {
      hash.update("missing");
    }
  }
  const mediaRoot = resolve(context.options.rootDir, context.options.config.mediaDir ?? "./media");
  try {
    for (const entry of readdirSync(mediaRoot, { recursive: true }).map(String).sort()) {
      const full = resolve(mediaRoot, entry);
      try {
        const stat = statSync(full);
        if (stat.isFile()) hash.update(`${entry}:${stat.size}:${stat.mtimeMs}`);
      } catch {
        // Note: media entry disappeared during the scan
      }
    }
  } catch {
    // Note: media directory may not exist yet
  }
  return hash.digest("hex");
}

export async function validateProject(context: PreviewServerContext): Promise<CheckReport> {
  const key = computeValidationKey(context);
  const cached = context.validationCache.get(key);
  if (cached) {
    context.validationCache.delete(key);
    context.validationCache.set(key, cached);
    context.broadcast({ type: "validation", version: PROTOCOL_VERSION, report: cached });
    return cached;
  }

  let report: CheckReport;
  try {
    const resolver = createProjectResolver({
      root: context.options.rootDir,
      config: context.options.configPath,
    });
    report = await runCheck(await resolver.resolve());
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string; location?: { file?: string }; fixHint?: string } | null;
    report = {
      ok: false,
      errors: [
        {
          code: e?.code ?? "CC1009",
          message: e?.message ?? String(err),
          file: e?.location?.file ?? context.options.project.entryPath,
          fixHint: e?.fixHint,
          severity: "error",
          category: "config",
        },
      ],
      warnings: [],
      notes: [],
      categories: {
        config: { errors: 1, warnings: 0 },
        authoring: { errors: 0, warnings: 0 },
        media: { errors: 0, warnings: 0 },
        fonts: { errors: 0, warnings: 0 },
        determinism: { errors: 0, warnings: 0 },
      },
    };
  }

  context.validationCache.set(key, report);
  while (context.validationCache.size > 32) {
    const oldest = context.validationCache.keys().next().value;
    if (oldest === undefined) break;
    context.validationCache.delete(oldest);
  }

  context.broadcast({ type: "validation", version: PROTOCOL_VERSION, report });
  return report;
}

export async function handleFileChanges(
  context: PreviewServerContext,
  files: readonly string[],
): Promise<void> {
  const isConfigChange = files.some((f) => (CONFIG_FILENAMES as readonly string[]).includes(basename(f)));
  const mediaRoot = resolve(context.options.rootDir, context.options.config.mediaDir ?? "./media");
  const mediaFiles = files.filter((f) => resolve(f).startsWith(mediaRoot));

  if (isConfigChange) {
    try {
      disposeUserModuleCache();
      const resolver = createProjectResolver({
        root: context.options.rootDir,
        config: context.options.configPath,
        fresh: true,
      });
      const resolution = await resolver.resolve();
      if (!resolution.manifest) throw createError(ErrorCode.CC1009, { path: resolution.manifestPath });
      context.setOptions({
        ...context.options,
        rootDir: resolution.root,
        config: resolution.config,
        configPath: resolution.configPath,
        project: resolution.manifest,
      });
      context.setProjectSnapshot(resolution.manifest);
      context.graph = new ModuleGraph(resolution.manifest, context.options.rootDir);
      await context.rebuildCaches();
      context.startWatcher();
      context.previews.clear();
      context.previewLru.clear();
      context.validationCache.clear();
      for (const session of context.sessions.values()) {
        if (!context.graph.get(session.selectedNodeId)) {
          session.selectedNodeId = context.graph.nodes[0]?.id ?? "";
        }
        session.currentFrame = 0;
        session.pendingFrame = null;
        context.requestFrame(session, 0);
      }
      context.broadcast({
        type: "welcome",
        version: PROTOCOL_VERSION,
        nodes: context.graph.nodes.map((n) => ({ id: n.id, kind: n.kind, name: n.name })),
      });
    } catch (err) {
      context.broadcast({
        type: "error",
        version: PROTOCOL_VERSION,
        code: "CC1001",
        message: err instanceof Error ? err.message : String(err),
      });
    }
    await context.validate();
    return;
  }

  if (mediaFiles.length > 0) {
    for (const mediaFile of mediaFiles) {
      try {
        const stat = statSync(mediaFile);
        const identity = `${mediaFile}:${stat.mtimeMs}:${stat.size}`;
        void identity;

        const affectedNodeIds = new Set(context.graph.nodesUsingMedia(mediaFile));
        const mediaBase = basename(mediaFile);
        for (const node of context.graph.nodes) {
          try {
            if (existsSync(node.file)) {
              const content = readFileSync(node.file, "utf-8");
              if (content.includes(mediaBase)) affectedNodeIds.add(node.id);
            }
          } catch {
            // Note: ignore error reading candidate node file
          }
        }

        for (const key of [...context.previewLru.keys()]) {
          for (const nid of affectedNodeIds) {
            if (key.startsWith(`${nid}:`)) context.previewLru.delete(key);
          }
        }

        for (const session of context.sessions.values()) {
          for (const nid of affectedNodeIds) {
            invalidateSessionNode(session, nid);
          }
          if (affectedNodeIds.has(session.selectedNodeId)) {
            context.requestFrame(session, session.currentFrame);
          }
        }
      } catch {
        // Note: File may have been deleted
      }
    }
    await context.validate();
    return;
  }

  const affectedNodes = new Set<DevNode>();
  const invalidatedFiles = new Set<string>(files);
  for (const file of files) {
    for (const node of context.graph.affected(file)) {
      affectedNodes.add(node);
      invalidatedFiles.add(node.file);
    }
  }
  invalidateUserModules([...invalidatedFiles]);

  const report = await context.validate();

  for (const session of context.sessions.values()) {
    for (const node of affectedNodes) {
      invalidateSessionNode(session, node.id);
    }
    const isPreviewedAffected = [...affectedNodes].some((n) => n.id === session.selectedNodeId);
    if (isPreviewedAffected) {
      for (const key of [...context.previewLru.keys()]) {
        if (key.startsWith(`${session.selectedNodeId}:`)) context.previewLru.delete(key);
      }
      context.requestFrame(session, session.currentFrame);
    }
  }

  for (const node of affectedNodes) {
    const existing = context.previews.get(node.id);
    const version = (existing?.version ?? 0) + 1;
    context.previews.set(node.id, { buffer: Buffer.alloc(0), contentType: "image/png", version });
    context.broadcast({
      type: "update",
      node: node.id,
      url: `/preview/${encodeURIComponent(node.id)}?v=${version}`,
      at: Date.now(),
    });
  }

  void report;
}
