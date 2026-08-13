import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  checkSessionResumeBoundary,
  createSessionResumeBoundary,
  createSessionResumeBoundaryFromProposedChanges,
  formatAuthorReportMarkdown,
  parseSessionProposedChanges,
  readSessionProposedChanges,
  resolveSessionArtifactPath,
  writeAgentSessionArtifact,
  writeSessionProposedChanges,
  writeSessionRunMetadata,
  type AgentSessionArtifact,
  type SessionProposedChange,
} from '@oh-awesome-novel/core';

describe('session artifacts', () => {
  it('writes run metadata under .workspace sessions', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-session-'));

    try {
      const filePath = await writeSessionRunMetadata(workspaceRoot, {
        sessionId: 'session-1',
        capability: 'novel.write_chapter',
        status: 'running',
        startedAt: '2026-06-19T00:00:00.000Z',
        updatedAt: '2026-06-19T00:01:00.000Z',
        inputSources: [{ sourceId: 'constitution', path: '.oan/constitution/style.md' }],
        touchedFiles: ['chapters/0001/0004.md'],
      });

      expect(relative(workspaceRoot, filePath)).toBe(
        join('.workspace', 'sessions', 'session-1', 'run.yaml'),
      );
      await expect(readFile(filePath, 'utf-8')).resolves.toContain(
        'novel.write_chapter',
      );
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('rejects traversal and unsupported session ids', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-session-safe-'));

    try {
      expect(() =>
        resolveSessionArtifactPath(workspaceRoot, '../escape', 'run.yaml'),
      ).toThrow('Invalid session id');
      expect(() =>
        resolveSessionArtifactPath(workspaceRoot, '.hidden', 'run.yaml'),
      ).toThrow('Invalid session id');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('writes a complete lightweight session artifact bundle', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-session-bundle-'));

    try {
      const artifact: AgentSessionArtifact = {
        run: {
          sessionId: 'bundle-1',
          status: 'completed',
          startedAt: '2026-06-19T00:00:00.000Z',
          updatedAt: '2026-06-19T00:02:00.000Z',
          inputSources: [],
          touchedFiles: [],
        },
        outputs: [
          {
            id: 'out-1',
            type: 'reviewReport',
            title: '审稿报告',
            summary: '发现一处 OOC 风险。',
          },
        ],
        proposedChanges: [
          {
            id: 'action-1',
            title: 'Update heroine state',
            status: 'pending',
            createdAt: '2026-06-19T00:01:00.000Z',
            changes: [{
              operation: 'update',
              path: 'state/characters.yaml',
              oldHash: 'a'.repeat(64),
              newHash: 'b'.repeat(64),
            }],
          },
        ],
        unresolved: ['是否保留旧信寄件人的模糊性'],
      };

      const paths = await writeAgentSessionArtifact(workspaceRoot, artifact);

      expect(paths.map((path) => relative(workspaceRoot, path)).sort()).toEqual([
        join('.workspace', 'sessions', 'bundle-1', 'outputs.yaml'),
        join('.workspace', 'sessions', 'bundle-1', 'proposed-changes.yaml'),
        join('.workspace', 'sessions', 'bundle-1', 'run.yaml'),
        join('.workspace', 'sessions', 'bundle-1', 'unresolved.md'),
      ].sort());
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('detects manual file changes before resume', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-session-resume-'));

    try {
      await writeFile(join(workspaceRoot, 'chapter.md'), 'before', 'utf-8');
      const boundary = await createSessionResumeBoundary(
        workspaceRoot,
        'resume-1',
        ['chapter.md'],
        '2026-06-19T00:00:00.000Z',
      );

      await writeFile(join(workspaceRoot, 'chapter.md'), 'after', 'utf-8');
      const check = await checkSessionResumeBoundary(workspaceRoot, boundary);

      expect(check.changedFiles).toEqual(['chapter.md']);
      expect(check.prompt).toContain('Manual file changes were detected');
      expect(check.prompt).toContain('continue from manual changes');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('formats concise author-facing reports without raw logs', () => {
    const report = formatAuthorReportMarkdown({
      status: 'completed',
      candidateOutputs: ['章节草稿', 'settlement bundle'],
      acceptedActions: ['summary-1'],
      rejectedActions: [],
      pendingActions: ['state-1', 'timeline-1'],
      unresolvedDecisions: ['是否提前揭示旧信寄件人'],
      nextSuggestedAction: '审阅 PendingAction 后再继续下一章。',
    });

    expect(report).toContain('## Author Report');
    expect(report).toContain('Status: completed');
    expect(report).toContain('- pending: 2');
    expect(report).not.toContain('traceback');
    expect(report).not.toContain('{');
  });

  it('writes and strictly recovers proposed changes', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-session-changes-'));
    const proposedChanges: SessionProposedChange[] = [
      {
        id: 'action-1',
        title: 'Draft chapter four',
        status: 'pending',
        createdAt: '2026-08-12T00:00:00.000Z',
        changes: [
          {
            operation: 'create',
            path: 'chapters/0001/0004.md',
            newHash: 'a'.repeat(64),
          },
        ],
      },
    ];

    try {
      const filePath = await writeSessionProposedChanges(
        workspaceRoot,
        'changes-1',
        proposedChanges,
      );

      expect(relative(workspaceRoot, filePath)).toBe(
        join('.workspace', 'sessions', 'changes-1', 'proposed-changes.yaml'),
      );
      await expect(readSessionProposedChanges(workspaceRoot, 'changes-1')).resolves.toEqual({
        schemaVersion: 1,
        kind: 'session-proposed-changes',
        sessionId: 'changes-1',
        proposedChanges,
      });

      expect(() => parseSessionProposedChanges({
        schemaVersion: 1,
        kind: 'session-proposed-changes',
        sessionId: 'changes-1',
        proposedChanges,
        extra: [],
      })).toThrow('unknown or missing fields');
      expect(() => parseSessionProposedChanges({
        schemaVersion: 0,
        kind: 'session-proposed-changes',
        sessionId: 'changes-1',
        proposedChanges: [],
      })).toThrow('UNSUPPORTED_SESSION_PROPOSED_CHANGES_SCHEMA');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('derives resume snapshots from normalized proposed change paths', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-session-change-resume-'));
    await mkdir(join(workspaceRoot, 'chapters', '0001'), { recursive: true });
    await writeFile(
      join(workspaceRoot, 'chapters', '0001', '0004.md'),
      'before',
      'utf-8',
    );

    try {
      const boundary = await createSessionResumeBoundaryFromProposedChanges(
        workspaceRoot,
        'resume-changes-1',
        [
          {
            id: 'action-1',
            title: 'Update chapter',
            status: 'pending',
            createdAt: '2026-08-12T00:00:00.000Z',
            changes: [
              {
                operation: 'update',
                path: 'chapters/0001/0004.md',
                oldHash: 'a'.repeat(64),
                newHash: 'b'.repeat(64),
              },
            ],
          },
          {
            id: 'action-2',
            title: 'Review same chapter',
            status: 'pending',
            createdAt: '2026-08-12T00:00:01.000Z',
            changes: [
              {
                operation: 'update',
                path: 'chapters/0001/0004.md',
                oldHash: 'a'.repeat(64),
                newHash: 'b'.repeat(64),
              },
            ],
          },
        ],
        '2026-08-12T00:00:02.000Z',
      );

      expect(boundary.touchedFiles).toHaveLength(1);
      expect(boundary.touchedFiles[0]?.path).toBe('chapters/0001/0004.md');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('writes a session bundle with no proposed changes', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-session-change-bundle-'));
    const artifact: AgentSessionArtifact = {
      run: {
        sessionId: 'bundle-changes-1',
        status: 'completed',
        startedAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T00:02:00.000Z',
        inputSources: [],
        touchedFiles: [],
      },
      outputs: [],
      proposedChanges: [],
      unresolved: [],
    };

    try {
      const paths = await writeAgentSessionArtifact(workspaceRoot, artifact);

      expect(paths.map((path) => relative(workspaceRoot, path)).sort()).toEqual([
        join('.workspace', 'sessions', 'bundle-changes-1', 'outputs.yaml'),
        join('.workspace', 'sessions', 'bundle-changes-1', 'proposed-changes.yaml'),
        join('.workspace', 'sessions', 'bundle-changes-1', 'run.yaml'),
        join('.workspace', 'sessions', 'bundle-changes-1', 'unresolved.md'),
      ].sort());
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
