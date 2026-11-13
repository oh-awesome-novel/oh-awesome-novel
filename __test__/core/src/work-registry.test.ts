import { describe, it, expect } from "vite-plus/test";
import {
  normalizeWorkRegistry,
  normalizeReferenceCharacters,
  normalizeCharacterName,
  validateWorkRegistryReferences,
  evaluateProjectHealth,
} from "@oh-awesome-novel/core";
const works = {
  path: "works.yaml",
  content: "version: 1\nworks:\n  - id: a\n    title: 甲作\n  - id: b\n    title: 乙作\n",
};
const meta = (id: string, origin = "") => ({
  path: `characters/${id}/meta.yaml`,
  content: `id: ${id}\ndisplayName: ${id}\n${origin ? `originWorkId: ${origin}\n` : ""}`,
});
describe("author-owned work registry", () => {
  it("allows absent or original attribution and reports only an informational multi-work reminder", () => {
    expect(() =>
      validateWorkRegistryReferences([meta("original"), meta("marked", "original")]),
    ).not.toThrow();
    const files = [
      works,
      meta("a1", "a"),
      meta("a2", "a"),
      meta("b1", "b"),
      meta("b2", "b"),
      meta("oc"),
      meta("oc2", "original"),
    ];
    expect(() => validateWorkRegistryReferences(files)).not.toThrow();
    expect(
      evaluateProjectHealth({ files }).issues.filter((i) => i.id.startsWith("work-attribution")),
    ).toEqual([expect.objectContaining({ path: "characters/oc/meta.yaml", severity: "info" })]);
    expect(
      evaluateProjectHealth({ files: [meta("oc")] }).issues.some((i) =>
        i.id.startsWith("work-attribution"),
      ),
    ).toBe(false);
  });
  it("rejects duplicate work ids, ambiguous reference ownership, unknown fields and dangling origins", () => {
    for (const invalid of [
      {
        version: 1,
        works: [
          { id: "a", title: "A" },
          { id: "a", title: "B" },
        ],
      },
      {
        version: 1,
        works: [
          { id: "a", title: "A", referenceIds: ["r"] },
          { id: "b", title: "B", referenceIds: ["r"] },
        ],
      },
      { version: 1, works: [{ id: "original", title: "A" }] },
      { version: 1, works: [{ id: "a", title: "A", arbitrary: true }] },
    ])
      expect(() => normalizeWorkRegistry(invalid)).toThrow();
    expect(() => validateWorkRegistryReferences([works, meta("x", "missing")])).toThrow(/不存在/);
    expect(() => validateWorkRegistryReferences([meta("x", "a")])).toThrow(/不存在/);
  });
  it("uses only Unicode compatibility, case and whitespace normalization; preserves source identities", () => {
    expect(normalizeCharacterName("  ＡＬＩＣＥ　  Smith ")).toBe("alice smith");
    expect(normalizeCharacterName("愛麗絲")).not.toBe(normalizeCharacterName("爱丽丝"));
    const binding = { referenceId: "ref-a", name: " Alice ", materialHash: "a".repeat(64) };
    expect(() => normalizeReferenceCharacters([binding])).toThrow();
    expect(() =>
      normalizeReferenceCharacters([
        { ...binding, name: "Alice" },
        { ...binding, name: "Ａｌｉｃｅ" },
      ]),
    ).toThrow(/重复/);
    const record = `referenceCharacters:\n  - referenceId: ref-a\n    name: Alice\n    materialHash: ${"a".repeat(64)}\n`;
    expect(() =>
      validateWorkRegistryReferences([
        { ...meta("a"), content: meta("a").content + record },
        { ...meta("b"), content: meta("b").content + record },
      ]),
    ).toThrow(/多个角色/);
  });
});
