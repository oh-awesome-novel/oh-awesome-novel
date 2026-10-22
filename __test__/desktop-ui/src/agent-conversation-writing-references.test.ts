// @vitest-environment happy-dom

import type { ChatStatus, UIMessage } from 'ai';
import { shallowRef, type ShallowRef } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlayWritingReferenceAttachment } from '@oh-awesome-novel/client';

interface MockChatInstance {
  messages: ShallowRef<UIMessage[]>;
  status: ShallowRef<ChatStatus>;
  error: ShallowRef<Error | undefined>;
  sendMessage: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

const chatHarness = vi.hoisted(() => ({
  instances: [] as MockChatInstance[],
}));

const api = vi.hoisted(() => ({
  createAgentChatTransport: vi.fn(() => ({})),
  listPlayWritingReferenceAttachments: vi.fn(),
  readCanonicalWritingSources: vi.fn(),
  saveCanonicalWritingSources: vi.fn(),
}));

vi.mock('@ai-sdk/vue', () => ({
  useChat: () => {
    const chat: MockChatInstance = {
      messages: shallowRef<UIMessage[]>([]),
      status: shallowRef<ChatStatus>('ready'),
      error: shallowRef<Error>(),
      sendMessage: vi.fn(),
      stop: vi.fn(),
    };
    chatHarness.instances.push(chat);
    return chat;
  },
}));

vi.mock('../../../apps/desktop-ui/src/client', () => ({ oanClient: api }));

import {
  MAX_WRITING_REFERENCE_ATTACHMENTS_PER_REQUEST,
  useAgentConversationSessions,
} from '../../../apps/desktop-ui/src/composables/useAgentConversationSessions';

describe('agent conversation Play Writing References', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    chatHarness.instances.length = 0;
    api.createAgentChatTransport.mockReturnValue({});
    api.listPlayWritingReferenceAttachments.mockResolvedValue({
      attachments: Array.from({ length: 9 }, (_, index) =>
        createAttachment(`attachment-${index + 1}`)),
    });
  });

  it('keeps canonical Forge sources selected across success and failure until explicitly removed', async () => {
    const conversations = useAgentConversationSessions();
    conversations.selectCanonicalWritingSources(['characters/lead/profile.md']);
    conversations.activeInput.value = '写开场';
    const chat = chatHarness.instances[0]!;
    chat.sendMessage.mockRejectedValueOnce(new Error('offline'));
    await expect(conversations.sendCurrentInput()).rejects.toThrow('offline');
    expect(conversations.canonicalWritingSourcePaths.value).toEqual(['characters/lead/profile.md']);
    chat.sendMessage.mockResolvedValueOnce(undefined);
    await conversations.sendCurrentInput();
    expect(chat.sendMessage).toHaveBeenLastCalledWith({ text: '写开场' }, expect.objectContaining({ body: expect.objectContaining({ canonicalWritingSourcePaths: ['characters/lead/profile.md'], editContext: { exactWritablePaths: [] } }) }));
    expect(conversations.canonicalWritingSourcePaths.value).toEqual(['characters/lead/profile.md']);
    conversations.dispose();
  });

  it('reloads project sources, persists removal, and ignores a late different-workspace response', async () => {
    let workspace = '/project-a';
    const saved = new Map<string, string[]>([['/project-a', ['characters/lead/profile.md']]]);
    api.readCanonicalWritingSources.mockImplementation(async (root: string) => ({ sourcePaths: saved.get(root) ?? [] }));
    api.saveCanonicalWritingSources.mockImplementation(async (root: string, sourcePaths: string[]) => { saved.set(root, sourcePaths); return { sourcePaths }; });
    const first = useAgentConversationSessions({ getWorkspacePath: () => workspace });
    await first.refreshCanonicalWritingSources();
    expect(first.canonicalWritingSourcePaths.value).toEqual(['characters/lead/profile.md']);
    await first.removeCanonicalWritingSource('characters/lead/profile.md');
    first.dispose();
    const reopened = useAgentConversationSessions({ getWorkspacePath: () => workspace });
    await reopened.refreshCanonicalWritingSources();
    expect(reopened.canonicalWritingSourcePaths.value).toEqual([]);
    let resolve!: (value: { sourcePaths: string[] }) => void;
    api.readCanonicalWritingSources.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const delayed = reopened.refreshCanonicalWritingSources();
    await Promise.resolve();
    workspace = '/project-b';
    await reopened.refreshCanonicalWritingSources(true);
    resolve({ sourcePaths: ['characters/lead/profile.md'] });
    await delayed;
    expect(reopened.canonicalWritingSourcePaths.value).toEqual([]);
    reopened.dispose();
  });
  it('freezes canonical references into queued follow-ups', async () => {
    const conversations = useAgentConversationSessions();
    const chat = chatHarness.instances[0]!;
    chat.status.value = 'streaming';
    conversations.selectCanonicalWritingSources(['characters/lead/profile.md']);
    conversations.activeInput.value = '带设定的下一轮';
    await conversations.sendCurrentInput();
    expect(conversations.activeFollowUps.value[0]).toMatchObject({ canonicalWritingSourcePaths: ['characters/lead/profile.md'] });
    conversations.selectCanonicalWritingSources(['world/rules.md']);
    expect(conversations.activeFollowUps.value[0]?.canonicalWritingSourcePaths).toEqual(['characters/lead/profile.md']);
    conversations.dispose();
  });

  it('sends selected attachments once, preserves them on failure, and clears on success', async () => {
    const conversations = useAgentConversationSessions();
    await conversations.refreshWritingReferences();
    conversations.toggleWritingReferenceAttachment('attachment-1');
    conversations.toggleWritingReferenceAttachment('attachment-2');
    conversations.activeInput.value = 'Use the selected Play outcome';
    const chat = chatHarness.instances[0]!;
    chat.sendMessage.mockRejectedValueOnce(new Error('stream unavailable'));

    await expect(conversations.sendCurrentInput()).rejects.toThrow('stream unavailable');

    expect(conversations.activeInput.value).toBe('Use the selected Play outcome');
    expect(conversations.selectedWritingReferenceAttachmentIds.value).toEqual([
      'attachment-1',
      'attachment-2',
    ]);
    expect(chat.sendMessage).toHaveBeenLastCalledWith(
      { text: 'Use the selected Play outcome' },
      {
        body: {
          sessionId: expect.any(String),
          turnId: expect.stringMatching(/^turn-/),
          writingReferenceAttachmentIds: ['attachment-1', 'attachment-2'],
          editContext: { exactWritablePaths: [] },
        },
      },
    );

    chat.sendMessage.mockResolvedValueOnce(undefined);
    await conversations.sendCurrentInput();

    expect(conversations.activeInput.value).toBe('');
    expect(conversations.selectedWritingReferenceAttachmentIds.value).toEqual([]);

    conversations.activeInput.value = 'A second request';
    chat.sendMessage.mockResolvedValueOnce(undefined);
    await conversations.sendCurrentInput();
    expect(chat.sendMessage).toHaveBeenLastCalledWith(
      { text: 'A second request' },
      {
        body: {
          sessionId: expect.any(String),
          turnId: expect.stringMatching(/^turn-/),
          writingReferenceAttachmentIds: [],
          editContext: { exactWritablePaths: [] },
        },
      },
    );
  });

  it('sends only host-selected exact writable paths as edit context', async () => {
    const conversations = useAgentConversationSessions({
      getExactWritablePaths: () => ['chapters/0001.md'],
    });
    const chat = chatHarness.instances[0]!;
    chat.sendMessage.mockResolvedValueOnce(undefined);
    conversations.activeInput.value = 'Revise the open chapter';

    await conversations.sendCurrentInput();

    expect(chat.sendMessage).toHaveBeenCalledWith(
      { text: 'Revise the open chapter' },
      {
        body: {
          sessionId: expect.any(String),
          turnId: expect.stringMatching(/^turn-/),
          writingReferenceAttachmentIds: [],
          editContext: { exactWritablePaths: ['chapters/0001.md'] },
        },
      },
    );
  });

  it('enforces eight selections and clears them for new or switched conversations', async () => {
    const conversations = useAgentConversationSessions();
    await conversations.refreshWritingReferences();

    for (let index = 1; index <= 9; index += 1) {
      conversations.toggleWritingReferenceAttachment(`attachment-${index}`);
    }
    expect(conversations.selectedWritingReferenceAttachmentIds.value).toHaveLength(
      MAX_WRITING_REFERENCE_ATTACHMENTS_PER_REQUEST,
    );
    expect(conversations.selectedWritingReferenceAttachmentIds.value).not.toContain(
      'attachment-9',
    );

    const initialId = conversations.activeConversationId.value;
    chatHarness.instances[0]!.messages.value.push({
      id: 'message-1',
      role: 'user',
      parts: [{ type: 'text', text: 'Existing conversation' }],
    });
    const nextId = conversations.createConversation();
    expect(nextId).not.toBe(initialId);
    expect(conversations.selectedWritingReferenceAttachmentIds.value).toEqual([]);

    conversations.toggleWritingReferenceAttachment('attachment-1');
    conversations.selectConversation(initialId);
    expect(conversations.activeConversationId.value).toBe(initialId);
    expect(conversations.selectedWritingReferenceAttachmentIds.value).toEqual([]);
  });

  it('drops detached or stale selections when the attachment event refreshes the list', async () => {
    const conversations = useAgentConversationSessions();
    await conversations.refreshWritingReferences();
    conversations.toggleWritingReferenceAttachment('attachment-1');
    conversations.toggleWritingReferenceAttachment('attachment-2');
    api.listPlayWritingReferenceAttachments.mockResolvedValueOnce({
      attachments: [
        { ...createAttachment('attachment-1'), status: 'detached' },
        { ...createAttachment('attachment-2'), status: 'stale' },
        createAttachment('attachment-3'),
      ],
    });

    await conversations.refreshWritingReferences();

    expect(conversations.selectedWritingReferenceAttachmentIds.value).toEqual([]);
    expect(conversations.writingReferenceAttachments.value.map((attachment) =>
      attachment.status)).toEqual(['detached', 'stale', 'active']);
  });
});

function createAttachment(id: string): PlayWritingReferenceAttachment {
  return {
    schemaVersion: 1,
    id,
    sessionId: 'play-1',
    reportRef: '.workspace/play-sessions/play-1/reports/outcome.yaml',
    reportFingerprint: 'a'.repeat(64),
    selectedOutcomeItemRefs: [`item-${id}`],
    selectedArtifactTurnRefs: ['turn-public'],
    evidenceClosureRefs: ['artifact:turn-public'],
    sourceSnapshots: [],
    status: 'active',
    createdAt: '2026-07-16T00:00:00.000Z',
  };
}
