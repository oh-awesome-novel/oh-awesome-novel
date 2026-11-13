import { it, expect } from "vite-plus/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { inspectReferenceCharacterAdoption, materialCharacterHash } from "@oh-awesome-novel/core";
import type { ReferenceMaterialAdoptionCatalog } from "@oh-awesome-novel/core";
const entry = {
  id: "run-old-person",
  materialKind: "characters" as const,
  title: " Alice  SMITH ",
  content: "First source claim.",
  details: [],
  assertionType: "fact" as const,
  confidence: "high" as const,
  evidenceRefs: ["e"],
  sourceFindingRefs: ["f"],
  sourcePath: "materials/characters.yaml" as const,
};
const catalog: ReferenceMaterialAdoptionCatalog = {
  schemaVersion: 1,
  referenceId: "ref-b",
  referenceTitle: "B",
  manifestRevision: 1,
  sourceChecksumSha256: "a".repeat(64),
  warningSummary: { count: 0, codes: [] },
  warnings: [],
  materialFiles: [],
  entries: [entry],
  fingerprint: "b".repeat(64),
};
it("matches aliases exactly, reuses name-based bindings across run IDs, and blocks changed material until reconfirmed", async () => {
  const root = await mkdtemp(join(tmpdir(), "character-match-"));
  try {
    await mkdir(join(root, "characters/alice"), { recursive: true });
    await writeFile(
      join(root, "works.yaml"),
      "version: 1\nworks: [{id: b, title: B, referenceIds: [ref-b]}]\n",
    );
    const meta = { id: "alice", displayName: "Other name", aliases: ["ＡＬＩＣＥ　ＳＭＩＴＨ"] };
    await writeFile(join(root, "characters/alice/meta.yaml"), stringify(meta));
    const selection = { entryId: entry.id, targetFile: "characters/new/summary.md" };
    let result = await inspectReferenceCharacterAdoption(root, catalog, [selection]);
    expect(result?.issues[0]?.code).toBe("characterDecisionRequired");
    expect(result?.characterPreflight.matches[0]?.matches[0]?.characterId).toBe("alice");
    await writeFile(
      join(root, "characters/alice/meta.yaml"),
      stringify({
        ...meta,
        referenceCharacters: [
          {
            referenceId: "ref-b",
            name: entry.title.trim(),
            materialHash: materialCharacterHash(entry),
          },
        ],
      }),
    );
    const revised = { ...catalog, entries: [{ ...entry, id: "run-new-person" }] };
    result = await inspectReferenceCharacterAdoption(root, revised, [
      { ...selection, entryId: "run-new-person" },
    ]);
    expect(result?.issues).toEqual([]);
    expect(result?.selections[0]?.targetFile).toBe("characters/alice/summary.md");
    const changed = {
      ...revised,
      entries: [{ ...revised.entries[0]!, content: "Changed source claim." }],
    };
    result = await inspectReferenceCharacterAdoption(root, changed, [
      { ...selection, entryId: "run-new-person" },
    ]);
    expect(result?.characterPreflight.matches[0]?.stale).toBe(true);
    expect(result?.issues).not.toHaveLength(0);
    result = await inspectReferenceCharacterAdoption(root, changed, [
      {
        ...selection,
        entryId: "run-new-person",
        characterDecision: {
          kind: "same",
          characterId: "alice",
          materialHash: materialCharacterHash(changed.entries[0]!),
        },
      },
    ]);
    expect(result?.issues).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("leaves a workspace without registry or bindings on the unchanged adoption path", async () => {
  const root = await mkdtemp(join(tmpdir(), "character-match-legacy-"));
  try {
    await expect(
      inspectReferenceCharacterAdoption(root, catalog, [
        { entryId: entry.id, targetFile: "characters/new/summary.md" },
      ]),
    ).resolves.toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
