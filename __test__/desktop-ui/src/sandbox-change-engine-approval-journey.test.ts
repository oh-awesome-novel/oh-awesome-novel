// @vitest-environment happy-dom

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { flushPromises, mount } from '@vue/test-utils';
import { createOanClient } from '@oh-awesome-novel/client';
import type {
  PendingActionDecisionEnvelopeV1,
  WorkspaceSummary,
} from '@oh-awesome-novel/client';
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { startNovelHttpBackend } from '@oh-awesome-novel/backend';
import type { NovelBackendHandle } from '@oh-awesome-novel/backend';

const clientHarness = vi.hoisted(() => {
  let current: Record<PropertyKey, unknown> | undefined;
  let acceptResult: unknown;
  let acceptFailure: unknown;
  const proxy = new Proxy<Record<PropertyKey, unknown>>({}, {
    get(_target, property) {
      if (!current) {
        throw new Error('The real OAN client has not been installed in the test harness.');
      }

      const member = current[property];
      if (typeof member !== 'function') return member;

      return (...args: unknown[]) => {
        const result = Reflect.apply(member, current, args);
        if (property !== 'acceptPendingAction') return result;

        return Promise.resolve(result).then((value) => {
          acceptResult = value;
          return value;
        }, (error: unknown) => {
          acceptFailure = error;
          throw error;
        });
      };
    },
  });

  return {
    proxy,
    install(client: object) {
      current = client as Record<PropertyKey, unknown>;
      acceptResult = undefined;
      acceptFailure = undefined;
    },
    accepted() {
      return acceptResult;
    },
    failure() {
      return acceptFailure;
    },
    reset() {
      current = undefined;
      acceptResult = undefined;
      acceptFailure = undefined;
    },
  };
});

vi.mock('../../../apps/desktop-ui/src/client', () => ({
  oanClient: clientHarness.proxy,
}));

import WorkspaceShell from '../../../apps/desktop-ui/src/components/workspace/WorkspaceShell.vue';

const JOURNEY_TIMEOUT_MS = 20_000;
const execFileAsync = promisify(execFile);
const tempRoots: string[] = [];
const backends: NovelBackendHandle[] = [];
const targetPath = 'chapters/0001/9999.md';
const targetBytes = '# 闯卡验证\n\n这里是一次待审批的写入预览。\n';

afterEach(async () => {
  clientHarness.reset();
  localStorage.clear();

  for (const backend of backends.splice(0)) {
    await backend.close();
  }
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('Sandbox Change Engine approval journey', () => {
  it('keeps a checkpoint edit virtual until a user accepts it through the production review UI', async () => {
    const workspaceRoot = await createWorkspace();
    const globalConfigDir = await createTempRoot('oan-desktop-config-');
    const target = join(workspaceRoot, targetPath);
    const initialHead = await git(workspaceRoot, 'rev-parse', 'HEAD');
    const backend = await startNovelHttpBackend({
      workspaceRoot,
      globalConfigDir,
      mode: 'checkpoint',
    });
    backends.push(backend);

    const client = createOanClient({ backendBaseUrl: backend.url });
    clientHarness.install(client);

    const chatResponse = await fetch(`${backend.url}/api/agent/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [{
          id: 'approval-journey-user',
          role: 'user',
          parts: [{ type: 'text', text: 'Level 3 pending validation' }],
        }],
        editContext: { exactWritablePaths: [targetPath] },
      }),
    });
    const streamedBody = await chatResponse.text();

    expect(chatResponse.status).toBe(200);
    expect(streamedBody).toContain('data-pending-action');
    await expect(readFile(target, 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await git(workspaceRoot, 'rev-parse', 'HEAD')).toBe(initialHead);

    const listed = await client.listPendingActions();
    expect(listed.pendingActions).toHaveLength(1);
    expect(listed.pendingActions[0]).toMatchObject({
      status: 'pending',
      changes: [{ operation: 'create', path: targetPath }],
    });
    expect(Object.hasOwn(listed.pendingActions[0]!, 'schemaVersion')).toBe(false);

    rememberOpenApprovalPanel(workspaceRoot);
    const workspace = workspaceSummary(workspaceRoot);
    let wrapper = mountWorkspace(workspace);
    await flushPromises();

    await vi.waitFor(() => {
      expect(wrapper.get('[data-test="pending-action-count"]').text()).toBe('1');
      expect(wrapper.get('.pending-card').text()).toContain(`Created: ${targetPath}`);
    }, { timeout: JOURNEY_TIMEOUT_MS });
    expect(await git(workspaceRoot, 'rev-parse', 'HEAD')).toBe(initialHead);
    await expect(readFile(target, 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });

    await cardButton(wrapper, 'Diff').trigger('click');
    await flushPromises();
    expect(wrapper.get('[aria-label="PendingAction diff text"]').text()).toContain(
      '这里是一次待审批的写入预览。',
    );

    await tabButton(wrapper, 'Approval').trigger('click');
    await flushPromises();
    await cardButton(wrapper, 'Accept').trigger('click');

    const result = await decisionAfterAccept();
    expect(result.receipt).toMatchObject({
      decision: 'accepted',
      materialization: 'committed',
      git: { status: 'committed' },
    });
    await flushPromises();

    expect(await readFile(target, 'utf-8')).toBe(targetBytes);
    expect(await git(workspaceRoot, 'rev-parse', 'HEAD')).not.toBe(initialHead);
    expect(await git(
      workspaceRoot,
      'diff-tree',
      '--no-commit-id',
      '--name-only',
      '-r',
      'HEAD',
    )).toBe(targetPath);
    expect(await git(workspaceRoot, 'status', '--porcelain')).toBe('');
    await vi.waitFor(() => {
      expect(wrapper.get('[aria-label="PendingAction approval"]').text()).toContain(
        'No pending actions.',
      );
      expect(wrapper.get('[data-test="pending-action-count"]').text()).toBe('0');
    }, { timeout: JOURNEY_TIMEOUT_MS });

    wrapper.unmount();
    wrapper = mountWorkspace(workspace);
    await flushPromises();

    await vi.waitFor(() => {
      expect(wrapper.get('[aria-label="PendingAction approval"]').text()).toContain(
        'No pending actions.',
      );
      expect(wrapper.get('[data-test="pending-action-count"]').text()).toBe('0');
    }, { timeout: JOURNEY_TIMEOUT_MS });
    await expect(client.listPendingActions()).resolves.toEqual({ pendingActions: [] });
    await expect(client.getWorkspaceStatus()).resolves.toMatchObject({
      pendingActionCount: 0,
      git: { status: 'clean', dirty: false },
    });

    wrapper.unmount();
  });
});

async function decisionAfterAccept(): Promise<PendingActionDecisionEnvelopeV1> {
  const deadline = Date.now() + JOURNEY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const failure = clientHarness.failure();
    if (failure) throw failure;
    const accepted = clientHarness.accepted() as PendingActionDecisionEnvelopeV1 | undefined;
    if (accepted) return accepted;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `Accept did not return a decision receipt within ${JOURNEY_TIMEOUT_MS}ms.`,
  );
}

async function createWorkspace(): Promise<string> {
  const root = await createTempRoot('oan-desktop-approval-');

  await mkdir(join(root, '.oan'), { recursive: true });
  await mkdir(join(root, 'chapters/0001'), { recursive: true });
  await mkdir(join(root, 'summaries/chapter/0001'), { recursive: true });
  await writeFile(join(root, '.gitignore'), '.workspace/\n.oan/sessions/\n', 'utf-8');
  await writeFile(
    join(root, '.oan/config.yaml'),
    'version: 1\nnovelName: approval-journey\ngit:\n  autoCommitOnAccept: true\n',
    'utf-8',
  );
  await writeFile(
    join(root, '.oan/workflow.yaml'),
    'name: lightnovel\nsteps:\n  - chapter\n',
    'utf-8',
  );
  await writeFile(join(root, 'chapters/0001/0000.md'), '# 第一卷\n', 'utf-8');
  await writeFile(
    join(root, 'summaries/chapter/0001/0000.md'),
    '# 第一卷\n\n基线摘要。\n',
    'utf-8',
  );

  await git(root, 'init');
  await git(root, 'config', 'user.email', 'approval-journey@example.test');
  await git(root, 'config', 'user.name', 'Approval Journey');
  await git(root, 'add', '.');
  await git(root, 'commit', '-m', 'test: establish approval journey baseline');
  return root;
}

async function createTempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function rememberOpenApprovalPanel(workspaceRoot: string): void {
  localStorage.setItem(`oan:workspace-ui:${workspaceRoot}`, JSON.stringify({
    version: 1,
    workspaceMode: 'writing',
    leftPinned: false,
    rightShown: true,
    rightTab: 'approval',
    rightWidthPercent: 36,
    sidebarTab: 'files',
  }));
}

function workspaceSummary(path: string): WorkspaceSummary {
  return {
    name: 'approval-journey',
    novelName: 'approval-journey',
    path,
    valid: true,
  };
}

function mountWorkspace(workspace: WorkspaceSummary) {
  return mount(WorkspaceShell, {
    props: {
      workspace,
      providerConfigured: true,
      theme: 'dark',
      startGuide: false,
      mode: 'writing',
    },
    global: {
      stubs: {
        WorkspaceToolbar: {
          props: ['pendingActionCount'],
          template: '<output data-test="pending-action-count">{{ pendingActionCount }}</output>',
        },
        WorkspaceLeftPanel: true,
        WorkspaceLeftHoverRail: true,
        WorkspaceOnboardingGuide: true,
        CopilotPanel: true,
        PlayWorkspace: true,
        FileViewer: true,
        GitReviewTab: true,
        ProjectHealthTab: true,
        ReferenceImportTab: true,
        WritingProfileManagerTab: true,
      },
    },
  });
}

function cardButton(wrapper: ReturnType<typeof mount>, text: string) {
  const match = wrapper
    .get('.pending-card')
    .findAll('button')
    .find((candidate) => candidate.text() === text);
  if (!match) throw new Error(`Missing PendingAction button: ${text}`);
  return match;
}

function tabButton(wrapper: ReturnType<typeof mount>, text: string) {
  const match = wrapper
    .get('[role="tablist"]')
    .findAll('[role="tab"]')
    .find((candidate) => candidate.text() === text);
  if (!match) throw new Error(`Missing review tab: ${text}`);
  return match;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}
