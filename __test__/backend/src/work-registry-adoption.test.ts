import { it, expect } from "vite-plus/test";
import { mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { startNovelHttpBackend } from "@oh-awesome-novel/backend";
import { createOanClient } from "@oh-awesome-novel/client";
import { parse } from "yaml";
import { adoptionJourneyFixture } from "../../fixtures/reference-adoption";
import { adoptionModel } from "../../fixtures/adoption-model";
it("blocks unresolved relations before the model, resolves recorded counterparts and rejects stale approval after restart", async () => {
  const model = adoptionModel(),
    f = await adoptionJourneyFixture({ resolveModel: () => model });
  let stopped = false;
  let restarted: Awaited<ReturnType<typeof startNovelHttpBackend>> | undefined;
  try {
    const ref = await f.publish("人物与关系");
    const { catalog } = await f.client.getReferenceMaterialAdoptionCatalog(ref);
    const character = catalog.entries.find((e) => e.materialKind === "characters")!,
      relationship = catalog.entries.find((e) => e.materialKind === "relationships")!;
    const view = await f.client.getWorkRegistry();
    const work = await f.client.proposeWorkRegistry({
      expectedWorkspaceRoot: f.root,
      fingerprint: view.fingerprint,
      edit: {
        registry: { version: 1, works: [{ id: "a", title: "A", referenceIds: [ref] }] },
        attributions: [],
      },
    });
    await f.client.acceptPendingAction(work.pendingActionId);
    const first = await f.client.createReferenceMaterialAdoptionPreview(ref, {
      catalogFingerprint: catalog.fingerprint,
      selections: [{ entryId: character.id, targetFile: "characters/alice/summary.md" }],
    });
    if (first.status !== "ready") throw new Error("missing preview");
    const p = await f.client.createReferenceMaterialAdoptionPendingAction(ref, first.preview.id, {
      fingerprint: first.preview.fingerprint,
    });
    await f.client.acceptPendingAction(p.pendingAction.id);
    await mkdir(join(f.root, "characters/bob"), { recursive: true });
    await writeFile(join(f.root, "characters/bob/meta.yaml"), "id: bob\ndisplayName: Bob\n");
    const selection = { entryId: relationship.id, targetFile: "characters/bob/relationships.yaml" };
    expect(
      (
        await f.client.preflightReferenceMaterialAdoption(ref, {
          catalogFingerprint: catalog.fingerprint,
          selections: [selection],
        })
      ).preflight.characterPreflight?.unresolvedRelationships,
    ).toEqual([relationship.id]);
    await expect(
      f.client.createReferenceMaterialAdoptionPreview(ref, {
        catalogFingerprint: catalog.fingerprint,
        selections: [selection],
      }),
    ).rejects.toThrow(/关系人物/);
    expect(model.doGenerateCalls).toHaveLength(1);
    const resolved = {
      ...selection,
      relationshipCharacters: [{ name: character.title, characterId: "" }],
    };
    expect(
      (
        await f.client.preflightReferenceMaterialAdoption(ref, {
          catalogFingerprint: catalog.fingerprint,
          selections: [resolved],
        })
      ).preflight.status,
    ).toBe("ready");
    const preview = await f.client.createReferenceMaterialAdoptionPreview(ref, {
      catalogFingerprint: catalog.fingerprint,
      selections: [resolved],
    });
    if (preview.status !== "ready") throw new Error("missing relation preview");
    const pending = await f.client.createReferenceMaterialAdoptionPendingAction(
      ref,
      preview.preview.id,
      { fingerprint: preview.preview.fingerprint },
    );
    await expect(readFile(join(f.root, selection.targetFile))).rejects.toThrow();
    await f.backend.close();
    stopped = true;
    restarted = await startNovelHttpBackend({
      workspaceRoot: f.root,
      globalConfigDir: join(f.root, ".global"),
    });
    const client = createOanClient({ backendBaseUrl: restarted.url });
    const metaPath = join(f.root, "characters/alice/meta.yaml"),
      original = await readFile(metaPath, "utf8");
    await writeFile(metaPath, original + "# edited after preview\n");
    await expect(client.acceptPendingAction(pending.pendingAction.id)).rejects.toThrow(
      /stale|changed|过期/i,
    );
    await expect(readFile(join(f.root, selection.targetFile))).rejects.toThrow();
    await writeFile(metaPath, original);
    await client.acceptPendingAction(pending.pendingAction.id);
    expect(
      parse(await readFile(join(f.root, selection.targetFile), "utf8")).relationships.alice,
    ).toBeDefined();
    expect(model.doGenerateCalls).toHaveLength(2);
  } finally {
    await restarted?.close();
    if (!stopped) await f.backend.close();
    await rm(f.root, { recursive: true, force: true });
  }
}, 30000);
it("1410: reports mixed YAML targets and unreadable files without a model or registry", async () => {
  const model = adoptionModel(),
    f = await adoptionJourneyFixture({ resolveModel: () => model });
  try {
    const ref = await f.publish("Preflight");
    const { catalog } = await f.client.getReferenceMaterialAdoptionCatalog(ref);
    const world = catalog.entries.find((e) => e.materialKind === "world")!;
    await mkdir(join(f.root, "world/test"), { recursive: true });
    await symlink(join(f.root, ".oan/config.yaml"), join(f.root, "world/test/link.md"));
    const result = await f.client.preflightReferenceMaterialAdoption(ref, {
      catalogFingerprint: catalog.fingerprint,
      selections: [{ entryId: world.id, targetFile: "world/test/link.md" }],
    });
    expect(result.preflight.issues.some((i) => i.code === "targetUnreadable")).toBe(true);
    const timeline = catalog.entries.filter((e) => e.materialKind === "timeline");
    expect(timeline).toHaveLength(2);
    const mixed = await f.client.preflightReferenceMaterialAdoption(ref, {
      catalogFingerprint: catalog.fingerprint,
      selections: timeline.map((e, i) => ({
        entryId: e.id,
        targetFile: "timeline/events.yaml",
        targetPath: i ? "arcs" : "events",
      })),
    });
    expect(mixed.preflight.issues.some((i) => i.code === "mixedTarget")).toBe(true);
    expect(model.doGenerateCalls).toHaveLength(0);
  } finally {
    await f.backend.close();
    await rm(f.root, { recursive: true, force: true });
  }
}, 30000);
