import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createNovelHonoApp } from '@oh-awesome-novel/backend';
import { initWorkspace } from '@oh-awesome-novel/core';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

describe('Writing Profile HTTP API', () => {
  it('provides strict CRUD, read-only built-ins and active-delete protection', async () => {
    const app = createNovelHonoApp({
      workspaceRoot: await createWorkspace(),
    });

    const initial = await requestJson(app, '/api/workspace/writing-profiles');
    expect(initial.response.status).toBe(200);
    expect(initial.data).toMatchObject({
      state: {
        activeProfileId: 'commercialWriting',
        profiles: [
          { builtIn: true, profile: { id: 'commercialWriting' } },
          { builtIn: true, profile: { id: 'fanfictionWriting' } },
        ],
      },
    });

    const invalid = await requestJson(app, '/api/workspace/writing-profiles', {
      method: 'POST',
      body: JSON.stringify({
        ...profile('custom-profile'),
        genreType: 'fantasy',
      }),
    });
    expect(invalid.response.status).toBe(400);

    const created = await requestJson(app, '/api/workspace/writing-profiles', {
      method: 'POST',
      body: JSON.stringify(profile('custom-profile')),
    });
    expect(created.response.status).toBe(200);

    const builtinEdit = await requestJson(
      app,
      '/api/workspace/writing-profiles/commercialWriting',
      {
        method: 'PATCH',
        body: JSON.stringify(profile('commercialWriting')),
      },
    );
    expect(builtinEdit.response.status).toBe(409);

    const activated = await requestJson(
      app,
      '/api/workspace/writing-profiles/custom-profile/activate',
      { method: 'POST', body: '{}' },
    );
    expect(activated.data).toMatchObject({
      state: { activeProfileId: 'custom-profile' },
    });

    const activeDelete = await requestJson(
      app,
      '/api/workspace/writing-profiles/custom-profile',
      { method: 'DELETE' },
    );
    expect(activeDelete.response.status).toBe(409);

    await requestJson(
      app,
      '/api/workspace/writing-profiles/commercialWriting/activate',
      { method: 'POST', body: '{}' },
    );
    const deleted = await requestJson(
      app,
      '/api/workspace/writing-profiles/custom-profile',
      { method: 'DELETE' },
    );
    expect(deleted.response.status).toBe(200);
    expect((deleted.data as {
      state: { profiles: Array<{ profile: { id: string } }> };
    }).state.profiles.some((item) =>
      item.profile.id === 'custom-profile')).toBe(false);
  });

  it('clones a complete preset and applies the Profile gate before D5 selection', async () => {
    const app = createNovelHonoApp({
      workspaceRoot: await createWorkspace(),
    });
    const cloned = await requestJson(
      app,
      '/api/workspace/writing-profiles/fanfictionWriting/clone',
      {
        method: 'POST',
        body: JSON.stringify({
          id: 'fanfiction-copy',
          displayName: 'Fanfiction Copy',
        }),
      },
    );
    expect(cloned.response.status).toBe(200);
    expect(cloned.data).toMatchObject({
      state: {
        profiles: expect.arrayContaining([
          expect.objectContaining({
            builtIn: false,
            profile: expect.objectContaining({
              id: 'fanfiction-copy',
              deconstruction: {
                outputs: ['world', 'characters', 'relationships', 'outline', 'timeline'],
              },
            }),
          }),
        ]),
      },
    });

    await requestJson(
      app,
      '/api/workspace/writing-profiles/fanfictionWriting/activate',
      { method: 'POST', body: '{}' },
    );
    const selection = await requestJson(
      app,
      '/api/workspace/references/context',
      {
        method: 'POST',
        body: JSON.stringify({
          capability: 'novel.write_chapter',
          goal: '参考作品中的节奏技巧',
        }),
      },
    );
    expect(selection.response.status).toBe(200);
    expect(selection.data).toMatchObject({
      selection: {
        usedTokens: 0,
        included: [],
        omitted: [],
        profileOmission: {
          reasonCode: 'profileExcludesTechniques',
        },
      },
    });
  });
});

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'oan-backend-writing-profile-'));
  roots.push(root);
  await initWorkspace(root);
  return root;
}

async function requestJson(
  app: ReturnType<typeof createNovelHonoApp>,
  path: string,
  init?: RequestInit,
): Promise<{ response: Response; data: unknown }> {
  const response = await app.request(path, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  return {
    response,
    data: await response.json(),
  };
}

function profile(id: string) {
  return {
    version: 1,
    id,
    displayName: 'Custom Profile',
    description: 'Strict transport fixture.',
    deconstruction: { outputs: ['techniques', 'world'] },
    writingReminders: {
      originality: true,
      aiVoice: false,
      characterConsistency: true,
      adaptationFreedom: false,
    },
  };
}
