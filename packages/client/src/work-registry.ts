import {
  normalizeWorkRegistry,
  normalizeWorkRegistryEdit,
  isAttributionPath,
  validateWorkId,
} from "@oh-awesome-novel/core/work-registry";
import type { WorkRegistryView, WorkRegistryEdit } from "@oh-awesome-novel/core";
export type {
  RegisteredWork,
  WorkRegistry,
  WorkAttribution,
  WorkRegistryView,
  WorkRegistryEdit,
} from "@oh-awesome-novel/core";
export interface WorkRegistryClientMethods {
  getWorkRegistry(): Promise<WorkRegistryView>;
  proposeWorkRegistry(input: {
    expectedWorkspaceRoot: string;
    fingerprint: string;
    edit: WorkRegistryEdit;
  }): Promise<{ pendingActionId: string }>;
}
export function createWorkRegistryClientMethods(
  request: (path: string, init?: { method?: "GET" | "POST"; body?: unknown }) => Promise<unknown>,
): WorkRegistryClientMethods {
  return {
    async getWorkRegistry() {
      const value = await request("/api/workspace/work-registry");
      if (
        !record(value) ||
        Object.keys(value).some((k) => !["registry", "attributions", "fingerprint"].includes(k)) ||
        typeof value.fingerprint !== "string" ||
        !/^[a-f0-9]{64}$/u.test(value.fingerprint) ||
        !Array.isArray(value.attributions) ||
        !value.attributions.every(
          (item) =>
            record(item) &&
            Object.keys(item).every((k) => ["path", "label", "originWorkId"].includes(k)) &&
            typeof item.path === "string" &&
            isAttributionPath(item.path) &&
            typeof item.label === "string" &&
            (item.originWorkId === undefined || typeof item.originWorkId === "string"),
        )
      )
        throw new Error("作品清单响应无效。");
      if (value.registry !== null) normalizeWorkRegistry(value.registry);
      const paths = value.attributions.map((item) => (item as { path: string }).path);
      if (new Set(paths).size !== paths.length) throw new Error("作品清单响应有重复对象。");
      for (const item of value.attributions)
        if (item.originWorkId !== undefined) validateWorkId(item.originWorkId);
      return structuredClone(value) as unknown as WorkRegistryView;
    },
    async proposeWorkRegistry(input) {
      if (
        !input ||
        typeof input.expectedWorkspaceRoot !== "string" ||
        !input.expectedWorkspaceRoot ||
        !/^[a-f0-9]{64}$/u.test(input.fingerprint) ||
        Object.keys(input).some(
          (key) => !["expectedWorkspaceRoot", "fingerprint", "edit"].includes(key),
        )
      )
        throw new Error("作品登记请求无效。");
      normalizeWorkRegistryEdit(input.edit);
      const value = await request("/api/workspace/work-registry/propose", {
        method: "POST",
        body: input,
      });
      if (
        !record(value) ||
        Object.keys(value).length !== 1 ||
        typeof value.pendingActionId !== "string" ||
        !/^pa_[a-f0-9-]+$/u.test(value.pendingActionId)
      )
        throw new Error("作品登记审批响应无效。");
      return { pendingActionId: value.pendingActionId };
    },
  };
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
