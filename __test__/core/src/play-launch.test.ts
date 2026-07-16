import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { describe, expect, it } from 'vitest';

import {
  MAX_PLAY_LAUNCH_SOURCE_EXCERPT,
  PLAY_LAUNCH_SETUP_FILE,
  PlayLaunchSourceValidationError,
  createPlaySessionFromLaunchPackage,
  normalizePlayLaunchPackage,
  previewPlayLaunchPackage,
  readPlayLaunchPackage,
  validatePlayLaunchPackageSources,
  writePlayLaunchPackage,
} from '@oh-awesome-novel/core';
import type {
  PlayLaunchPackagePreviewInput,
} from '@oh-awesome-novel/core';

const CREATED_AT = '2026-07-16T00:00:00.000Z';

describe('Play Launch Package', () => {
  it('previews real source bytes without writing and bounds the persisted excerpt', async () => {
    const workspaceRoot = await createWorkspace();
    const chapter = `# Last train\r\n\r\n${'雨'.repeat(MAX_PLAY_LAUNCH_SOURCE_EXCERPT + 80)}`;
    await writeFile(join(workspaceRoot, 'chapters/0001/0001.md'), chapter, 'utf-8');

    try {
      const preview = await previewPlayLaunchPackage(workspaceRoot, createInput());
      const chapterSource = preview.sourceBase.activatedSources[0]!;

      expect(chapterSource).toMatchObject({
        sourceId: 'chapter-opening',
        objectId: '0001/0001',
        role: 'chapter',
        status: 'ready',
        contentHash: createHash('sha256').update(Buffer.from(chapter)).digest('hex'),
      });
      expect(chapterSource.excerpt?.length).toBeLessThanOrEqual(
        MAX_PLAY_LAUNCH_SOURCE_EXCERPT,
      );
      expect(chapterSource.excerpt?.endsWith('...')).toBe(true);
      await expect(access(join(workspaceRoot, '.workspace'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('reports missing, invalid-domain, directory, and symlink-escape sources', async () => {
    const workspaceRoot = await createWorkspace();
    const outsideRoot = await mkdtemp(join(tmpdir(), 'oan-play-launch-outside-'));
    await writeFile(join(outsideRoot, 'secret.md'), 'outside workspace', 'utf-8');
    await symlink(
      join(outsideRoot, 'secret.md'),
      join(workspaceRoot, 'world/outside.md'),
    );

    try {
      const missing = await previewPlayLaunchPackage(
        workspaceRoot,
        createInput({
          sources: [
            { sourceId: 'missing', path: 'chapters/0001/0099.md', role: 'chapter' },
            characterSource(),
          ],
          entryPoint: {
            ...createInput().entryPoint,
            sourceRefs: ['missing'],
            location: undefined,
          },
        }),
      );
      expect(missing.sourceBase.activatedSources[0]?.status).toBe('missing');
      expect(missing.diagnostics).toContainEqual(expect.objectContaining({
        code: 'missingSource',
        severity: 'error',
        sourceId: 'missing',
      }));

      const invalidDomain = await previewPlayLaunchPackage(
        workspaceRoot,
        createInput({
          sources: [
            { sourceId: 'wrong-domain', path: 'world/overview.md', role: 'chapter' },
            characterSource(),
          ],
          entryPoint: {
            ...createInput().entryPoint,
            sourceRefs: ['wrong-domain'],
            location: undefined,
          },
        }),
      );
      expect(invalidDomain.diagnostics).toContainEqual(expect.objectContaining({
        code: 'invalidSource',
        sourceId: 'wrong-domain',
      }));

      const directory = await previewPlayLaunchPackage(
        workspaceRoot,
        createInput({
          sources: [
            { sourceId: 'world-directory', path: 'world/locations', role: 'world' },
            characterSource(),
          ],
          entryPoint: {
            ...createInput().entryPoint,
            sourceRefs: ['world-directory'],
            location: undefined,
          },
        }),
      );
      expect(directory.diagnostics).toContainEqual(expect.objectContaining({
        code: 'invalidSource',
        sourceId: 'world-directory',
      }));

      const escaped = await previewPlayLaunchPackage(
        workspaceRoot,
        createInput({
          sources: [
            { sourceId: 'outside', path: 'world/outside.md', role: 'world' },
            characterSource(),
          ],
          entryPoint: {
            ...createInput().entryPoint,
            sourceRefs: ['outside'],
            location: undefined,
          },
        }),
      );
      expect(escaped.diagnostics).toContainEqual(expect.objectContaining({
        code: 'invalidSource',
        sourceId: 'outside',
      }));

      await expect(previewPlayLaunchPackage(
        workspaceRoot,
        createInput({
          sources: [{
            sourceId: 'escape',
            path: '../outside.md',
            role: 'other',
          }],
        }),
      )).rejects.toThrow('visible workspace-relative path');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('detects stale bytes and prevents a stale package from being written', async () => {
    const workspaceRoot = await createWorkspace();
    try {
      const preview = await previewPlayLaunchPackage(workspaceRoot, createInput());
      await writeFile(
        join(workspaceRoot, 'chapters/0001/0001.md'),
        '# Changed after preview\n',
        'utf-8',
      );

      const diagnostics = await validatePlayLaunchPackageSources(
        workspaceRoot,
        preview,
      );
      expect(diagnostics).toContainEqual(expect.objectContaining({
        code: 'staleSource',
        severity: 'error',
        expectedContentHash: preview.sourceBase.activatedSources[0]?.contentHash,
        actualContentHash: createHash('sha256')
          .update(Buffer.from('# Changed after preview\n'))
          .digest('hex'),
      }));
      await expect(writePlayLaunchPackage(workspaceRoot, preview)).rejects
        .toBeInstanceOf(PlayLaunchSourceValidationError);
      await expect(access(join(
        workspaceRoot,
        '.workspace/play-setups/setup-guided-fixture',
      ))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('rejects client-tampered source excerpts and diagnostics before confirmation', async () => {
    const workspaceRoot = await createWorkspace();
    try {
      const preview = await previewPlayLaunchPackage(workspaceRoot, createInput());
      const tamperedExcerpt = structuredClone(preview);
      tamperedExcerpt.sourceBase.activatedSources[0]!.excerpt = 'Forged evidence';
      await expect(writePlayLaunchPackage(workspaceRoot, tamperedExcerpt))
        .rejects.toMatchObject({
          diagnostics: expect.arrayContaining([
            expect.objectContaining({
              id: 'diagnostic-evidence-chapter-opening',
              code: 'invalidSource',
            }),
          ]),
        });

      const tamperedDiagnostics = structuredClone(preview);
      tamperedDiagnostics.diagnostics.push({
        id: 'diagnostic-forged-client-warning',
        code: 'invalidSource',
        severity: 'warning',
        message: 'Client-supplied evidence must not become stored truth.',
      });
      await expect(writePlayLaunchPackage(workspaceRoot, tamperedDiagnostics))
        .rejects.toMatchObject({
          diagnostics: expect.arrayContaining([
            expect.objectContaining({ id: 'diagnostic-evidence-diagnostics' }),
          ]),
        });
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('writes one immutable setup identity and strictly round-trips it', async () => {
    const workspaceRoot = await createWorkspace();
    try {
      const preview = await previewPlayLaunchPackage(workspaceRoot, createInput());
      await expect(writePlayLaunchPackage(workspaceRoot, preview)).resolves.toEqual([
        '.workspace/play-setups/setup-guided-fixture/setup.yaml',
      ]);
      const setupRoot = join(
        workspaceRoot,
        '.workspace/play-setups/setup-guided-fixture',
      );
      await expect(readdir(setupRoot)).resolves.toEqual([PLAY_LAUNCH_SETUP_FILE]);
      await expect(readPlayLaunchPackage(
        workspaceRoot,
        'setup-guided-fixture',
      )).resolves.toEqual(preview);
      await expect(writePlayLaunchPackage(workspaceRoot, preview)).rejects
        .toThrow('already exists');

      const setupPath = join(setupRoot, PLAY_LAUNCH_SETUP_FILE);
      const stored = parse(await readFile(setupPath, 'utf-8')) as Record<string, unknown>;
      await writeFile(setupPath, stringify({ ...stored, id: 'setup-other' }), 'utf-8');
      await expect(readPlayLaunchPackage(workspaceRoot, 'setup-guided-fixture'))
        .rejects.toThrow('does not match its directory identity');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('blocks persisted error diagnostics and rejects unknown fields and refs', async () => {
    const workspaceRoot = await createWorkspace();
    try {
      const missing = await previewPlayLaunchPackage(
        workspaceRoot,
        createInput({
          sources: [
            { sourceId: 'missing', path: 'chapters/0001/0099.md', role: 'chapter' },
            characterSource(),
          ],
          entryPoint: {
            ...createInput().entryPoint,
            sourceRefs: ['missing'],
            location: undefined,
          },
        }),
      );
      await expect(writePlayLaunchPackage(workspaceRoot, missing)).rejects
        .toMatchObject({
          diagnostics: expect.arrayContaining([
            expect.objectContaining({ code: 'missingSource' }),
          ]),
        });

      const preview = await previewPlayLaunchPackage(workspaceRoot, createInput());
      expect(() => normalizePlayLaunchPackage({
        ...preview,
        unknownField: true,
      })).toThrow('unknown fields');
      expect(() => normalizePlayLaunchPackage({
        ...preview,
        entryPoint: { ...preview.entryPoint, sourceRefs: ['unknown-source'] },
      })).toThrow('references unknown source');
      expect(() => normalizePlayLaunchPackage({
        ...preview,
        diagnostics: [{
          id: 'diagnostic-unknown',
          code: 'invalidSource',
          severity: 'error',
          message: 'unknown source',
          sourceId: 'unknown-source',
        }],
      })).toThrow('diagnostic references unknown source');
      expect(() => normalizePlayLaunchPackage({
        ...preview,
        sourceBase: {
          activatedSources: [{
            ...preview.sourceBase.activatedSources[0],
            hidden: true,
          }, ...preview.sourceBase.activatedSources.slice(1)],
        },
      })).toThrow('unknown fields');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('materializes a confirmed package through the existing v5 session seam', async () => {
    const workspaceRoot = await createWorkspace();
    try {
      const preview = await previewPlayLaunchPackage(workspaceRoot, createInput());
      const session = createPlaySessionFromLaunchPackage(preview, {
        id: 'play-guided-fixture',
        createdAt: CREATED_AT,
      });

      expect(session).toMatchObject({
        schemaVersion: 5,
        id: 'play-guided-fixture',
        sceneRehearsal: {
          startMode: 'guided',
          sceneContract: { sceneId: 'entry-platform' },
        },
        metadataExtensions: {
          playLaunch: {
            setupId: 'setup-guided-fixture',
            purpose: 'sceneRehearsal',
            startMode: 'guided',
          },
        },
      });
      expect(session.activatedSources).toEqual(expect.arrayContaining([
        expect.objectContaining({
          sourceId: 'chapter-opening',
          objectId: '0001/0001',
          contentHash: preview.sourceBase.activatedSources[0]?.contentHash,
          role: 'chapter',
        }),
      ]));
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

function characterSource(): PlayLaunchPackagePreviewInput['sources'][number] {
  return {
    sourceId: 'character-mira',
    path: 'characters/mira/summary.md',
    role: 'character',
    reason: 'Character identity and behavior source',
  };
}

function createInput(
  overrides: Partial<PlayLaunchPackagePreviewInput> = {},
): PlayLaunchPackagePreviewInput {
  return {
    id: 'setup-guided-fixture',
    createdAt: CREATED_AT,
    title: 'Last train rehearsal',
    purpose: 'sceneRehearsal',
    startMode: 'guided',
    simulationMode: 'reactiveWorld',
    density: 'balanced',
    sources: [{
      sourceId: 'chapter-opening',
      path: 'chapters/0001/0001.md',
      role: 'chapter',
      reason: 'Opening chapter source',
    }, characterSource()],
    entryPoint: {
      id: 'entry-platform',
      label: 'Platform entrance',
      opening: 'The last train begins to close its doors.',
      sourceRefs: ['chapter-opening'],
      location: {
        value: 'Platform nine',
        provenance: { kind: 'sourceBacked', sourceRefs: ['chapter-opening'] },
      },
      objective: {
        value: 'Test whether Mira boards the train.',
        provenance: { kind: 'authorProvided', providedAt: CREATED_AT },
      },
    },
    identity: {
      kind: 'director',
      directorPurpose: 'Rehearse Mira choosing whether to leave.',
    },
    participantRoles: [{
      participantRef: 'participant-mira',
      displayName: 'Mira',
      canonicalCharacterRef: 'mira',
      sourceRefs: ['character-mira'],
      position: 'Beside the closing door',
      currentGoal: 'Decide whether to leave the city',
      initialKnowledge: [{
        id: 'knowledge-ticket',
        fact: 'Mira has the final ticket.',
        visibility: 'playerVisible',
        sourceRefs: ['character-mira'],
      }],
    }],
    ...overrides,
  };
}

async function createWorkspace(): Promise<string> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-launch-'));
  await Promise.all([
    mkdir(join(workspaceRoot, 'chapters/0001'), { recursive: true }),
    mkdir(join(workspaceRoot, 'characters/mira'), { recursive: true }),
    mkdir(join(workspaceRoot, 'world/locations'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      join(workspaceRoot, 'chapters/0001/0001.md'),
      '# Last train\n\nThe doors begin to close.\n',
      'utf-8',
    ),
    writeFile(
      join(workspaceRoot, 'characters/mira/summary.md'),
      '# Mira\n\nShe fears leaving familiar places.\n',
      'utf-8',
    ),
    writeFile(
      join(workspaceRoot, 'world/overview.md'),
      '# World\n',
      'utf-8',
    ),
  ]);
  return workspaceRoot;
}
