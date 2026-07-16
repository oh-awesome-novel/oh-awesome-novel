import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  addPlayTranscriptTurn,
  createPlayOutcomeReport,
  createPlaySceneRehearsalSessionDraft,
  createPlaySessionDraft,
  createSelectedPlayOutcomeEvidenceIndex,
  fingerprintPlayOutcomeReport,
  formatPlayOutcomeReportMarkdown,
  projectPlayOutcomeReport,
  readPlayOutcomeReport,
  resolvePlayOutcomeReportPath,
  restorePlaySessionCheckpoint,
  settlePlayWorldRefereeResponse,
  writePlayOutcomeReport,
  writePlaySessionFiles,
} from '@oh-awesome-novel/core';
import type {
  NarrativeBlock,
  PlayRehearsalTurnEvidence,
  PlaySession,
  PlayTurnArtifact,
} from '@oh-awesome-novel/core';

const settlementResponse = (
  narrative: string,
  settlement: Record<string, unknown> = {},
): string => [
  narrative,
  '```oan-play-settlement',
  JSON.stringify(settlement),
  '```',
].join('\n');

const createV4BranchedSession = (): {
  session: PlaySession;
  selectedArtifactId: string;
  siblingArtifactId: string;
  siblingSecret: string;
} => {
  const root = addPlayTranscriptTurn(createPlaySessionDraft({
    id: 'play-outcome-v4-branch',
    title: 'Outcome branch',
    createdAt: '2026-07-16T00:00:00.000Z',
    sceneStart: 'A forked station platform.',
    characters: [],
  }), {
    id: 'root-narration',
    speaker: 'narrator',
    content: 'The station clock reaches midnight.',
    createdAt: '2026-07-16T00:00:01.000Z',
  });
  const selected = settlePlayWorldRefereeResponse({
    session: root,
    userText: 'Follow the lit platform.',
    actionKind: 'move',
    createdAt: '2026-07-16T00:01:00.000Z',
    refereeResponse: settlementResponse('A porter raises a green lantern.', {
      events: [{
        kind: 'environmentChanged',
        origin: 'environment',
        title: 'Green lantern raised',
        summary: 'The lit platform is opened to passengers.',
        visibility: 'playerVisible',
        cause: { reason: 'The porter received the public signal.' },
      }],
      stateDelta: { platformOpen: true },
      observations: [{
        summary: 'The lit platform is now usable',
        evidence: 'The porter raised the green lantern.',
      }],
    }),
  });
  const selectedArtifactId = selected.selectedTurnIds.at(-1)!;
  const restoredRoot = restorePlaySessionCheckpoint(
    selected,
    root.selectedTurnIds.at(-1)!,
  );
  const siblingSecret = 'The stationmaster hides the royal cipher in locker nine.';
  const sibling = settlePlayWorldRefereeResponse({
    session: restoredRoot,
    userText: 'Follow the unlit platform.',
    actionKind: 'move',
    createdAt: '2026-07-16T00:02:00.000Z',
    refereeResponse: settlementResponse('The unlit platform remains quiet.', {
      events: [{
        kind: 'npcActed',
        origin: 'npc',
        title: 'Royal cipher concealed',
        summary: siblingSecret,
        visibility: 'playerUnknown',
        cause: { reason: 'The stationmaster follows a sealed order.' },
      }],
      stateDelta: { royalCipherLocation: 'locker-nine' },
      observations: [{
        summary: 'The royal cipher was concealed',
        evidence: siblingSecret,
      }],
    }),
  });
  const siblingArtifactId = sibling.selectedTurnIds.at(-1)!;
  return {
    session: restorePlaySessionCheckpoint(sibling, selectedArtifactId),
    selectedArtifactId,
    siblingArtifactId,
    siblingSecret,
  };
};

const createRehearsalEvidence = (
  artifact: PlayTurnArtifact,
  suffix: string,
  content: string,
): PlayRehearsalTurnEvidence => {
  const narrativeBlock: NarrativeBlock = {
    id: `block-${suffix}`,
    kind: 'characterAction',
    speakerRef: 'participant-alice',
    content,
    visibility: 'playerVisible',
    projection: 'transcript',
    eventRefs: [],
    sourceRefs: ['knowledge-alice-key'],
  };
  return {
    id: `evidence-${suffix}`,
    owningTurnArtifactId: artifact.id,
    attemptId: `attempt-${suffix}`,
    selectedStepRefs: [`step-${suffix}`],
    steps: [{
      stepRef: `step-${suffix}`,
      participantRef: 'participant-alice',
      perceptionRef: `perception-scene-platform-participant-alice-${artifact.revision - 1}`,
      intentSummary: content,
      narrativeBlocks: [narrativeBlock],
      settlementEventRefs: [],
      decisionBasisRefs: ['knowledge-alice-key'],
    }],
    hostNarrativeBlocks: [],
    narrativeBlocks: [narrativeBlock],
    finalizeReceipt: {
      idempotencyKey: `finish-${suffix}`,
      requestFingerprint: `fingerprint-${suffix}`,
      attemptRevision: 1,
    },
    committedAt: artifact.committedAt,
    canonical: false,
  };
};

const commitRehearsalArtifact = (
  session: PlaySession,
  suffix: string,
  content: string,
): PlaySession => {
  const artifact = session.turnArtifacts.at(-1)!;
  const evidence = createRehearsalEvidence(artifact, suffix, content);
  artifact.schemaVersion = 3;
  artifact.rehearsalEvidenceRefs = [evidence.id];
  session.rehearsalScenes![0]!.turns.push(evidence);
  return session;
};

const createV5BranchedSession = (): {
  session: PlaySession;
  selectedEvidenceId: string;
  siblingSecret: string;
} => {
  const draft = createPlaySceneRehearsalSessionDraft({
    id: 'play-outcome-v5-branch',
    title: 'Rehearsal outcome branch',
    createdAt: '2026-07-16T01:00:00.000Z',
    sceneStart: 'Alice stands beside a locked platform gate.',
    characters: [],
    sceneContract: {
      sceneId: 'scene-platform',
      worldClock: { turn: 0, revision: 0 },
      clockProvenance: {
        kind: 'newSessionInitial',
        sourceRefs: ['outline-platform'],
      },
      objective: {
        value: 'Alice decides whether to open the gate.',
        provenance: {
          kind: 'authorProvided',
          providedAt: '2026-07-16T01:00:00.000Z',
        },
      },
      participantRefs: ['participant-alice'],
      orderStrategy: 'directorFixed',
    },
    participants: [{
      participantRef: 'participant-alice',
      displayName: 'Alice',
      currentGoal: 'Open the gate before the train arrives.',
      initialKnowledgeEvidenceRefs: ['knowledge-alice-key'],
    }],
    initialKnowledgeEvidence: [{
      id: 'knowledge-alice-key',
      participantRef: 'participant-alice',
      visibility: 'playerVisible',
      fact: 'Alice carries the platform key.',
      provenance: {
        kind: 'authorProvided',
        providedAt: '2026-07-16T01:00:00.000Z',
      },
    }],
  });
  const selected = commitRehearsalArtifact(settlePlayWorldRefereeResponse({
    session: draft,
    userText: 'Run Alice on the first variant.',
    actionKind: 'do',
    createdAt: '2026-07-16T01:01:00.000Z',
    refereeResponse: settlementResponse('Alice studies the lock.'),
  }), 'selected', 'Alice puts the key into the platform lock.');
  const selectedArtifactId = selected.selectedTurnIds.at(-1)!;
  const selectedEvidenceId = selected.rehearsalScenes![0]!.turns[0]!.id;
  const restoredInitial = restorePlaySessionCheckpoint(selected, 'initial-world');
  const siblingSecret = 'Alice secretly hands the key to the masked saboteur.';
  const sibling = commitRehearsalArtifact(settlePlayWorldRefereeResponse({
    session: restoredInitial,
    userText: 'Run Alice on the discarded variant.',
    actionKind: 'do',
    createdAt: '2026-07-16T01:02:00.000Z',
    refereeResponse: settlementResponse('Alice studies the empty platform.'),
  }), 'sibling', siblingSecret);
  return {
    session: restorePlaySessionCheckpoint(sibling, selectedArtifactId),
    selectedEvidenceId,
    siblingSecret,
  };
};

describe('Play outcome selected-branch report', () => {
  it('indexes only the v4 selected branch and excludes sibling facts', () => {
    const fixture = createV4BranchedSession();
    const index = createSelectedPlayOutcomeEvidenceIndex(fixture.session);
    const serialized = JSON.stringify(index);

    expect(index.selectedArtifactTurnRefs).toContain(fixture.selectedArtifactId);
    expect(index.selectedArtifactTurnRefs).not.toContain(fixture.siblingArtifactId);
    expect(serialized).toContain('Green lantern raised');
    expect(serialized).not.toContain(fixture.siblingSecret);

    const report = createPlayOutcomeReport(fixture.session, {
      createdAt: '2026-07-16T03:00:00.000Z',
    });
    expect(JSON.stringify(report)).not.toContain(fixture.siblingSecret);
    expect(report.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'worldChange',
        summary: expect.stringContaining('Green lantern raised'),
      }),
      expect.objectContaining({
        kind: 'writingMaterial',
        observationRefs: ['obs-2-1'],
      }),
    ]));
  });

  it('indexes only v5 selected rehearsal evidence and emits explicit goal status', () => {
    const fixture = createV5BranchedSession();
    const index = createSelectedPlayOutcomeEvidenceIndex(fixture.session);
    const report = createPlayOutcomeReport(fixture.session, {
      createdAt: '2026-07-16T03:01:00.000Z',
    });

    expect(index.rehearsalEvidence.map(({ evidence }) => evidence.id))
      .toEqual([fixture.selectedEvidenceId]);
    expect(JSON.stringify(report)).not.toContain(fixture.siblingSecret);
    expect(report.items.filter((item) => item.kind === 'goalAssessment'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ goalStatus: 'partial', tags: expect.arrayContaining(['goal']) }),
        expect.objectContaining({
          goalStatus: 'partial',
          participantRefs: ['participant-alice'],
        }),
      ]));
    expect(report.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'participantFootprint',
        summary: 'Alice puts the key into the platform lock.',
        participantRefs: ['participant-alice'],
      }),
    ]));
  });

  it('scrubs every audit/source/participant ref and hidden item from Player projection', () => {
    const fixture = createV5BranchedSession();
    const report = createPlayOutcomeReport(fixture.session, {
      createdAt: '2026-07-16T03:02:00.000Z',
    });
    const player = projectPlayOutcomeReport(report, 'player');

    expect(player.sourceSnapshots).toEqual([]);
    expect(player.selectedArtifactTurnRefs).toEqual([]);
    expect(player.items.some((item) => item.visibility === 'playerUnknown')).toBe(false);
    for (const item of player.items) {
      expect(item.artifactTurnRefs).toEqual([]);
      expect(item.messageRefs).toEqual([]);
      expect(item.eventRefs).toEqual([]);
      expect(item.observationRefs).toEqual([]);
      expect(item.evidenceRefs).toEqual([]);
      expect(item.sourceRefs).toEqual([]);
      expect(item.participantRefs).toEqual([]);
    }
    const markdown = formatPlayOutcomeReportMarkdown(report, 'player');
    expect(markdown).toContain('Selected committed branch: (redacted in Player projection)');
    expect(markdown).not.toContain('participant-alice');
    expect(markdown).not.toContain(fixture.selectedEvidenceId);
    expect(markdown).not.toContain(fixture.siblingSecret);
  });

  it('uses an evidence-stable fingerprint that ignores rebuild time', () => {
    const session = createV4BranchedSession().session;
    const first = createPlayOutcomeReport(session, {
      createdAt: '2026-07-16T03:03:00.000Z',
    });
    const rebuilt = createPlayOutcomeReport(session, {
      createdAt: '2026-07-16T04:03:00.000Z',
    });

    expect(first.createdAt).not.toBe(rebuilt.createdAt);
    expect(fingerprintPlayOutcomeReport(first))
      .toBe(fingerprintPlayOutcomeReport(rebuilt));
    const changed = structuredClone(rebuilt);
    changed.items[0]!.summary = 'A materially different committed outcome.';
    expect(fingerprintPlayOutcomeReport(changed))
      .not.toBe(fingerprintPlayOutcomeReport(rebuilt));
  });
});

describe('Play outcome report persistence', () => {
  it('writes YAML plus Markdown, reads it, and rejects authoritative report tampering', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-outcome-report-'));
    try {
      const session = createV4BranchedSession().session;
      await writePlaySessionFiles(workspaceRoot, session);
      const report = await writePlayOutcomeReport(workspaceRoot, session.id, {
        createdAt: '2026-07-16T05:00:00.000Z',
      });
      const yamlPath = resolvePlayOutcomeReportPath(workspaceRoot, session.id, 'yaml');
      const markdownPath = resolvePlayOutcomeReportPath(
        workspaceRoot,
        session.id,
        'markdown',
      );

      await expect(readFile(yamlPath, 'utf-8')).resolves.toContain('schemaVersion: 1');
      await expect(readFile(markdownPath, 'utf-8')).resolves.toContain('# Play Outcome Report');
      await expect(readPlayOutcomeReport(workspaceRoot, session.id)).resolves
        .toMatchObject({ status: 'current', report: { items: report.items } });

      const yaml = await readFile(yamlPath, 'utf-8');
      await writeFile(
        yamlPath,
        yaml.replace(report.items[0]!.summary, 'Tampered outcome summary.'),
        'utf-8',
      );
      await expect(readPlayOutcomeReport(workspaceRoot, session.id))
        .rejects.toThrow('does not match the selected committed evidence');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('preserves the explicit reports manifest across staged rewrites and marks it stale', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-outcome-stage-'));
    try {
      const session = createV4BranchedSession().session;
      await writePlaySessionFiles(workspaceRoot, session);
      await writePlayOutcomeReport(workspaceRoot, session.id, {
        createdAt: '2026-07-16T05:01:00.000Z',
      });
      const advanced = addPlayTranscriptTurn(session, {
        speaker: 'narrator',
        content: 'A later selected-branch beat makes the old report stale.',
        createdAt: '2026-07-16T05:02:00.000Z',
      });
      await writePlaySessionFiles(workspaceRoot, advanced, {
        expectedCurrentSession: session,
      });

      await expect(readFile(
        resolvePlayOutcomeReportPath(workspaceRoot, session.id, 'yaml'),
        'utf-8',
      )).resolves.toContain('schemaVersion: 1');
      await expect(readFile(
        resolvePlayOutcomeReportPath(workspaceRoot, session.id, 'markdown'),
        'utf-8',
      )).resolves.toContain('# Play Outcome Report');
      await expect(readPlayOutcomeReport(workspaceRoot, session.id)).resolves
        .toMatchObject({
          status: 'stale',
          staleReasons: expect.arrayContaining(['sessionRevisionChanged', 'selectedBranchChanged']),
        });
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('rejects unknown report entries and report symlinks during staged rewrite', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-outcome-manifest-'));
    try {
      const session = createV4BranchedSession().session;
      await writePlaySessionFiles(workspaceRoot, session);
      await writePlayOutcomeReport(workspaceRoot, session.id, {
        createdAt: '2026-07-16T05:03:00.000Z',
      });
      const reportsRoot = join(
        workspaceRoot,
        '.workspace',
        'play-sessions',
        session.id,
        'reports',
      );
      const advanced = addPlayTranscriptTurn(session, {
        speaker: 'narrator',
        content: 'Attempt a staged rewrite.',
        createdAt: '2026-07-16T05:04:00.000Z',
      });

      await writeFile(join(reportsRoot, 'unknown.txt'), 'not in manifest', 'utf-8');
      await expect(writePlaySessionFiles(workspaceRoot, advanced, {
        expectedCurrentSession: session,
      })).rejects.toThrow('unsupported entry: unknown.txt');
      await rm(join(reportsRoot, 'unknown.txt'));

      const yamlPath = join(reportsRoot, 'outcome.yaml');
      const markdownPath = join(reportsRoot, 'outcome.md');
      const originalYaml = await readFile(yamlPath, 'utf-8');
      const originalMarkdown = await readFile(markdownPath, 'utf-8');
      await rm(yamlPath);
      await expect(writePlaySessionFiles(workspaceRoot, advanced, {
        expectedCurrentSession: session,
      })).rejects.toThrow('markdown cannot exist without authoritative YAML');
      await writeFile(yamlPath, originalYaml, 'utf-8');

      await truncate(markdownPath, 32 * 1024 * 1024 + 1);
      await expect(writePlaySessionFiles(workspaceRoot, advanced, {
        expectedCurrentSession: session,
      })).rejects.toThrow('exceeds the preservation size limit: outcome.md');
      await writeFile(markdownPath, originalMarkdown, 'utf-8');

      const outsidePath = join(workspaceRoot, 'outside-outcome.yaml');
      await writeFile(outsidePath, 'outside: true\n', 'utf-8');
      await rm(yamlPath);
      await symlink(outsidePath, yamlPath);
      await expect(readPlayOutcomeReport(workspaceRoot, session.id))
        .rejects.toThrow('must be a regular file');
      await expect(writePlaySessionFiles(workspaceRoot, advanced, {
        expectedCurrentSession: session,
      })).rejects.toThrow('must be a regular file: outcome.yaml');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('refuses to create outcome files through a symlinked reports root', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-outcome-root-link-'));
    try {
      const session = createV4BranchedSession().session;
      await writePlaySessionFiles(workspaceRoot, session);
      const outsideRoot = join(workspaceRoot, 'outside-reports');
      await mkdir(outsideRoot);
      await symlink(outsideRoot, join(
        workspaceRoot,
        '.workspace',
        'play-sessions',
        session.id,
        'reports',
      ));

      await expect(writePlayOutcomeReport(workspaceRoot, session.id))
        .rejects.toThrow('reports root must be a real directory');
      await expect(readFile(join(outsideRoot, 'outcome.yaml'), 'utf-8'))
        .rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('fails closed when an activated source changes on disk', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-outcome-source-'));
    try {
      const sourcePath = 'characters/alice/profile.md';
      const absoluteSourcePath = join(workspaceRoot, sourcePath);
      await mkdir(join(workspaceRoot, 'characters/alice'), { recursive: true });
      await writeFile(absoluteSourcePath, 'Alice trusts the porter.\n', 'utf-8');
      const original = await readFile(absoluteSourcePath);
      const contentHash = createHash('sha256').update(original).digest('hex');
      const session = addPlayTranscriptTurn(createPlaySessionDraft({
        id: 'play-outcome-source-drift',
        title: 'Source drift',
        sceneStart: 'Station',
        characters: ['alice'],
        activatedSources: [{
          sourceId: 'characters.alice.profile',
          path: sourcePath,
          contentHash,
          reason: 'Alice profile selected for this Play session.',
          budgetLayer: 'L1',
          semanticBoundary: 'protected',
          trust: 'canonical',
        }],
      }), {
        speaker: 'narrator',
        content: 'Alice enters the station.',
        createdAt: '2026-07-16T05:05:00.000Z',
      });
      await writePlaySessionFiles(workspaceRoot, session);
      await writePlayOutcomeReport(workspaceRoot, session.id, {
        createdAt: '2026-07-16T05:06:00.000Z',
      });

      await writeFile(absoluteSourcePath, 'Alice distrusts the porter.\n', 'utf-8');
      await expect(readPlayOutcomeReport(workspaceRoot, session.id)).resolves
        .toMatchObject({
          status: 'stale',
          staleReasons: ['sourceContentChanged:characters.alice.profile'],
        });
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
