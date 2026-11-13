// @vitest-environment happy-dom
import { vi, it, expect } from "vite-plus/test";
await vi.hoisted(async () => {
  const http = await import("undici");
  for (const key of ["Headers", "Request", "Response", "fetch"] as const)
    vi.stubGlobal(key, http[key]);
});
import { defineComponent } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import type { OanClient } from "@oh-awesome-novel/client";
import { adoptionJourneyFixture } from "../../fixtures/reference-adoption";
import { adoptionModel } from "../../fixtures/adoption-model";
import WorkRegistryPanel from "../../../apps/desktop-ui/src/components/workspace/WorkRegistryPanel.vue";
import PlayGuidedStartWizard from "../../../apps/desktop-ui/src/components/play/launch/PlayGuidedStartWizard.vue";
import PendingActionCard from "../../../apps/desktop-ui/src/components/agent-checkpoint/PendingActionCard.vue";
import Panel from "../../../apps/desktop-ui/src/components/workspace/reference/ReferenceMaterialAdoptionPanel.vue";
import { useReferenceMaterialAdoption } from "../../../apps/desktop-ui/src/composables/useReferenceMaterialAdoption";

async function accept(client: OanClient, id: string) {
  const action = (await client.listPendingActions()).pendingActions.find((a) => a.id === id)!;
  let done = false;
  const card = mount(PendingActionCard, {
    props: {
      action,
      onAccept: async () => {
        await client.acceptPendingAction(id);
        done = true;
      },
    },
  });
  try {
    await card
      .findAll("button")
      .find((b) => b.text() === "Accept")!
      .trigger("click");
    await vi.waitFor(() => expect(done).toBe(true));
  } finally {
    card.unmount();
  }
}
function mountAdoption(client: OanClient) {
  const flow = useReferenceMaterialAdoption({ client });
  const ui = mount(
    defineComponent({
      components: { Panel },
      setup: () => ({ ...flow }),
      template:
        '<Panel :catalog="catalog" :target-suggestions="targetSuggestions" :preflight="preflight" :preview="preview" :pending-action="pendingAction" :no-change-decisions="noChangeDecisions" :loading="loading" :preflighting="preflighting" :previewing="previewing" :confirming="confirming" :error="error" @selection-change="clearPreflight" @preflight="requestPreflight" @generate="requestPreflightedPreview" @confirm="confirm" />',
    }),
  );
  return { flow, ui };
}
it("1530: registers two works, attributes four characters, accepts, then prefills the launch without review records", async () => {
  const f = await adoptionJourneyFixture();
  const wrappers: VueWrapper[] = [];
  try {
    for (const id of ["a1", "a2", "b1", "b2"]) {
      await mkdir(join(f.root, "characters", id), { recursive: true });
      await writeFile(
        join(f.root, "characters", id, "meta.yaml"),
        `id: ${id}\ndisplayName: ${id}\n`,
      );
      await writeFile(join(f.root, "characters", id, "summary.md"), `# ${id}\n角色内容。\n`);
    }
    const panel = mount(WorkRegistryPanel, { props: { workspaceRoot: f.root, api: f.client } });
    wrappers.push(panel);
    await vi.waitFor(() => expect(panel.find("form").exists()).toBe(true));
    for (const [id, title] of [
      ["a", "甲作"],
      ["b", "乙作"],
    ]) {
      await panel
        .findAll("button")
        .find((b) => b.text() === "添加作品")!
        .trigger("click");
      const row = panel.findAll(".work-row").at(-1)!;
      await row.findAll("input")[0]!.setValue(id);
      await row.findAll("input")[1]!.setValue(title);
    }
    for (const row of panel.findAll(".attribution-row"))
      await row.get("select").setValue(row.text().includes("characters/a") ? "a" : "b");
    await panel.get("form").trigger("submit");
    await vi.waitFor(() => expect(panel.text()).toContain("已创建审批"));
    await expect(readFile(join(f.root, "works.yaml"))).rejects.toThrow();
    await panel
      .findAll("button")
      .find((b) => b.text() === "审阅归属修改")!
      .trigger("click");
    await accept(f.client, panel.emitted("reviewPendingAction")![0]![0] as string);
    // Accepted data remains authoritative even if all disposable review data is cleaned up.
    await rm(join(f.root, ".workspace/change-engine"), { recursive: true, force: true });
    const wizard = mount(PlayGuidedStartWizard, {
      props: {
        purpose: "immersiveJourney",
        files: ["a1", "a2", "b1", "b2"].map((id) => ({
          name: id,
          path: `characters/${id}/summary.md`,
          type: "file" as const,
        })),
        api: f.client,
      },
    });
    wrappers.push(wizard);
    for (const row of wizard.findAll(".source-tree li"))
      await row.get('input[type="checkbox"]').setValue(true);
    await vi.waitFor(() =>
      expect(
        wizard
          .findAll(".work-label input")
          .map((input) => (input.element as HTMLInputElement).value),
      ).toEqual(["甲作", "甲作", "乙作", "乙作"]),
    );
    expect((await f.client.getWorkRegistry()).registry?.works).toHaveLength(2);
  } finally {
    wrappers.forEach((w) => w.unmount());
    await f.backend.close();
    await rm(f.root, { recursive: true, force: true });
  }
}, 30000);

it.each(["same", "different", "skip"] as const)(
  "1540: adopts A, resolves B as %s, and reviews/accepts only the chosen directory",
  async (choice) => {
    const model = adoptionModel();
    const f = await adoptionJourneyFixture({ resolveModel: () => model });
    let ui: VueWrapper | undefined;
    try {
      const a = await f.publish("甲来源"),
        b = await f.publish("乙来源");
      const initial = await f.client.getWorkRegistry();
      const registry = await f.client.proposeWorkRegistry({
        expectedWorkspaceRoot: f.root,
        fingerprint: initial.fingerprint,
        edit: {
          registry: {
            version: 1,
            works: [
              { id: "a", title: "甲作", referenceIds: [a] },
              { id: "b", title: "乙作", referenceIds: [b] },
            ],
          },
          attributions: [],
        },
      });
      await accept(f.client, registry.pendingActionId);
      const ca = (await f.client.getReferenceMaterialAdoptionCatalog(a)).catalog;
      const entryA = ca.entries.find((e) => e.materialKind === "characters")!;
      const first = await f.client.createReferenceMaterialAdoptionPreview(a, {
        catalogFingerprint: ca.fingerprint,
        selections: [{ entryId: entryA.id, targetFile: "characters/alice/summary.md" }],
      });
      if (first.status !== "ready") throw new Error("A preview missing");
      expect(first.preview.diff).toContain("originWorkId: a");
      await expect(readFile(join(f.root, "characters/alice/meta.yaml"))).rejects.toThrow();
      const pendingA = await f.client.createReferenceMaterialAdoptionPendingAction(
        a,
        first.preview.id,
        { fingerprint: first.preview.fingerprint },
      );
      await accept(f.client, pendingA.pendingAction.id);
      const before = await readFile(join(f.root, "characters/alice/summary.md"), "utf8");
      const mounted = mountAdoption(f.client);
      ui = mounted.ui;
      const flow = mounted.flow;
      await flow.load(b);
      await ui.get('input[type="search"]').setValue("characters projected");
      await ui.get('input[type="checkbox"]').setValue(true);
      await ui.get("form").trigger("submit");
      await vi.waitFor(() =>
        expect(flow.preflight.value?.status, flow.error.value).toBe("blocked"),
      );
      expect(ui.text()).toContain("可能是已有人物");
      expect(ui.get(".character-comparison").text()).toContain(before.trim());
      expect(model.doGenerateCalls).toHaveLength(1);
      if (choice === "skip") {
        await ui
          .findAll("button")
          .find((b) => b.text() === "本次不处理")!
          .trigger("click");
        expect(ui.get(".material-filter-summary").text()).toContain("已选 0 / 64");
        expect(model.doGenerateCalls).toHaveLength(1);
        return;
      }
      const decision = ui.get('[aria-label="人物裁定"]');
      await decision.setValue(choice);
      if (choice === "different") await ui.get('[aria-label="新角色 ID"]').setValue("alice-b");
      await ui
        .findAll("button")
        .find((b) => b.text() === "确认人物裁定")!
        .trigger("click");
      await ui.get("form").trigger("submit");
      await vi.waitFor(() => expect(flow.preflight.value?.status, flow.error.value).toBe("ready"));
      await ui.get(".material-preflight button").trigger("click");
      await vi.waitFor(() => expect(flow.preview.value, flow.error.value).toBeDefined());
      const target = choice === "same" ? "alice" : "alice-b";
      expect(
        flow.preview.value!.changes.every((c) => c.path.startsWith(`characters/${target}/`)),
      ).toBe(true);
      expect(flow.preview.value!.diff).toContain(`referenceId: ${b}`);
      expect(await readFile(join(f.root, "characters/alice/summary.md"), "utf8")).toBe(before);
      await ui.get('[aria-label="采纳预览"] button.primary-button').trigger("click");
      await vi.waitFor(() => expect(flow.pendingAction.value, flow.error.value).toBeDefined());
      await accept(f.client, flow.pendingAction.value!.id);
      const meta = parse(await readFile(join(f.root, `characters/${target}/meta.yaml`), "utf8"));
      expect(meta.originWorkId).toBe(choice === "same" ? "a" : "b");
      expect(
        meta.referenceCharacters.some((r: { referenceId: string }) => r.referenceId === b),
      ).toBe(true);
      if (choice === "same")
        expect(await readFile(join(f.root, "characters/alice/summary.md"), "utf8")).toContain(
          before.trim(),
        );
      else expect(await readFile(join(f.root, "characters/alice/summary.md"), "utf8")).toBe(before);
      const cb = (await f.client.getReferenceMaterialAdoptionCatalog(b)).catalog,
        eb = cb.entries.find((e) => e.materialKind === "characters")!;
      const repeat = await f.client.preflightReferenceMaterialAdoption(b, {
        catalogFingerprint: cb.fingerprint,
        selections: [{ entryId: eb.id, targetFile: "characters/wrong/summary.md" }],
      });
      expect(repeat.preflight.status).toBe("ready");
      expect(repeat.preflight.targets[0]?.targetFile).toBe(`characters/${target}/summary.md`);
      const prompt = JSON.stringify(model.doGenerateCalls.at(-1)!.prompt);
      expect(prompt).not.toContain("outline projected entry");
      expect(prompt).not.toContain("world projected entry");
      expect(prompt).not.toContain("他留下一个尚未解释的选择");
    } finally {
      ui?.unmount();
      await f.backend.close();
      await rm(f.root, { recursive: true, force: true });
    }
  },
  30000,
);

it("drops an in-flight registry read after switching workspaces", async () => {
  let resolve!: (value: unknown) => void;
  const api = {
    getWorkRegistry: vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValue({
        registry: { version: 1, works: [{ id: "b", title: "New workspace" }] },
        attributions: [],
        fingerprint: "b".repeat(64),
      }),
    proposeWorkRegistry: vi.fn(),
  };
  const panel = mount(WorkRegistryPanel, { props: { workspaceRoot: "/old", api } });
  try {
    await panel.setProps({ workspaceRoot: "/new" });
    await vi.waitFor(() => expect(panel.find(".work-row").exists()).toBe(true));
    resolve({
      registry: { version: 1, works: [{ id: "a", title: "Stale workspace" }] },
      attributions: [],
      fingerprint: "a".repeat(64),
    });
    await Promise.resolve();
    expect(panel.findAll(".work-row input")[1]!.element).toHaveProperty("value", "New workspace");
  } finally {
    panel.unmount();
  }
});
