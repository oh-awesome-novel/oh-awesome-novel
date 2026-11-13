import { parseDocument, stringify } from "yaml";
import { inspectWorkRegistryFiles, normalizeWorkRegistryEdit } from "@oh-awesome-novel/core";
import type { CandidateFileSnapshot, RepositoryBaseline } from "./candidate-change-set";
import { createCandidateChangeSetBuilder } from "./deterministic-change-producers";
import { validateFinalObjectTreeReferences } from "./final-object-tree-validator";
import {
  createWorkspaceChangePolicy,
  validateCandidateChangeSetAgainstPolicy,
} from "./workspace-change-policy";

export function setObjectWorkAttribution(
  path: string,
  source: string,
  originWorkId: string | null,
): string {
  if (path.endsWith(".md")) {
    const match = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/u.exec(source);
    const doc = parseDocument(match?.[1] ?? "{}");
    if (doc.errors.length) throw new Error("世界对象 frontmatter 无效。");
    if (originWorkId === null) {
      if (!match) return source;
      doc.delete("originWorkId");
    } else doc.set("originWorkId", originWorkId);
    return `---\n${doc.toString()}---\n${match ? source.slice(match[0].length) : source}`;
  }
  const doc = parseDocument(source);
  if (doc.errors.length) throw new Error("对象 YAML 无效。");
  if (originWorkId === null) doc.delete("originWorkId");
  else doc.set("originWorkId", originWorkId);
  return doc.toString();
}
export function createWorkRegistryChangeProposal(input: {
  edit: unknown;
  expectedFingerprint: string;
  baselineFiles: readonly CandidateFileSnapshot[];
  repository: RepositoryBaseline;
  sessionId: string;
}) {
  const edit = normalizeWorkRegistryEdit(input.edit);
  const current = inspectWorkRegistryFiles(input.baselineFiles);
  if (current.fingerprint !== input.expectedFingerprint)
    throw new Error("作品清单或归属已经变化，请重新载入。");
  const targets = ["works.yaml", ...edit.attributions.map((item) => item.path)];
  const builder = createCandidateChangeSetBuilder({
    sessionId: input.sessionId,
    producer: "work-registry",
    capability: "novel.multi-file-edit",
    repository: input.repository,
    baselineFiles: input.baselineFiles,
  });
  // Avoid reformatting the registry when only object attributions changed.
  if (JSON.stringify(current.registry) !== JSON.stringify(edit.registry))
    builder.write("works.yaml", stringify(edit.registry));
  for (const item of edit.attributions) {
    const file = input.baselineFiles.find((file) => file.path === item.path);
    if (!file) throw new Error(`归属对象不存在：${item.path}`);
    const old = current.attributions.find((row) => row.path === item.path)?.originWorkId ?? null;
    if (old !== item.originWorkId)
      builder.write(
        item.path,
        setObjectWorkAttribution(item.path, file.content, item.originWorkId),
      );
  }
  const candidate = builder.finalize();
  if (!candidate) return undefined;
  validateCandidateChangeSetAgainstPolicy(
    candidate,
    createWorkspaceChangePolicy({
      capability: "novel.multi-file-edit",
      exactWritablePaths: targets,
    }),
  );
  validateFinalObjectTreeReferences({
    baselineFiles: input.baselineFiles,
    changes: candidate.changes.map((change) => ({
      ...change,
      ...(change.operation === "delete" ? {} : { content: change.draft.content }),
    })),
  });
  return candidate;
}
