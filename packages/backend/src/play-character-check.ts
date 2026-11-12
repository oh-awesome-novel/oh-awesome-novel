import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { Context } from 'hono';
import { runPlayCharacterCheck } from '@oh-awesome-novel/agent';
import type { AiSdkProviderResolver } from '@oh-awesome-novel/agent';
import {
  PlayCharacterCheckError, buildPlayRehearsalStepCharacterCheckMaterial, buildPlayTurnCharacterCheckMaterial,
  createPlayCharacterCheckReport, isPlayCharacterCheckReportStale, listPlayTurnAttemptRecoveries,
  normalizePlayCharacterCheckReport, parsePlayCharacterCheckResponse, readPlaySessionFiles, readPlayTurnAttemptRecovery,
} from '@oh-awesome-novel/core';
import type {
  LlmProviderConfig, PlayCharacterCheckLens, PlayCharacterCheckMaterial, PlayCharacterCheckReport,
  PlayCharacterCheckTarget, PlaySession, PlayTurnAttempt,
} from '@oh-awesome-novel/core';

/**
 * Session-side store for in-character check reports. It sits next to the Play
 * message log under the git-ignored `.oan/sessions/`, so reports never enter a
 * turn artifact, an adoption evidence closure, an export or Git. Deleting the
 * file only removes past advice.
 */
const REPORT_DIRECTORY = ['.oan', 'sessions', '.play-checks'] as const;
const REPORT_FILE = 'character-checks.json';
const MAX_STORED_REPORTS = 60;

export type PlayCharacterCheckReportView = PlayCharacterCheckReport & { stale: boolean };

export async function readPlayCharacterCheckReports(workspaceRoot: string, sessionId: string): Promise<PlayCharacterCheckReport[]> {
  const file = await resolveReportFile(workspaceRoot, sessionId, false);
  let content: string;
  try { content = await readFile(file, 'utf-8'); }
  catch (error) { if (isErrorCode(error, 'ENOENT')) return []; throw error; }
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { return []; }
  const list = typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { reports?: unknown }).reports)
    ? (parsed as { reports: unknown[] }).reports : [];
  // Advice only: an unreadable entry is skipped instead of failing the session view.
  return list.flatMap((item) => {
    try {
      const report = normalizePlayCharacterCheckReport(item);
      return report.sessionId === sessionId ? [report] : [];
    } catch { return []; }
  });
}

const sameTarget = (a: PlayCharacterCheckTarget, b: PlayCharacterCheckTarget): boolean =>
  a.kind === 'turn' ? b.kind === 'turn' && a.turnId === b.turnId
    : b.kind === 'rehearsalStep' && a.attemptId === b.attemptId && a.stepRef === b.stepRef;

/** Whole-file replace through a sibling temp file, so a crash never leaves half a report. */
export async function savePlayCharacterCheckReport(workspaceRoot: string, report: PlayCharacterCheckReport): Promise<void> {
  const file = await resolveReportFile(workspaceRoot, report.sessionId, true);
  const previous = await readPlayCharacterCheckReports(workspaceRoot, report.sessionId);
  // A new check of the same target in the same lens supersedes the old one.
  const reports = [...previous.filter((item) => !(item.lens === report.lens && sameTarget(item.target, report.target))), report]
    .slice(-MAX_STORED_REPORTS);
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, reports }, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
  await rename(temporary, file);
}

async function readActiveAttempt(workspaceRoot: string, sessionId: string): Promise<PlayTurnAttempt | undefined> {
  const active = (await listPlayTurnAttemptRecoveries(workspaceRoot, sessionId)).filter((summary) => summary.classification === 'active');
  return active.length === 1 ? readPlayTurnAttemptRecovery(workspaceRoot, sessionId, active[0]!.attemptId) : undefined;
}

/** The Desktop's bounded read model knows message ids, not turn ids; the host resolves them. */
type RequestedTarget = PlayCharacterCheckTarget | { kind: 'turnMessage'; messageId: string };

function readTarget(value: unknown): RequestedTarget | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  const id = (input: unknown): input is string => typeof input === 'string' && input.length > 0 && input.length <= 300;
  if (v.kind === 'turn' && Object.keys(v).every((key) => ['kind', 'turnId'].includes(key)) && id(v.turnId)) {
    return { kind: 'turn', turnId: v.turnId };
  }
  if (v.kind === 'turnMessage' && Object.keys(v).every((key) => ['kind', 'messageId'].includes(key)) && id(v.messageId)) {
    return { kind: 'turnMessage', messageId: v.messageId };
  }
  if (v.kind === 'rehearsalStep' && Object.keys(v).every((key) => ['kind', 'attemptId', 'stepRef'].includes(key)) && id(v.attemptId) && id(v.stepRef)) {
    return { kind: 'rehearsalStep', attemptId: v.attemptId, stepRef: v.stepRef };
  }
  return undefined;
}

const readLens = (value: unknown): PlayCharacterCheckLens | undefined =>
  value === 'player' || value === 'director' ? value : undefined;

export function createPlayCharacterCheckHandlers(input: {
  getWorkspaceRoot(): string;
  /** True while a turn or another mutation holds the session. */
  isSessionBusy(root: string, id: string): boolean;
  getModelRuntime(): Promise<{ providerConfig?: LlmProviderConfig; resolveModel: AiSdkProviderResolver }>;
}) {
  async function loadMaterial(root: string, session: PlaySession, target: PlayCharacterCheckTarget, lens: PlayCharacterCheckLens):
    Promise<{ material: PlayCharacterCheckMaterial; attempt?: PlayTurnAttempt }> {
    if (target.kind === 'turn') return { material: buildPlayTurnCharacterCheckMaterial(session, target.turnId, { lens }) };
    const attempt = await readActiveAttempt(root, session.id);
    if (!attempt || attempt.id !== target.attemptId) throw new PlayCharacterCheckError('targetNotFound', '这次试演已经结束或不存在。');
    return { material: buildPlayRehearsalStepCharacterCheckMaterial(session, attempt, target.stepRef, { lens }), attempt };
  }
  return {
    /** Reports of one lens only: a Player view never receives Director-lens reports. */
    async list(context: Context, id: string): Promise<Response> {
      try {
        const lens = readLens(context.req.query('lens') ?? 'player');
        if (!lens) return context.json({ error: 'lens must be player or director.' }, 400);
        const root = input.getWorkspaceRoot();
        const session = await readPlaySessionFiles(root, id);
        const reports = (await readPlayCharacterCheckReports(root, id)).filter((report) => report.lens === lens);
        const attempt = reports.some((report) => report.target.kind === 'rehearsalStep') ? await readActiveAttempt(root, id) : undefined;
        return context.json({ reports: reports.map((report): PlayCharacterCheckReportView => ({ ...report, stale: isPlayCharacterCheckReportStale(report, session, attempt) })) });
      } catch (error) { return failure(context, error); }
    },
    /**
     * One click, at most one model call. Cancellation, a provider failure, a
     * malformed reply or a branch that moved meanwhile store nothing. The
     * session files and revision are never written.
     */
    async run(context: Context, id: string): Promise<Response> {
      try {
        const body: unknown = await context.req.json().catch(() => undefined);
        if (!body || typeof body !== 'object' || Array.isArray(body)) return context.json({ error: '检查请求无效。' }, 400);
        const request = body as Record<string, unknown>;
        const requested = readTarget(request.target);
        const lens = readLens(request.lens);
        if (Object.keys(request).some((key) => !['target', 'lens'].includes(key)) || !requested || !lens) {
          return context.json({ error: '检查请求需要 target 与 lens，且不能包含其他字段。' }, 400);
        }
        const root = input.getWorkspaceRoot();
        if (requested.kind !== 'rehearsalStep' && input.isSessionBusy(root, id)) {
          return context.json({ error: '另一个推演操作正在进行，请稍后再试。' }, 409);
        }
        const session = await readPlaySessionFiles(root, id);
        let target: PlayCharacterCheckTarget;
        if (requested.kind === 'turnMessage') {
          const selected = new Set(session.selectedTurnIds);
          const artifact = session.turnArtifacts.find((item) => selected.has(item.id) && item.messages.some((message) => message.id === requested.messageId));
          if (!artifact) throw new PlayCharacterCheckError('targetNotFound', '这条消息不在当前分支的已提交回合里。');
          target = { kind: 'turn', turnId: artifact.id };
        } else target = requested;
        const { material } = await loadMaterial(root, session, target, lens);
        const signal = context.req.raw.signal;
        let result = { findings: [] as PlayCharacterCheckReport['findings'], discardedCount: 0 };
        // Nobody to compare against: say so without spending a model call.
        if (material.characters.some((character) => character.status === 'referenced')) {
          const runtime = await input.getModelRuntime();
          if (!runtime.providerConfig) return context.json({ error: '请先配置模型。' }, 409);
          const response = await runPlayCharacterCheck({ material, workspaceRoot: root, provider: runtime.providerConfig, resolveModel: runtime.resolveModel, signal });
          signal.throwIfAborted();
          result = parsePlayCharacterCheckResponse(material, response);
        }
        const report = createPlayCharacterCheckReport(material, result, { id: `character-check-${randomUUID()}`, createdAt: new Date().toISOString() });
        // A report for a branch or attempt that moved during the call would already be stale.
        const current = await readPlaySessionFiles(root, id);
        const currentAttempt = target.kind === 'rehearsalStep' ? await readActiveAttempt(root, id) : undefined;
        if (input.getWorkspaceRoot() !== root || isPlayCharacterCheckReportStale(report, current, currentAttempt)) {
          return context.json({ error: '检查期间分支已改变，请重新检查。' }, 409);
        }
        signal.throwIfAborted();
        await savePlayCharacterCheckReport(root, report);
        return context.json({ report: { ...report, stale: false } satisfies PlayCharacterCheckReportView });
      } catch (error) { return failure(context, error); }
    },
  };
}

function failure(context: Context, error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof PlayCharacterCheckError) {
    const status = error.code === 'targetNotFound' ? 404 : error.code === 'targetNotOnBranch' ? 409
      : error.code === 'invalidResponse' || error.code === 'narrativeTooLarge' ? 422 : 400;
    return context.json({ error: message, code: error.code }, status);
  }
  return context.json({ error: message }, isErrorCode(error, 'ENOENT') ? 404 : 422);
}

async function resolveReportFile(workspaceRoot: string, sessionId: string, create: boolean): Promise<string> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(sessionId) || sessionId.includes('..')) throw new Error('Invalid Play session id.');
  const root = await realpath(workspaceRoot);
  let cursor = root;
  for (const part of [...REPORT_DIRECTORY, sessionId]) {
    cursor = resolve(cursor, part);
    if (cursor !== root && !cursor.startsWith(`${root}${sep}`)) throw new Error('Play character check store escaped the workspace.');
    if (create) await mkdir(cursor, { mode: 0o700 }).catch((error: unknown) => { if (!isErrorCode(error, 'EEXIST')) throw error; });
    let information: Awaited<ReturnType<typeof lstat>>;
    try { information = await lstat(cursor); }
    catch (error) { if (!create && isErrorCode(error, 'ENOENT')) return resolve(cursor, REPORT_FILE); throw error; }
    if (information.isSymbolicLink() || !information.isDirectory()) throw new Error('Play character check store is unsafe.');
  }
  const file = resolve(cursor, REPORT_FILE);
  try { if ((await lstat(file)).isSymbolicLink()) throw new Error('Play character check store is unsafe.'); }
  catch (error) { if (!isErrorCode(error, 'ENOENT')) throw error; }
  return file;
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code;
}
