// @vitest-environment happy-dom

import type { ChatStatus, UIMessage } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlayWritingReferenceAttachment } from '@oh-awesome-novel/client';

interface MockChatInstance {
  messages: UIMessage[];
  status: ChatStatus;
  sendMessage: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

const chatHarness = vi.hoisted(() => ({
  instances: [] as MockChatInstance[],
}));

const api = vi.hoisted(() => ({
  createAgentChatTransport: vi.fn(() => ({})),
  listPlayWritingReferenceAttachments: vi.fn(),
}));

vi.mock('@ai-sdk/vue', () => ({
  Chat: class MockChat {
    messages: UIMessage[] = [];
    status: ChatStatus = 'ready';
    sendMessage = vi.fn();
    stop = vi.fn();

    constructor() {
      chatHarness.instances.push(this);
    }
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
          writingReferenceAttachmentIds: ['attachment-1', 'attachment-2'],
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
      { body: { writingReferenceAttachmentIds: [] } },
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
    chatHarness.instances[0]!.messages.push({
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
