import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { inspectWorkRegistryFiles } from "@oh-awesome-novel/core";
import {
  createWorkRegistryChangeProposal,
  createWorkspaceProjection,
  NOVEL_REFERENCE_PROJECTION_RULES,
  readRepositoryBaseline,
} from "@oh-awesome-novel/tools";
import type { PendingActionStore } from "@oh-awesome-novel/tools";

export function createWorkRegistryHandlers(input: {
  getWorkspaceRoot(): string;
  getStore(root: string): Promise<PendingActionStore>;
}) {
  const capture = (root: string) =>
    createWorkspaceProjection({ workspaceRoot: root, rules: NOVEL_REFERENCE_PROJECTION_RULES });
  const fail = (context: Context, error: unknown) =>
    context.json(
      {
        error: {
          code: "invalid_work_registry",
          message: error instanceof Error ? error.message : String(error),
        },
      },
      400,
    );
  return {
    async read(context: Context): Promise<Response> {
      try {
        return context.json(
          inspectWorkRegistryFiles((await capture(input.getWorkspaceRoot())).baselineFiles),
        );
      } catch (error) {
        return fail(context, error);
      }
    },
    async propose(context: Context): Promise<Response> {
      try {
        const root = input.getWorkspaceRoot();
        if (Number(context.req.header("content-length") ?? 0) > 256000)
          throw new Error("请求过大。");
        const raw = await context.req.text();
        if (raw.length > 256000) throw new Error("请求过大。");
        const body: unknown = JSON.parse(raw);
        if (
          !body ||
          typeof body !== "object" ||
          Array.isArray(body) ||
          Object.keys(body).some(
            (key) => !["expectedWorkspaceRoot", "fingerprint", "edit"].includes(key),
          )
        )
          throw new Error("请求字段无效。");
        const value = body as Record<string, unknown>;
        if (value.expectedWorkspaceRoot !== root) throw new Error("工作区已切换，请重新载入。");
        const projection = await capture(root);
        const id = `pa_${randomUUID()}`;
        const candidate = createWorkRegistryChangeProposal({
          edit: value.edit,
          expectedFingerprint: String(value.fingerprint),
          baselineFiles: projection.baselineFiles,
          repository: await readRepositoryBaseline(root),
          sessionId: id,
        });
        if (!candidate) throw new Error("作品清单与归属没有改动。");
        await projection.assertFresh();
        if (root !== input.getWorkspaceRoot()) throw new Error("工作区已切换，请重新载入。");
        const action = await (
          await input.getStore(root)
        ).proposeCandidate({
          id,
          candidate,
          title: "登记作品与对象归属",
          description: "审阅作品清单及角色、世界对象的归属，接受后才写入正式文件。",
        });
        return context.json({ pendingActionId: action.id });
      } catch (error) {
        return fail(context, error);
      }
    },
  };
}
