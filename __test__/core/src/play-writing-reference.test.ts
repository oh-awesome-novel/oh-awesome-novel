import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';

import {
  MAX_PLAY_WRITING_REFERENCE_CONTEXT_CHARS,
  MAX_PLAY_WRITING_REFERENCE_ITEMS,
  addPlayTranscriptTurn,
  createPlaySessionDraft,
  createPlayWritingReferenceAttachment,
  detachPlayWritingReferenceAttachment,
  formatPlayWritingReferenceContext,
  listPlayWritingReferenceAttachments,
  readPlayWritingReferenceAttachment,
  resolvePlayWritingReferenceAttachmentPath,
  validatePlayWritingReferenceAttachment,
  writePlayOutcomeReport,
  writePlaySessionFiles,
} from '@oh-awesome-novel/core';
import type { PlaySession } from '@oh-awesome-novel/core';

const createTranscriptSession = (
  id: string,
  count: number,
  contentLength = 0,
): PlaySession => {
  let session = createPlaySessionDraft({
    id,
    title: 'Writing reference fixture',
    createdAt: '2026-07-16T06:00:00.000Z',
    sceneStart: 'A station platform.',
    characters: [],
  });
  for (let index = 0; index < count; index += 1) {
    session = addPlayTranscriptTurn(session, {
      speaker: 'narrator',
      content: `Outcome ${index + 1}: ${'x'.repeat(contentLength) || 'a committed beat.'}`,
      createdAt: `2026-07-16T06:${String(index).padStart(2, '0')}:00.000Z`,
    });
  }
  return session;
};

const prepareReport = async (
  workspaceRoot: string,
  session: PlaySession,
  createdAt = '2026-07-16T07:00:00.000Z',
) => {
  await writePlaySessionFiles(workspaceRoot, session);
  return writePlayOutcomeReport(workspaceRoot, session.id, { createdAt });
};

describe('Play Writing Reference attachment lifecycle', () => {
  it('is create-only, validates item ids, and enforces the 24-item cap', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-reference-create-'));
    try {
      const report = await prepareReport(
        workspaceRoot,
        createTranscriptSession('play-reference-create', 2),
      );
      const attachment = await createPlayWritingReferenceAttachment(workspaceRoot, {
        id: 'reference-create-only',
        sessionId: report.sessionId,
        selectedOutcomeItemRefs: [report.items[0]!.id],
        createdAt: '2026-07-16T07:01:00.000Z',
      });
      expect(attachment).toMatchObject({
        status: 'active',
        selectedOutcomeItemRefs: [report.items[0]!.id],
        selectedArtifactTurnRefs: report.selectedArtifactTurnRefs,
      });
      expect(attachment.evidenceClosureRefs).toContain(
        `artifact:${report.items[0]!.artifactTurnRefs[0]}`,
      );

      await expect(createPlayWritingReferenceAttachment(workspaceRoot, {
        id: attachment.id,
        sessionId: report.sessionId,
        selectedOutcomeItemRefs: [report.items[1]!.id],
      })).rejects.toThrow('already exists');
      await expect(createPlayWritingReferenceAttachment(workspaceRoot, {
        id: 'reference-unknown-item',
        sessionId: report.sessionId,
        selectedOutcomeItemRefs: ['outcome-unknown'],
      })).rejects.toThrow('unknown outcome item');
      await expect(createPlayWritingReferenceAttachment(workspaceRoot, {
        id: 'reference-too-many',
        sessionId: report.sessionId,
        selectedOutcomeItemRefs: Array.from(
          { length: MAX_PLAY_WRITING_REFERENCE_ITEMS + 1 },
          (_, index) => `outcome-${String(index + 1).padStart(4, '0')}`,
        ),
      })).rejects.toThrow(`at most ${MAX_PLAY_WRITING_REFERENCE_ITEMS}`);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('refuses create-only writes through a symlinked attachment root', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-reference-root-link-'));
    try {
      const report = await prepareReport(
        workspaceRoot,
        createTranscriptSession('play-reference-root-link', 1),
      );
      const outsideRoot = join(workspaceRoot, 'outside-references');
      await mkdir(outsideRoot);
      await symlink(
        outsideRoot,
        join(workspaceRoot, '.workspace', 'writing-references'),
      );

      await expect(createPlayWritingReferenceAttachment(workspaceRoot, {
        id: 'reference-root-link',
        sessionId: report.sessionId,
        selectedOutcomeItemRefs: [report.items[0]!.id],
      })).rejects.toThrow('root must be a real directory');
      await expect(readFile(join(outsideRoot, 'reference-root-link.yaml'), 'utf-8'))
        .rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('bounds explicit request context to 64 KiB and records an omission', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-reference-budget-'));
    try {
      const report = await prepareReport(
        workspaceRoot,
        createTranscriptSession(
          'play-reference-budget',
          MAX_PLAY_WRITING_REFERENCE_ITEMS,
          7_900,
        ),
      );
      expect(report.items).toHaveLength(MAX_PLAY_WRITING_REFERENCE_ITEMS);
      await createPlayWritingReferenceAttachment(workspaceRoot, {
        id: 'reference-budget',
        sessionId: report.sessionId,
        selectedOutcomeItemRefs: report.items.map((item) => item.id),
      });

      const context = await formatPlayWritingReferenceContext(
        workspaceRoot,
        'reference-budget',
      );
      expect(context.content.length)
        .toBeLessThanOrEqual(MAX_PLAY_WRITING_REFERENCE_CONTEXT_CHARS);
      expect(context.content).toContain('Context budget omitted');
      expect(context.sourceRef).toMatchObject({
        sourceId: 'playWritingReference:reference-budget',
        budgetLayer: 'L2',
        semanticBoundary: 'compressible',
      });
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('survives a same-evidence report rebuild but fails closed on fingerprint tampering', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-reference-fingerprint-'));
    try {
      const session = createTranscriptSession('play-reference-fingerprint', 2);
      const report = await prepareReport(workspaceRoot, session);
      await createPlayWritingReferenceAttachment(workspaceRoot, {
        id: 'reference-fingerprint',
        sessionId: session.id,
        selectedOutcomeItemRefs: [report.items[0]!.id],
      });

      await writePlayOutcomeReport(workspaceRoot, session.id, {
        createdAt: '2026-07-16T08:00:00.000Z',
      });
      await expect(readPlayWritingReferenceAttachment(
        workspaceRoot,
        'reference-fingerprint',
      )).resolves.toMatchObject({ status: 'active' });

      const path = resolvePlayWritingReferenceAttachmentPath(
        workspaceRoot,
        'reference-fingerprint',
      );
      const stored = parse(await readFile(path, 'utf-8')) as Record<string, unknown>;
      stored.reportFingerprint = '0'.repeat(64);
      await writeFile(path, stringify(stored), 'utf-8');
      await expect(readPlayWritingReferenceAttachment(
        workspaceRoot,
        'reference-fingerprint',
      )).resolves.toMatchObject({ status: 'stale' });
      await expect(validatePlayWritingReferenceAttachment(
        workspaceRoot,
        'reference-fingerprint',
      )).rejects.toThrow('is stale');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('becomes stale after selected-session evidence advances', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-reference-session-'));
    try {
      const session = createTranscriptSession('play-reference-session-drift', 1);
      const report = await prepareReport(workspaceRoot, session);
      await createPlayWritingReferenceAttachment(workspaceRoot, {
        id: 'reference-session-drift',
        sessionId: session.id,
        selectedOutcomeItemRefs: [report.items[0]!.id],
      });
      const advanced = addPlayTranscriptTurn(session, {
        speaker: 'narrator',
        content: 'The selected branch advances beyond the attachment snapshot.',
        createdAt: '2026-07-16T08:01:00.000Z',
      });
      await writePlaySessionFiles(workspaceRoot, advanced, {
        expectedCurrentSession: session,
      });

      await expect(readPlayWritingReferenceAttachment(
        workspaceRoot,
        'reference-session-drift',
      )).resolves.toMatchObject({ status: 'stale' });
      await expect(formatPlayWritingReferenceContext(
        workspaceRoot,
        'reference-session-drift',
      )).rejects.toThrow('is stale');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('becomes stale after an activated source hash drifts', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-reference-source-'));
    try {
      const sourcePath = 'characters/alice/profile.md';
      const absoluteSourcePath = join(workspaceRoot, sourcePath);
      await mkdir(join(workspaceRoot, 'characters/alice'), { recursive: true });
      await writeFile(absoluteSourcePath, 'Alice trusts the porter.\n', 'utf-8');
      const contentHash = createHash('sha256')
        .update(await readFile(absoluteSourcePath))
        .digest('hex');
      const base = createPlaySessionDraft({
        id: 'play-reference-source-drift',
        title: 'Reference source drift',
        sceneStart: 'Station',
        characters: ['alice'],
        activatedSources: [{
          sourceId: 'characters.alice.profile',
          path: sourcePath,
          contentHash,
          reason: 'Explicit character evidence.',
          budgetLayer: 'L1',
          semanticBoundary: 'protected',
          trust: 'canonical',
        }],
      });
      const session = addPlayTranscriptTurn(base, {
        speaker: 'narrator',
        content: 'Alice enters the station.',
        createdAt: '2026-07-16T08:02:00.000Z',
      });
      const report = await prepareReport(workspaceRoot, session);
      await createPlayWritingReferenceAttachment(workspaceRoot, {
        id: 'reference-source-drift',
        sessionId: session.id,
        selectedOutcomeItemRefs: [report.items[0]!.id],
      });

      await writeFile(absoluteSourcePath, 'Alice distrusts the porter.\n', 'utf-8');
      await expect(readPlayWritingReferenceAttachment(
        workspaceRoot,
        'reference-source-drift',
      )).resolves.toMatchObject({ status: 'stale' });
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('retains detached audit files, rejects consumption, and lists deterministically', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-reference-detach-'));
    try {
      const session = createTranscriptSession('play-reference-detach', 2);
      const report = await prepareReport(workspaceRoot, session);
      await createPlayWritingReferenceAttachment(workspaceRoot, {
        id: 'reference-older',
        sessionId: session.id,
        selectedOutcomeItemRefs: [report.items[0]!.id],
        createdAt: '2026-07-16T09:00:00.000Z',
      });
      await createPlayWritingReferenceAttachment(workspaceRoot, {
        id: 'reference-newer',
        sessionId: session.id,
        selectedOutcomeItemRefs: [report.items[1]!.id],
        createdAt: '2026-07-16T09:01:00.000Z',
      });
      const detached = await detachPlayWritingReferenceAttachment(
        workspaceRoot,
        'reference-older',
        { detachedAt: '2026-07-16T09:02:00.000Z' },
      );
      expect(detached).toMatchObject({
        status: 'detached',
        detachedAt: '2026-07-16T09:02:00.000Z',
      });
      await expect(readFile(resolvePlayWritingReferenceAttachmentPath(
        workspaceRoot,
        'reference-older',
      ), 'utf-8')).resolves.toContain('status: detached');
      await expect(validatePlayWritingReferenceAttachment(
        workspaceRoot,
        'reference-older',
      )).rejects.toThrow('is detached');

      const replay = await detachPlayWritingReferenceAttachment(
        workspaceRoot,
        'reference-older',
        { detachedAt: '2026-07-16T10:00:00.000Z' },
      );
      expect(replay.detachedAt).toBe('2026-07-16T09:02:00.000Z');
      await expect(listPlayWritingReferenceAttachments(workspaceRoot)).resolves
        .toEqual([
          expect.objectContaining({ id: 'reference-newer', status: 'active' }),
          expect.objectContaining({ id: 'reference-older', status: 'detached' }),
        ]);

      const detachedPath = resolvePlayWritingReferenceAttachmentPath(
        workspaceRoot,
        'reference-older',
      );
      const detachedRecord = parse(
        await readFile(detachedPath, 'utf-8'),
      ) as Record<string, unknown>;
      await writeFile(detachedPath, stringify({
        ...detachedRecord,
        reportRef: '.workspace/play-sessions/another-session/reports/outcome.yaml',
      }), 'utf-8');
      await expect(readPlayWritingReferenceAttachment(
        workspaceRoot,
        'reference-older',
      )).rejects.toThrow('reportRef must belong to its attachment session');

      await writeFile(detachedPath, stringify({
        ...detachedRecord,
        evidenceClosureRefs: [
          ...(detachedRecord.evidenceClosureRefs as string[]),
          'artifact:foreign-branch-artifact',
        ],
      }), 'utf-8');
      await expect(readPlayWritingReferenceAttachment(
        workspaceRoot,
        'reference-older',
      )).rejects.toThrow('out-of-branch artifact');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
