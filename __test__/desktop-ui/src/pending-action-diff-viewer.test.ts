// @vitest-environment happy-dom

import type { PendingActionViewV1 } from '@oh-awesome-novel/client';
import type { UIMessage } from 'ai';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import PendingActionCard from '../../../apps/desktop-ui/src/components/agent-checkpoint/PendingActionCard.vue';
import DiffReviewTab from '../../../apps/desktop-ui/src/components/workspace/DiffReviewTab.vue';
import { collectPendingActions } from '../../../apps/desktop-ui/src/composables/useAgentCheckpointChat';

describe('PendingAction change-engine review', () => {
  it('labels operations from changes and keeps untrusted diff markup as plain text', async () => {
    const action = createAction();
    const wrapper = mount(PendingActionCard, { props: { action } });

    expect(wrapper.text()).toContain(
      '3 file changes · 1 created · 1 updated · 1 deleted',
    );

    await button(wrapper, 'Diff').trigger('click');

    const rows = wrapper.findAll('[data-operation]');
    expect(rows.map((row) => ({
      operation: row.attributes('data-operation'),
      text: row.text(),
    }))).toEqual([{
      operation: 'delete',
      text: 'notes/旧 文件.mddeleted',
    }, {
      operation: 'update',
      text: 'world/城 市.yamlupdated',
    }, {
      operation: 'create',
      text: '章节 草稿/第一章.mdcreated',
    }]);

    const diff = wrapper.get('[aria-label="PendingAction diff text"]');
    expect(diff.text()).toContain('<img src=x onerror="globalThis.pwned=true">');
    expect(diff.html()).toContain('&lt;img');
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('[onerror]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('.workspace/change-engine/v1/drafts/secret.md');
  });

  it('passes the authoritative changes through the workspace diff tab', () => {
    const action = createAction();
    const wrapper = mount(DiffReviewTab, {
      props: { actions: [action] },
    });

    const changeList = wrapper.get('[aria-label="PendingAction file changes"]');
    expect(changeList.text()).toContain('章节 草稿/第一章.mdcreated');
    expect(changeList.text()).toContain('world/城 市.yamlupdated');
    expect(changeList.text()).toContain('notes/旧 文件.mddeleted');
    expect(changeList.text()).not.toContain('forged/from-diff.md');
  });

  it('strictly parses streamed PendingAction data before it reaches review', () => {
    const action = createStrictAction();
    const messages = [{
      id: 'message-1',
      role: 'assistant',
      parts: [{ type: 'data-pending-action', data: action }],
    }] as UIMessage[];

    expect(collectPendingActions(messages)).toEqual([action]);
    expect(() => collectPendingActions([{
      id: 'message-2',
      role: 'assistant',
      parts: [{
        type: 'data-pending-action',
        data: { ...action, changes: undefined },
      }],
    }] as UIMessage[])).toThrow('PendingActionView');
  });

  it('offers action-scoped quick commit only for accepted Git recovery states', async () => {
    const quickCommit = vi.fn();
    const action: PendingActionViewV1 = {
      ...createStrictAction(),
      status: 'accepted',
      decidedAt: '2026-08-12T04:01:00.000Z',
      git: {
        status: 'staged-not-committed',
        branch: 'main',
        errorCode: 'git_commit_failed',
      },
    };
    const wrapper = mount(PendingActionCard, {
      props: { action, onQuickCommit: quickCommit },
    });

    await button(wrapper, 'Quick commit').trigger('click');

    expect(quickCommit).toHaveBeenCalledWith(action);
    expect(wrapper.findAll('button').some((candidate) => candidate.text() === 'Accept')).toBe(false);
  });

});

function createAction(): PendingActionViewV1 {
  return {
    id: 'pa_change_engine_review_1',
    title: 'Review final file changes',
    description: 'Three canonical files will change after approval.',
    status: 'pending',
    createdAt: '2026-08-12T04:00:00.000Z',
    changes: [{
      operation: 'delete',
      path: 'notes/旧 文件.md',
      oldHash: 'd'.repeat(64),
    }, {
      operation: 'update',
      path: 'world/城 市.yaml',
      oldHash: 'b'.repeat(64),
      newHash: 'c'.repeat(64),
    }, {
      operation: 'create',
      path: '章节 草稿/第一章.md',
      newHash: 'a'.repeat(64),
      // Deliberately model an unexpected internal field: the component must
      // only project the public operation/path contract.
      draft: {
        relativePath: '.workspace/change-engine/v1/drafts/secret.md',
      },
    }],
    diff: [
      'diff --git a/forged/from-diff.md b/forged/from-diff.md',
      '--- a/forged/from-diff.md',
      '+++ b/forged/from-diff.md',
      '@@ -0,0 +1 @@',
      '+<img src=x onerror="globalThis.pwned=true">',
    ].join('\n'),
  } as PendingActionViewV1;
}

function createStrictAction(): PendingActionViewV1 {
  const action = createAction();
  return {
    ...action,
    changes: action.changes.map((change) => ({
      operation: change.operation,
      path: change.path,
      ...('oldHash' in change ? { oldHash: change.oldHash } : {}),
      ...('newHash' in change ? { newHash: change.newHash } : {}),
    })),
  };
}

function button(wrapper: ReturnType<typeof mount>, text: string) {
  const match = wrapper.findAll('button').find((candidate) => candidate.text() === text);
  if (!match) throw new Error(`Missing button: ${text}`);
  return match;
}
