/** Author-owned source works and character correspondences. No model inference. */
export interface RegisteredWork {
  id: string;
  title: string;
  aliases?: string[];
  referenceIds?: string[];
}
export interface WorkRegistry {
  version: 1;
  works: RegisteredWork[];
}
export interface ReferenceCharacterBinding {
  referenceId: string;
  name: string;
  materialHash: string;
}
export interface WorkAttribution {
  path: string;
  label: string;
  originWorkId?: string;
}
export interface WorkRegistryView {
  registry: WorkRegistry | null;
  attributions: WorkAttribution[];
  fingerprint: string;
}
export interface WorkRegistryEdit {
  registry: WorkRegistry;
  attributions: Array<{ path: string; originWorkId: string | null }>;
}
export const WORK_REGISTRY_PATH = "works.yaml";
export const ORIGINAL_WORK_ID = "original";
export const normalizeCharacterName = (name: string): string =>
  name.normalize("NFKC").toLowerCase().trim().replace(/\s+/gu, " ");

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new Error("作品归属字段无效。");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  // eslint-disable-next-line no-control-regex -- control characters are forbidden in author-owned identifiers and labels.
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > max ||
    /[\x00-\x1f\x7f]/u.test(value)
  )
    throw new Error("作品归属文本无效。");
  return value;
}
export function validateWorkId(value: unknown): string {
  const id = text(value, 100);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(id)) throw new Error("作品或参考 ID 无效。");
  return id;
}
function texts(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 32) throw new Error("作品别名或参考清单过大。");
  const result = value.map((item) => text(item, 120));
  if (new Set(result).size !== result.length) throw new Error("作品别名或参考 ID 重复。");
  return result;
}
export function normalizeWorkRegistry(value: unknown): WorkRegistry {
  const root = object(value, ["version", "works"]);
  if (root.version !== 1 || !Array.isArray(root.works) || root.works.length > 200)
    throw new Error("作品清单必须为 version: 1 与不超过 200 项的 works。");
  const ids = new Set<string>(),
    references = new Set<string>();
  const works = root.works.map((raw) => {
    const entry = object(raw, ["id", "title", "aliases", "referenceIds"]);
    const id = validateWorkId(entry.id),
      title = text(entry.title, 120);
    if (id === ORIGINAL_WORK_ID || ids.has(id))
      throw new Error("作品 ID 重复或使用了保留的 original。");
    ids.add(id);
    const aliases = entry.aliases === undefined ? undefined : texts(entry.aliases);
    const referenceIds =
      entry.referenceIds === undefined ? undefined : texts(entry.referenceIds).map(validateWorkId);
    for (const referenceId of referenceIds ?? []) {
      if (references.has(referenceId)) throw new Error("同一参考作品不能绑定多部原作。");
      references.add(referenceId);
    }
    return {
      id,
      title,
      ...(aliases ? { aliases } : {}),
      ...(referenceIds ? { referenceIds } : {}),
    };
  });
  return { version: 1, works };
}
export function normalizeReferenceCharacters(value: unknown): ReferenceCharacterBinding[] {
  if (!Array.isArray(value) || value.length > 200) throw new Error("人物对应列表无效或过大。");
  const seen = new Set<string>();
  return value.map((raw) => {
    const entry = object(raw, ["referenceId", "name", "materialHash"]);
    const referenceId = validateWorkId(entry.referenceId),
      name = text(entry.name, 500);
    if (typeof entry.materialHash !== "string" || !/^[a-f0-9]{64}$/u.test(entry.materialHash))
      throw new Error("人物对应材料指纹无效。");
    const key = JSON.stringify([referenceId, normalizeCharacterName(name)]);
    if (seen.has(key)) throw new Error("同一参考作品的人物对应重复。");
    seen.add(key);
    return { referenceId, name, materialHash: entry.materialHash };
  });
}
export function normalizeWorkRegistryEdit(value: unknown): WorkRegistryEdit {
  const edit = object(value, ["registry", "attributions"]);
  const registry = normalizeWorkRegistry(edit.registry);
  if (!Array.isArray(edit.attributions) || edit.attributions.length > 63)
    throw new Error("每批最多修改 63 个对象归属。");
  const paths = new Set<string>();
  const attributions = edit.attributions.map((raw) => {
    const item = object(raw, ["path", "originWorkId"]);
    const path = text(item.path, 500);
    if (!isAttributionPath(path) || paths.has(path))
      throw new Error("归属目标重复或不是角色 meta / 世界对象。");
    paths.add(path);
    const originWorkId = item.originWorkId === null ? null : validateWorkId(item.originWorkId);
    if (
      originWorkId &&
      originWorkId !== ORIGINAL_WORK_ID &&
      !registry.works.some((work) => work.id === originWorkId)
    )
      throw new Error("归属引用不存在的作品。");
    return { path, originWorkId };
  });
  return { registry, attributions };
}
export function isAttributionPath(path: string): boolean {
  return (
    /^(?:characters\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/meta\.yaml|world\/(?:[^/.][^/]*\/)*[^/.][^/]*\.(?:md|yaml))$/u.test(
      path,
    ) &&
    // eslint-disable-next-line no-control-regex -- reject control characters in paths.
    !path.split("/").some((part) => part.startsWith(".") || /[\\\x00-\x1f]/u.test(part))
  );
}
