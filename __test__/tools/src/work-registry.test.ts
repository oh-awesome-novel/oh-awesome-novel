import { it, expect } from "vite-plus/test";
import { inspectWorkRegistryFiles } from "@oh-awesome-novel/core";
import {
  createWorkRegistryChangeProposal,
  validateFinalDocument,
  validateFinalObjectTreeReferences,
} from "@oh-awesome-novel/tools";
const baseline = [
  {
    path: "characters/alice/meta.yaml",
    content: "# 作者注释\nid: alice\ndisplayName: Alice\naliases: [A]\n",
    mode: 0o644,
  },
  { path: "world/city/gate.md", content: "# Gate\n\nExisting author text.\n", mode: 0o644 },
];
const registry = { version: 1 as const, works: [{ id: "a", title: "A" }] };
const propose = (edit: unknown, files = baseline) =>
  createWorkRegistryChangeProposal({
    edit,
    expectedFingerprint: inspectWorkRegistryFiles(files).fingerprint,
    baselineFiles: files,
    repository: { repositoryId: "repo-1", branch: "main", head: "abc123" },
    sessionId: "pa_test",
  });
it("creates one reviewable registry/attribution candidate while retaining comments and the object body", () => {
  const candidate = propose({
    registry,
    attributions: baseline.map((f) => ({ path: f.path, originWorkId: "a" })),
  })!;
  expect(candidate.changes.map((c) => c.path)).toEqual([
    "characters/alice/meta.yaml",
    "works.yaml",
    "world/city/gate.md",
  ]);
  const meta = candidate.changes.find((c) => c.path.includes("meta"))!;
  expect(meta.operation !== "delete" && meta.draft.content).toContain("# 作者注释");
  const world = candidate.changes.find((c) => c.path.endsWith(".md"))!;
  expect(world.operation !== "delete" && world.draft.content).toContain(baseline[1]!.content);
  for (const c of candidate.changes)
    if (c.operation !== "delete")
      expect(() => validateFinalDocument({ path: c.path, content: c.draft.content })).not.toThrow();
  expect(baseline[0]!.content).not.toContain("originWorkId");
});
it("rejects unknown origins and deleting a work referenced by unchanged objects", () => {
  expect(() =>
    propose({ registry, attributions: [{ path: baseline[0]!.path, originWorkId: "missing" }] }),
  ).toThrow();
  expect(() =>
    validateFinalDocument({
      path: "works.yaml",
      content: "version: 1\nworks: [{id: a, title: A}, {id: a, title: B}]\n",
    }),
  ).toThrow();
  expect(() =>
    validateFinalDocument({
      path: baseline[0]!.path,
      content:
        baseline[0]!.content +
        "referenceCharacters: [{referenceId: a, name: Alice, materialHash: bad}]\n",
    }),
  ).toThrow();
  expect(() =>
    validateFinalObjectTreeReferences({
      baselineFiles: [
        { path: "works.yaml", content: "version: 1\nworks: [{id: a, title: A}]\n" },
        { ...baseline[0]!, content: baseline[0]!.content + "originWorkId: a\n" },
      ],
      changes: [{ path: "works.yaml", operation: "delete" }],
    }),
  ).toThrow(/不存在/);
});
