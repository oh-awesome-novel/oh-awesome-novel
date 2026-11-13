import { createHash } from "node:crypto";
import { parseDocument, stringify } from "yaml";
import {
  inspectWorkRegistryFiles,
  readAttributionDocument,
  readWorkRegistryFiles,
  workForReference,
} from "./work-registry-files.js";
import { normalizeCharacterName, normalizeReferenceCharacters } from "./work-registry.js";
import type {
  ReferenceMaterialAdoptionCatalog,
  ReferenceMaterialAdoptionEntry,
  ReferenceMaterialAdoptionSelection,
  ReferenceMaterialAdoptionPreflightIssue,
} from "./reference-material-adoption.js";

export interface CharacterAdoptionDecision {
  kind: "same" | "different";
  characterId: string;
  materialHash: string;
}
export interface RelationshipCharacterSelection {
  name: string;
  characterId: string;
}
export interface CharacterMatchCandidate {
  characterId: string;
  name: string;
  files: Array<{ path: string; content: string; truncated: boolean }>;
}
export interface ReferenceCharacterMatch {
  entryId: string;
  materialHash: string;
  matches: CharacterMatchCandidate[];
  suggestedCharacterId: string;
  recordedCharacterId?: string;
  stale: boolean;
}
export interface ReferenceCharacterPreflight {
  matches: ReferenceCharacterMatch[];
  characters: Array<{ id: string; name: string }>;
  unresolvedRelationships: string[];
}
export interface CharacterAdoptionEvidence {
  selections: ReferenceMaterialAdoptionSelection[];
  registryFingerprint: string;
  metadata: Array<{
    path: string;
    baseline: string;
    exists: boolean;
    content: string;
    entryIds: string[];
  }>;
  mergeFiles: string[];
  relationships: Array<{ targetFile: string; characters: RelationshipCharacterSelection[] }>;
}
export function materialCharacterHash(entry: ReferenceMaterialAdoptionEntry): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        entry.title,
        entry.content,
        entry.details,
        entry.assertionType,
        entry.confidence,
        entry.uncertainty ?? null,
      ]),
    )
    .digest("hex");
}
export function normalizeCharacterSelectionFields(
  value: Record<string, unknown>,
): Pick<ReferenceMaterialAdoptionSelection, "characterDecision" | "relationshipCharacters"> {
  let characterDecision: CharacterAdoptionDecision | undefined;
  const decision = value.characterDecision;
  if (decision !== undefined) {
    if (
      !record(decision) ||
      Object.keys(decision).some((k) => !["kind", "characterId", "materialHash"].includes(k)) ||
      !["same", "different"].includes(String(decision.kind)) ||
      !safeId(decision.characterId) ||
      typeof decision.materialHash !== "string" ||
      !/^[a-f0-9]{64}$/u.test(decision.materialHash)
    )
      throw new Error("人物裁定格式无效。");
    characterDecision = {
      kind: decision.kind as "same" | "different",
      characterId: decision.characterId as string,
      materialHash: decision.materialHash,
    };
  }
  let relationshipCharacters: RelationshipCharacterSelection[] | undefined;
  if (value.relationshipCharacters !== undefined) {
    if (!Array.isArray(value.relationshipCharacters) || value.relationshipCharacters.length > 32)
      throw new Error("关系人物列表无效。");
    relationshipCharacters = value.relationshipCharacters.map((raw) => {
      if (
        !record(raw) ||
        Object.keys(raw).some((k) => !["name", "characterId"].includes(k)) ||
        typeof raw.name !== "string" ||
        !raw.name.trim() ||
        raw.name.length > 500 ||
        (raw.characterId !== "" && !safeId(raw.characterId))
      )
        throw new Error("关系人物格式无效。");
      return { name: raw.name.trim(), characterId: raw.characterId as string };
    });
    if (
      new Set(relationshipCharacters.map((v) => normalizeCharacterName(v.name))).size !==
      relationshipCharacters.length
    )
      throw new Error("关系人物名重复。");
  }
  return {
    ...(characterDecision ? { characterDecision } : {}),
    ...(relationshipCharacters ? { relationshipCharacters } : {}),
  };
}
/** Matches only canonical names/aliases or author-approved source correspondences. */
export async function inspectReferenceCharacterAdoption(
  root: string,
  catalog: ReferenceMaterialAdoptionCatalog,
  input: readonly ReferenceMaterialAdoptionSelection[],
) {
  const files = await readWorkRegistryFiles(root, true);
  const view = inspectWorkRegistryFiles(files);
  const enabled =
    !!view.registry ||
    input.some((s) => s.characterDecision || s.relationshipCharacters) ||
    files.some(
      (f) =>
        /\/meta.yaml$/u.test(f.path) &&
        readAttributionDocument(f.path, f.content)?.referenceCharacters !== undefined,
    );
  if (!enabled) return undefined;
  const characters = files
    .filter((file) => /^characters\/[^/]+\/meta\.yaml$/u.test(file.path))
    .map((file) => {
      const value = readAttributionDocument(file.path, file.content)!;
      const id = file.path.split("/")[1]!;
      if (value.id !== id || typeof (value.displayName ?? value.name) !== "string")
        throw new Error(`角色身份无效：${file.path}`);
      return {
        id,
        name: String(value.displayName ?? value.name),
        aliases: Array.isArray(value.aliases)
          ? value.aliases.filter((a): a is string => typeof a === "string")
          : [],
        file,
        value,
        bindings:
          value.referenceCharacters === undefined
            ? []
            : normalizeReferenceCharacters(value.referenceCharacters),
      };
    });
  const work = workForReference(view.registry, catalog.referenceId);
  const issues: ReferenceMaterialAdoptionPreflightIssue[] = [];
  const matches: ReferenceCharacterMatch[] = [];
  let comparisonChars = 0;
  const selections = input.map((selection) => ({
    ...selection,
    ...normalizeCharacterSelectionFields(selection as unknown as Record<string, unknown>),
  }));
  const metadata = new Map<string, CharacterAdoptionEvidence["metadata"][number]>();
  const mergeFiles: string[] = [];
  const relationships: CharacterAdoptionEvidence["relationships"] = [];
  const bindings = new Map<string, Set<string>>();
  const addBinding = (name: string, id: string) => {
    const key = normalizeCharacterName(name);
    bindings.set(key, new Set([...(bindings.get(key) ?? []), id]));
  };
  for (const character of characters)
    for (const binding of character.bindings)
      if (binding.referenceId === catalog.referenceId) {
        const current = catalog.entries.find(
          (e) =>
            e.materialKind === "characters" &&
            normalizeCharacterName(e.title) === normalizeCharacterName(binding.name),
        );
        if (current && materialCharacterHash(current) === binding.materialHash)
          addBinding(binding.name, character.id);
      }
  const error = (
    entryId: string,
    message: string,
    code: "characterDecisionRequired" | "unresolvedRelationship" = "characterDecisionRequired",
  ) => issues.push({ code, severity: "error", message, entryIds: [entryId] });
  for (const selection of selections.slice(0, 64)) {
    const entry = catalog.entries.find((e) => e.id === selection.entryId);
    if (!entry || entry.materialKind !== "characters") continue;
    const materialHash = materialCharacterHash(entry),
      name = normalizeCharacterName(entry.title);
    const recorded = characters.filter((c) =>
      c.bindings.some(
        (b) => b.referenceId === catalog.referenceId && normalizeCharacterName(b.name) === name,
      ),
    );
    const current = recorded.filter((c) =>
      c.bindings.some(
        (b) =>
          b.referenceId === catalog.referenceId &&
          normalizeCharacterName(b.name) === name &&
          b.materialHash === materialHash,
      ),
    );
    const candidates = characters.filter(
      (c) =>
        [c.name, ...c.aliases].some((n) => normalizeCharacterName(n) === name) ||
        recorded.includes(c) ||
        c.id === selection.characterDecision?.characterId,
    );
    const stem =
      entry.id
        .replace(/[^A-Za-z0-9_-]/gu, "-")
        .replace(/^-+/u, "")
        .slice(0, 50) || "character";
    const suffix = (work?.id ?? catalog.referenceId).slice(0, 32);
    let suggestedCharacterId = `${stem}-${suffix}`;
    for (
      let n = 2;
      files.some((file) => file.path.startsWith(`characters/${suggestedCharacterId}/`));
      n++
    )
      suggestedCharacterId = `${stem}-${suffix}-${n}`;
    const candidateView = (c: (typeof characters)[number]): CharacterMatchCandidate => ({
      characterId: c.id,
      name: c.name,
      files: files
        .filter((f) => f.path.startsWith(`characters/${c.id}/`))
        .slice(0, 8)
        .map((f) => {
          const content = f.content.slice(0, Math.max(0, Math.min(8000, 512000 - comparisonChars)));
          comparisonChars += content.length;
          return { path: f.path, content, truncated: f.content.length > content.length };
        }),
    });
    matches.push({
      entryId: entry.id,
      materialHash,
      matches: candidates.slice(0, 16).map(candidateView),
      suggestedCharacterId,
      ...(current.length === 1 ? { recordedCharacterId: current[0]!.id } : {}),
      stale: recorded.length > 0 && current.length !== 1,
    });
    const decision = selection.characterDecision;
    if (decision && decision.materialHash !== materialHash) {
      error(entry.id, "人物材料已变更，请重新对照并裁定。");
      continue;
    }
    let id = selection.targetFile.split("/")[1] ?? "";
    let same = false;
    if (decision) {
      id = decision.characterId;
      same = decision.kind === "same";
    } else if (current.length === 1) {
      id = current[0]!.id;
      same = true;
    } else if (candidates.length || characters.some((c) => c.id === id) || recorded.length) {
      error(entry.id, "可能是已有人物。请选择同一人物、不同人物，或移出这一批。");
      continue;
    }
    if (
      !safeId(id) ||
      (same && !characters.some((c) => c.id === id)) ||
      (!same && files.some((f) => f.path.startsWith(`characters/${id}/`)))
    ) {
      error(entry.id, same ? "合并目标必须是已有角色。" : "不同人物必须使用尚不存在的角色目录。");
      continue;
    }
    if (!/^characters\/[^/]+\/.+\.md$/u.test(selection.targetFile)) continue;
    selection.targetFile = selection.targetFile.replace(
      /^characters\/[^/]+\//u,
      `characters/${id}/`,
    );
    if (same) mergeFiles.push(selection.targetFile);
    addBinding(entry.title, id);
    const path = `characters/${id}/meta.yaml`;
    const existing = metadata.get(path);
    const file = files.find((f) => f.path === path);
    const doc = parseDocument(
      existing?.content ?? file?.content ?? stringify({ id, displayName: entry.title }),
    );
    if (!file && work) doc.set("originWorkId", work.id);
    const prior = doc.get("referenceCharacters")
      ? normalizeReferenceCharacters(doc.toJS().referenceCharacters)
      : [];
    const next = prior.filter(
      (b) => b.referenceId !== catalog.referenceId || normalizeCharacterName(b.name) !== name,
    );
    next.push({ referenceId: catalog.referenceId, name: entry.title, materialHash });
    doc.set("referenceCharacters", doc.createNode(next));
    metadata.set(path, {
      path,
      baseline: file?.content ?? "",
      exists: !!file,
      content: doc.toString(),
      entryIds: [...(existing?.entryIds ?? []), entry.id],
    });
  }
  for (const [name, ids] of bindings)
    if (ids.size > 1)
      for (const entry of catalog.entries.filter(
        (e) =>
          e.materialKind === "characters" &&
          normalizeCharacterName(e.title) === name &&
          selections.some((s) => s.entryId === e.id),
      ))
        error(entry.id, "同一来源人物已对应另一个角色，不能另建重复对应。");
  const known = new Set(
    [...characters.map((c) => c.id), ...metadata.keys()].map((id) =>
      id.startsWith("characters/") ? id.split("/")[1]! : id,
    ),
  );
  for (const selection of selections.slice(0, 64)) {
    const entry = catalog.entries.find((e) => e.id === selection.entryId);
    if (entry?.materialKind !== "relationships") continue;
    const resolved = (selection.relationshipCharacters ?? []).map((person) => {
      const candidates = bindings.get(normalizeCharacterName(person.name));
      return {
        name: person.name,
        characterId: person.characterId || (candidates?.size === 1 ? [...candidates][0]! : ""),
      };
    });
    if (
      !resolved.length ||
      resolved.some((p) => !known.has(p.characterId)) ||
      !known.has(selection.targetFile.split("/")[1] ?? "")
    ) {
      error(
        entry.id,
        "关系人物尚未解决：请指定所属角色与每个对方人物，或移出条目。",
        "unresolvedRelationship",
      );
      continue;
    }
    selection.relationshipCharacters = resolved;
    relationships.push({ targetFile: selection.targetFile, characters: resolved });
  }
  const evidence: CharacterAdoptionEvidence = {
    selections,
    registryFingerprint: view.fingerprint,
    metadata: [...metadata.values()],
    mergeFiles,
    relationships,
  };
  const characterPreflight: ReferenceCharacterPreflight = {
    matches,
    characters: characters.map((c) => ({ id: c.id, name: c.name })),
    unresolvedRelationships: issues
      .filter((i) => i.code === "unresolvedRelationship")
      .flatMap((i) => i.entryIds),
  };
  return { selections, issues, evidence, characterPreflight };
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function safeId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/u.test(value);
}
