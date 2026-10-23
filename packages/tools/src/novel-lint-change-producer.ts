import { applyNovelLintReplacements } from '@oh-awesome-novel/core';
import type { LintReplacement } from '@oh-awesome-novel/core';
import type { CandidateFileSnapshot, RepositoryBaseline, WorkspaceEditCapability } from './candidate-change-set';
import { createCandidateChangeSetBuilder, finalizeDeterministicChangeProposal } from './deterministic-change-producers';
import { createWorkspaceChangePolicy } from './workspace-change-policy';
export const NOVEL_LINT_PRODUCER = 'novel-lint';
export function novelLintCapability(path: string): WorkspaceEditCapability {
  if (/^chapters\/[A-Za-z0-9][A-Za-z0-9._/-]*\.md$/u.test(path)) return 'chapter.edit';
  if (/^characters\/[A-Za-z0-9][A-Za-z0-9_-]*\/[A-Za-z0-9][A-Za-z0-9_-]*\.md$/u.test(path)) return 'character.edit';
  if (/^world\/[A-Za-z0-9][A-Za-z0-9._/-]*\.md$/u.test(path)) return 'world.edit';
  throw new Error('LINT supports manuscript, character and world Markdown only.');
}
export function createNovelLintChangeProposal(input: { path:string; sourceHash:string; replacements:LintReplacement[];
  repository:RepositoryBaseline; baselineFiles:readonly CandidateFileSnapshot[]; sessionId:string }) {
  const capability = novelLintCapability(input.path);
  if (input.baselineFiles.length !== 1 || input.baselineFiles[0]?.path !== input.path) throw new Error('LINT requires exactly one host-selected source.');
  const source = input.baselineFiles[0].content;
  const content = applyNovelLintReplacements(source,input.sourceHash,input.replacements);
  const policy = createWorkspaceChangePolicy({capability,exactWritablePaths:[input.path]});
  const builder = createCandidateChangeSetBuilder({sessionId:input.sessionId,producer:NOVEL_LINT_PRODUCER,capability,
    repository:input.repository,baselineFiles:input.baselineFiles});
  builder.write(input.path,content);
  return finalizeDeterministicChangeProposal({builder,policy,allowedTargets:[input.path],
    origin:{kind:'novelLint',targetPath:input.path,sourceHash:input.sourceHash}});
}
