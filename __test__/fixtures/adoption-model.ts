import { MockLanguageModelV4 } from "ai/test";
export function adoptionModel() {
  return new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      const text = prompt
        .filter((p) => p.role === "user")
        .map((p) =>
          typeof p.content === "string"
            ? p.content
            : p.content.map((v) => (v.type === "text" ? v.text : "")).join(""),
        )
        .join("");
      const context = JSON.parse(
        text
          .split("<selected_story_material_and_workspace_baselines>")[1]!
          .split("</selected_story_material_and_workspace_baselines>")[0]!,
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              targets: context.targets.map(
                (target: {
                  targetId: string;
                  materialKind: string;
                  targetExisted: boolean;
                  baseline: string;
                  selectedEntries: Array<{ content: string }>;
                  confirmedCharacters?: Array<{ characterId: string }>;
                }) => ({
                  targetId: target.targetId,
                  decision: target.targetExisted ? "update" : "create",
                  reason: "保留已有说法并追加所选来源",
                  draft:
                    target.materialKind === "relationships"
                      ? `relationships:\n${target.confirmedCharacters!.map((c) => `  ${c.characterId}:\n    type: acquaintance\n    notes: 作者确认的关系`).join("\n")}\n`
                      : `${target.baseline || "# 人物材料\n"}\n${context.referenceId}: ${target.selectedEntries.map((e) => e.content).join("\n")}\n`,
                }),
              ),
            }),
          },
        ],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 20, noCache: 20, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 20, text: 20, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
}
