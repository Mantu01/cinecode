import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toArrayBuffer, type MediaResolver, type ResolveContext } from "../resolver-types.js";

export class FileSystemMediaResolver implements MediaResolver {
  readonly name = "filesystem";

  canResolve(uri: string): boolean {
    return (
      uri.startsWith("file://") ||
      (!/^[a-z][a-z0-9+.-]*:\/\//i.test(uri) && !uri.startsWith("data:"))
    );
  }

  async resolve(uri: string, context: ResolveContext): Promise<ArrayBuffer> {
    const path = uri.startsWith("file://")
      ? fileURLToPath(uri)
      : isAbsolute(uri)
        ? uri
        : resolve(context.projectRoot, uri);
    const buffer = await readFile(path);
    return toArrayBuffer(buffer);
  }
}
