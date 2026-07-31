import { describe, expect, it } from 'vitest';

import {
  createOanClient,
  type WritingProfile,
  type WritingProfileState,
} from '@oh-awesome-novel/client';

describe('Writing Profile client', () => {
  it('routes strict Profile CRUD and activate requests', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return jsonResponse({ state: writingProfileState() });
    }) as typeof fetch;
    const client = createOanClient({
      backendBaseUrl: 'http://backend.test/',
      fetch: fetcher,
    });
    const profile = customProfile();

    await client.getWritingProfiles();
    await client.createWritingProfile(profile);
    await client.cloneWritingProfile('fanfictionWriting', {
      id: 'fanfiction-copy',
      displayName: '同人副本',
    });
    await client.updateWritingProfile(profile.id, profile);
    await client.activateWritingProfile(profile.id);
    await client.deleteWritingProfile(profile.id);

    expect(calls.map((call) => [
      call.url,
      call.init?.method,
    ])).toEqual([
      ['http://backend.test/api/workspace/writing-profiles', 'GET'],
      ['http://backend.test/api/workspace/writing-profiles', 'POST'],
      [
        'http://backend.test/api/workspace/writing-profiles/fanfictionWriting/clone',
        'POST',
      ],
      [
        'http://backend.test/api/workspace/writing-profiles/custom-profile',
        'PATCH',
      ],
      [
        'http://backend.test/api/workspace/writing-profiles/custom-profile/activate',
        'POST',
      ],
      [
        'http://backend.test/api/workspace/writing-profiles/custom-profile',
        'DELETE',
      ],
    ]);
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({
      id: 'fanfiction-copy',
      displayName: '同人副本',
    });
    expect(JSON.parse(String(calls[4]?.init?.body))).toEqual({});
  });

  it('rejects unknown request and response fields at the client boundary', async () => {
    const invalidResponse = createOanClient({
      backendBaseUrl: 'http://backend.test',
      fetch: (async () => jsonResponse({
        state: {
          ...writingProfileState(),
          sourceBinding: 'forbidden',
        },
      })) as typeof fetch,
    });
    await expect(invalidResponse.getWritingProfiles())
      .rejects
      .toThrow('response is invalid');

    const client = createOanClient({
      backendBaseUrl: 'http://backend.test',
      fetch: (async () => jsonResponse({
        state: writingProfileState(),
      })) as typeof fetch,
    });
    expect(() => client.createWritingProfile({
      ...customProfile(),
      genreType: 'fantasy',
    } as never)).toThrow('payload is invalid');
    expect(() => client.cloneWritingProfile('fanfictionWriting', {
      id: 'fanfiction-copy',
      sourceBinding: 'reference-1',
    } as never)).toThrow('clone request is invalid');
  });

  it('accepts the typed D5 Profile omission without reference entries', async () => {
    const client = createOanClient({
      backendBaseUrl: 'http://backend.test',
      fetch: (async () => jsonResponse({
        selection: {
          tokenBudget: 1500,
          maxReferences: 3,
          maxEntries: 8,
          usedTokens: 0,
          originalSourceRead: false,
          noCopyWarnings: [],
          differentiationWarnings: [],
          profileOmission: {
            reasonCode: 'profileExcludesTechniques',
            reason: 'The active Writing Profile excludes abstract techniques.',
          },
          included: [],
          omitted: [],
        },
      })) as typeof fetch,
    });

    await expect(client.selectReferenceContext({
      capability: 'novel.write_chapter',
      goal: '参考作品中的节奏技巧',
    })).resolves.toMatchObject({
      selection: {
        profileOmission: {
          reasonCode: 'profileExcludesTechniques',
        },
      },
    });
  });
});

function writingProfileState(): WritingProfileState {
  const commercial: WritingProfile = {
    version: 1,
    id: 'commercialWriting',
    displayName: '商业写作',
    description: '商业写作预设。',
    deconstruction: { outputs: ['techniques'] },
    writingReminders: {
      originality: true,
      aiVoice: true,
      characterConsistency: false,
      adaptationFreedom: false,
    },
  };
  return {
    activeProfileId: commercial.id,
    activeProfile: commercial,
    profiles: [
      { profile: commercial, builtIn: true, active: true },
    ],
    fallbackUsed: false,
    profileErrors: [],
    summary: {
      profileId: commercial.id,
      displayName: commercial.displayName,
      outputs: ['techniques'],
      reminders: ['originality', 'aiVoice'],
    },
  };
}

function customProfile(): WritingProfile {
  return {
    version: 1,
    id: 'custom-profile',
    displayName: 'Custom',
    description: 'Custom profile.',
    deconstruction: { outputs: ['techniques', 'world'] },
    writingReminders: {
      originality: true,
      aiVoice: false,
      characterConsistency: true,
      adaptationFreedom: false,
    },
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
