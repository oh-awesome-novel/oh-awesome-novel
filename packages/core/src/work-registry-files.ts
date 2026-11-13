import { createHash } from "node:crypto";
import { lstat, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { readWorkspaceTextFile } from "./workspace-text.js";
import {
  isAttributionPath,
  normalizeWorkRegistry,
  normalizeReferenceCharacters,
  validateWorkId,
  ORIGINAL_WORK_ID,
} from "./work-registry.js";
import type { WorkRegistry, WorkRegistryView } from "./work-registry.js";

export interface WorkRegistryFile {
  path: string;
  content: string;
}
export function readAttributionDocument(
  path: string,
  content: string,
): Record<string, unknown> | undefined {
  let yaml = content;
  if (path.endsWith(".md")) {
    const match = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/u.exec(content);
    if (!match) return undefined;
    yaml = match[1]!;
  }
  const document = parseDocument(yaml, { uniqueKeys: true });
  if (document.errors.length) throw new Error(`无法读取作品归属：${path}`);
  const value: unknown = document.toJS({ maxAliasCount: 100 });
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`归属文件必须是映射：${path}`);
  return value as Record<string, unknown>;
}
export function inspectWorkRegistryFiles(files: readonly WorkRegistryFile[]): WorkRegistryView {
  const registryFile = files.find((file) => file.path === "works.yaml");
  const registry = registryFile
    ? normalizeWorkRegistry(readAttributionDocument(registryFile.path, registryFile.content))
    : null;
  const attributions = files
    .filter((file) => isAttributionPath(file.path))
    .map((file) => {
      const value = readAttributionDocument(file.path, file.content);
      const originWorkId =
        value?.originWorkId === undefined ? undefined : validateWorkId(value.originWorkId);
      const label =
        [value?.displayName, value?.name, value?.title].find(
          (item): item is string => typeof item === "string",
        ) ?? file.path;
      return { path: file.path, label, ...(originWorkId ? { originWorkId } : {}) };
    });
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify(
        files
          .filter((file) => file.path === "works.yaml" || isAttributionPath(file.path))
          .slice()
          .sort((a, b) => a.path.localeCompare(b.path)),
      ),
    )
    .digest("hex");
  return { registry, attributions, fingerprint };
}
/** Called on the complete final object tree, including unchanged referencers. */
export function validateWorkRegistryReferences(files: readonly WorkRegistryFile[]): void {
  const view = inspectWorkRegistryFiles(files);
  const works = new Set(view.registry?.works.map((work) => work.id));
  const correspondence = new Map<string, string>();
  for (const attribution of view.attributions) {
    if (
      attribution.originWorkId &&
      attribution.originWorkId !== ORIGINAL_WORK_ID &&
      !works.has(attribution.originWorkId)
    )
      throw new Error(`归属引用不存在的作品：${attribution.path} → ${attribution.originWorkId}`);
  }
  for (const file of files.filter((file) => /^characters\/[^/]+\/meta\.yaml$/u.test(file.path))) {
    const value = readAttributionDocument(file.path, file.content)!;
    if (value.referenceCharacters === undefined) continue;
    for (const binding of normalizeReferenceCharacters(value.referenceCharacters)) {
      const key = JSON.stringify([
        binding.referenceId,
        binding.name.normalize("NFKC").toLowerCase().trim().replace(/\s+/gu, " "),
      ]);
      if (correspondence.has(key) && correspondence.get(key) !== file.path)
        throw new Error("同一来源人物不能对应多个角色。");
      correspondence.set(key, file.path);
    }
  }
}
/** Safe bounded read for preflight; no write or model call. */
export async function readWorkRegistryFiles(
  workspaceRoot: string,
  includeCharacterText = false,
): Promise<WorkRegistryFile[]> {
  const root = await realpath(workspaceRoot),
    files: WorkRegistryFile[] = [];
  let visited = 0,
    bytes = 0;
  async function visit(path: string, depth: number): Promise<void> {
    if (++visited > 10000 || depth > 24) throw new Error("作品归属目录过大。");
    let info;
    try {
      info = await lstat(join(root, path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error(`作品归属路径不能是符号链接：${path}`);
    if (info.isDirectory()) {
      for (const name of (await readdir(join(root, path))).sort())
        if (!name.startsWith(".")) await visit(`${path}/${name}`, depth + 1);
    } else if (
      path === "works.yaml" ||
      isAttributionPath(path) ||
      (includeCharacterText && /^characters\/.+\.(?:md|yaml)$/u.test(path))
    ) {
      const file = await readWorkspaceTextFile(root, path);
      bytes += Buffer.byteLength(file.content);
      if (bytes > 16 * 1024 * 1024) throw new Error("作品归属文件总量过大。");
      files.push(file);
    }
  }
  for (const path of includeCharacterText
    ? ["works.yaml", "characters"]
    : ["works.yaml", "characters", "world"])
    await visit(path, 0);
  return files;
}
export function workForReference(registry: WorkRegistry | null, referenceId: string) {
  return registry?.works.find((work) => work.referenceIds?.includes(referenceId));
}
