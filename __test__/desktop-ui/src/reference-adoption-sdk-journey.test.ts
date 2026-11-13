// @vitest-environment happy-dom
import { vi, it, expect } from "vite-plus/test";
await vi.hoisted(async () => {
  const http = await import("undici");
  for (const key of ["Headers", "Request", "Response", "fetch"] as const)
    vi.stubGlobal(key, http[key]);
});
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { MockLanguageModelV4 } from "ai/test";
import { adoptionJourneyFixture } from "../../fixtures/reference-adoption";
import { useReferenceMaterialAdoption } from "../../../apps/desktop-ui/src/composables/useReferenceMaterialAdoption";
import Panel from "../../../apps/desktop-ui/src/components/workspace/reference/ReferenceMaterialAdoptionPanel.vue";

it("1410: filters, remaps, previews, promotes and accepts through Desktop, SDK and the real HTTP backend", async () => {
  const model = new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      const context = JSON.parse(
        prompt
          .filter((p) => p.role === "user")
          .map((p) =>
            typeof p.content === "string"
              ? p.content
              : p.content.map((v) => (v.type === "text" ? v.text : "")).join(""),
          )
          .join("")
          .split("<selected_story_material_and_workspace_baselines>")[1]!
          .split("</selected_story_material_and_workspace_baselines>")[0]!,
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              targets: context.targets.map((t: { targetId: string; targetExisted: boolean }) => ({
                targetId: t.targetId,
                decision: t.targetExisted ? "update" : "create",
                reason: "采用选中的材料",
                draft: "# 雨门\n\n保留来源中的代价。\n",
              })),
            }),
          },
        ],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 20 }, outputTokens: { total: 20 } },
        warnings: [],
      };
    },
  });
  const f = await adoptionJourneyFixture({ resolveModel: () => model });
  let ui: ReturnType<typeof mount> | undefined;
  try {
    const referenceId = await f.publish("旅程来源");
    const flow = useReferenceMaterialAdoption({ client: f.client });
    await flow.load(referenceId);
    ui = mount(
      defineComponent({
        components: { Panel },
        setup: () => ({ ...flow }),
        template:
          '<Panel :catalog="catalog" :target-suggestions="targetSuggestions" :preflight="preflight" :preview="preview" :pending-action="pendingAction" :no-change-decisions="noChangeDecisions" :loading="loading" :preflighting="preflighting" :previewing="previewing" :confirming="confirming" :error="error" @selection-change="clearPreflight" @preflight="requestPreflight" @generate="requestPreflightedPreview" @confirm="confirm" />',
      }),
    );
    await ui.get('input[type="search"]').setValue("world projected");
    await ui.get('input[type="checkbox"]').setValue(true);
    const target = "world/journey/rain.md";
    await ui.get('.material-target-fields input[type="text"]').setValue(target);
    await ui.get("form").trigger("submit");
    await vi.waitFor(() => expect(flow.preflight.value?.status).toBe("ready"));
    expect(model.doGenerateCalls).toHaveLength(0);
    await ui.get(".material-preflight button").trigger("click");
    await vi.waitFor(() =>
      expect(ui!.find('[aria-label="采纳预览"] pre').exists(), flow.error.value).toBe(true),
    );
    expect(ui.get("pre").text()).toContain(target);
    await expect(readFile(join(f.root, target))).rejects.toThrow();
    await ui.get('[aria-label="采纳预览"] button.primary-button').trigger("click");
    await vi.waitFor(() => expect(flow.pendingAction.value?.status).toBe("pending"));
    await expect(readFile(join(f.root, target))).rejects.toThrow();
    await f.client.acceptPendingAction(flow.pendingAction.value!.id);
    expect(await readFile(join(f.root, target), "utf8")).toContain("雨门");
    expect(model.doGenerateCalls).toHaveLength(1);
  } finally {
    ui?.unmount();
    await f.backend.close();
    await rm(f.root, { recursive: true, force: true });
  }
}, 30000);
