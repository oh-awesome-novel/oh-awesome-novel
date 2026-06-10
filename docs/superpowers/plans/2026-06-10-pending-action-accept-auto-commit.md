# Configurable PendingAction Git Commit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PendingAction accept create a Git commit by default, allow workspace config to disable that behavior, and provide a quick commit UI action for users who prefer committing manually.

**Architecture:** AI-generated changes remain proposals stored under `.workspace` until Human Approval. `acceptPendingAction()` is the approval boundary: it materializes touched files, then either auto-commits touched files when `git.autoCommitOnAccept` is enabled or returns visible dirty state when it is disabled. Quick commit is a user-triggered Git operation exposed through backend/UI, not an AI action.

**Tech Stack:** TypeScript, Node.js `child_process.execFile`, existing `packages/core`, `packages/tools`, `packages/backend`, Vue desktop UI, Vitest workspaces.

---

## File Structure

- Modify: `packages/core/src/workspace.ts`
  - Add workspace config loading for `.oan/config.yaml`.
  - Define `git.autoCommitOnAccept` defaulting to `true`.
- Modify: `__test__/core/src/workspace.test.ts`
  - Cover default config and explicit disabled config.
- Create: `packages/tools/src/git-integration.ts`
  - Small helper for `git diff`, `git status`, `git add`, `git commit`, and deterministic PendingAction commit messages.
- Modify: `packages/tools/src/write-intent-tools.ts`
  - Add `autoCommitOnAccept` option to `acceptPendingAction()`.
  - Return structured commit result: `committed`, `skipped`, or `failed`.
- Modify: `__test__/tools/src/write-intent-tools.test.ts`
  - Cover default auto commit, disabled auto commit, reject no commit, touched-files-only commit, and commit failure.
- Modify: `packages/backend/src/index.ts`
  - Resolve workspace Git config before accepting a PendingAction when backend approval endpoints are added.
  - Add quick commit endpoint for current dirty state.
- Modify: `__test__/backend/src/backend.test.ts`
  - Cover quick commit endpoint behavior.
- Modify: `apps/desktop-ui/src/components/agent-checkpoint/AgentCheckpointView.vue`
  - Surface dirty state and quick commit action in the current checkpoint UI until the full workspace toolbar exists.
- Create: `apps/desktop-ui/src/components/git/QuickCommitButton.vue`
  - Reusable quick commit button/dialog for later workspace toolbar/Git page.
- Create: `apps/desktop-ui/src/composables/useQuickCommit.ts`
  - Calls backend quick commit endpoint and refreshes status.

Do not modify `packages/runtime`: Runtime only collects PendingActions and never commits.

Do not let Vue frontend execute Git directly. It must call backend endpoints.

---

### Task 1: Add Workspace Git Config

**Files:**

- Modify: `packages/core/src/workspace.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `__test__/core/src/workspace.test.ts`

- [ ] **Step 1: Add config types and defaults**

In `packages/core/src/workspace.ts`, add:

```ts
export interface WorkspaceGitConfig {
  autoCommitOnAccept: boolean;
}

export interface WorkspaceConfig {
  version: number;
  git: WorkspaceGitConfig;
}

export const DEFAULT_WORKSPACE_CONFIG: WorkspaceConfig = {
  version: 1,
  git: {
    autoCommitOnAccept: true,
  },
};
```

- [ ] **Step 2: Write default config during initialization**

Update the default `.oan/config.yaml` content:

```ts
const defaultConfig = `# oh-awesome-novel workspace config
# Edit this file to customise your workspace settings.
version: 1
git:
  autoCommitOnAccept: true
`;
```

- [ ] **Step 3: Add config loader**

Add:

```ts
export async function loadWorkspaceConfig(workspaceRoot: string): Promise<WorkspaceConfig> {
  const filePath = join(resolve(workspaceRoot), '.oan', 'config.yaml');
  const raw = await readFile(filePath, 'utf-8');
  const parsed = parse(raw) as unknown;
  return normalizeWorkspaceConfig(parsed);
}

function normalizeWorkspaceConfig(value: unknown): WorkspaceConfig {
  if (!isRecord(value)) {
    return DEFAULT_WORKSPACE_CONFIG;
  }

  const git = isRecord(value.git) ? value.git : {};
  return {
    version: typeof value.version === 'number' ? value.version : 1,
    git: {
      autoCommitOnAccept:
        typeof git.autoCommitOnAccept === 'boolean'
          ? git.autoCommitOnAccept
          : DEFAULT_WORKSPACE_CONFIG.git.autoCommitOnAccept,
    },
  };
}
```

If `parse` from `yaml` is not imported yet, add:

```ts
import { parse } from 'yaml';
```

- [ ] **Step 4: Export config loader**

In `packages/core/src/index.ts`, export:

```ts
export {
  DEFAULT_WORKSPACE_CONFIG,
  loadWorkspaceConfig,
  type WorkspaceConfig,
  type WorkspaceGitConfig,
} from './workspace.js';
```

- [ ] **Step 5: Add core tests**

Add tests to `__test__/core/src/workspace.test.ts`:

```ts
  it('writes git auto commit enabled by default', async () => {
    await initWorkspace(tempDir);

    await expect(
      readFile(join(tempDir, '.oan', 'config.yaml'), 'utf-8'),
    ).resolves.toContain('autoCommitOnAccept: true');
  });

  it('loads git auto commit config from workspace config', async () => {
    await initWorkspace(tempDir);
    await writeFile(
      join(tempDir, '.oan', 'config.yaml'),
      `version: 1
git:
  autoCommitOnAccept: false
`,
      'utf-8',
    );

    await expect(loadWorkspaceConfig(tempDir)).resolves.toMatchObject({
      git: {
        autoCommitOnAccept: false,
      },
    });
  });
```

Ensure imports include:

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { loadWorkspaceConfig } from '@oh-awesome-novel/core';
```

- [ ] **Step 6: Run core tests**

Run:

```bash
npm run test:run --workspace @oh-awesome-novel/test-core
```

Expected:

```text
Test Files  2 passed
```

---

### Task 2: Add Git Integration Helper

**Files:**

- Create: `packages/tools/src/git-integration.ts`
- Modify: `packages/tools/src/index.ts`

- [ ] **Step 1: Create helper file**

Create `packages/tools/src/git-integration.ts`:

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type GitCommitResult =
  | { status: 'committed'; hash: string; message: string }
  | { status: 'skipped'; reason: 'auto_commit_disabled'; message: string }
  | { status: 'failed'; message: string; error: string };

export async function gitDiff(workspaceRealpath: string, files: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', workspaceRealpath, 'diff', '--', ...files],
      { encoding: 'utf-8' },
    );
    return stdout;
  } catch (error) {
    if (isExecError(error)) {
      return error.stdout || error.stderr || '';
    }
    throw error;
  }
}

export async function gitStatusShort(workspaceRealpath: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'git',
    ['-C', workspaceRealpath, 'status', '--short'],
    { encoding: 'utf-8' },
  );
  return stdout;
}

export async function commitFiles(input: {
  workspaceRealpath: string;
  files: string[];
  message: string;
}): Promise<GitCommitResult> {
  try {
    await execFileAsync(
      'git',
      ['-C', input.workspaceRealpath, 'add', '--', ...input.files],
      { encoding: 'utf-8' },
    );
    await execFileAsync(
      'git',
      ['-C', input.workspaceRealpath, 'commit', '-m', input.message],
      { encoding: 'utf-8' },
    );
    const { stdout } = await execFileAsync(
      'git',
      ['-C', input.workspaceRealpath, 'rev-parse', '--short', 'HEAD'],
      { encoding: 'utf-8' },
    );
    return { status: 'committed', hash: stdout.trim(), message: input.message };
  } catch (error) {
    return {
      status: 'failed',
      message: input.message,
      error: formatExecError(error),
    };
  }
}

export function createPendingActionCommitMessage(input: {
  pendingActionId: string;
  pendingActionTitle: string;
}): string {
  return [
    `chore(novel): apply pending action ${input.pendingActionId.replace(/^pa_/, '').slice(0, 8)}`,
    '',
    input.pendingActionTitle,
  ].join('\n');
}

function formatExecError(error: unknown): string {
  if (isExecError(error)) {
    return error.stderr || error.stdout || error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function isExecError(error: unknown): error is Error & {
  stdout?: string;
  stderr?: string;
} {
  return error instanceof Error;
}
```

- [ ] **Step 2: Export type**

In `packages/tools/src/index.ts`, export:

```ts
export type { GitCommitResult } from './git-integration';
```

- [ ] **Step 3: Build tools**

Run:

```bash
npm run build --workspace @oh-awesome-novel/tools
```

Expected:

```text
Build complete
```

---

### Task 3: Make `acceptPendingAction()` Configurable

**Files:**

- Modify: `packages/tools/src/write-intent-tools.ts`
- Test: `__test__/tools/src/write-intent-tools.test.ts`

- [ ] **Step 1: Extend input and result types**

Modify:

```ts
export interface AcceptPendingActionInput {
  workspaceRoot: string;
  id: string;
  autoCommitOnAccept?: boolean;
}
```

Modify:

```ts
export interface AcceptedPendingAction extends PendingActionDecision {
  status: 'accepted';
  appliedFiles: string[];
  gitDiff: string;
  gitCommit: GitCommitResult;
  dirtyStatus: string;
}
```

- [ ] **Step 2: Import Git helper**

Add:

```ts
import {
  commitFiles,
  createPendingActionCommitMessage,
  gitDiff,
  gitStatusShort,
  type GitCommitResult,
} from './git-integration';
```

Remove the local `gitDiff()` helper after the imported helper is used.

- [ ] **Step 3: Apply config in accept flow**

After materializing shadow writes and archiving the action, add:

```ts
  const message = createPendingActionCommitMessage({
    pendingActionId: action.id,
    pendingActionTitle: action.title,
  });
  const autoCommitOnAccept = input.autoCommitOnAccept ?? true;
  const gitDiffBeforeCommit = await gitDiff(workspaceRealpath, action.touchedFiles);
  const gitCommit: GitCommitResult = autoCommitOnAccept
    ? await commitFiles({
        workspaceRealpath,
        files: action.touchedFiles,
        message,
      })
    : {
        status: 'skipped',
        reason: 'auto_commit_disabled',
        message,
      };
  const dirtyStatus = await gitStatusShort(workspaceRealpath);
```

Return:

```ts
  return {
    id: action.id,
    status: 'accepted',
    appliedFiles: action.touchedFiles,
    gitDiff: gitCommit.status === 'committed' ? '' : gitDiffBeforeCommit,
    gitCommit,
    dirtyStatus,
  };
```

- [ ] **Step 4: Run targeted tools test**

Run:

```bash
npm run test:run --workspace @oh-awesome-novel/test-tools -- src/write-intent-tools.test.ts
```

Expected:

```text
Test Files  1 passed
```

---

### Task 4: Cover Auto Commit And Disabled Config

**Files:**

- Modify: `__test__/tools/src/write-intent-tools.test.ts`

- [ ] **Step 1: Update existing accept test for default auto commit**

Assert:

```ts
    expect(accepted.gitCommit).toMatchObject({
      status: 'committed',
      message: expect.stringContaining('chore(novel): apply pending action'),
    });
    expect(accepted.gitDiff).toBe('');
    expect(accepted.dirtyStatus).toBe('');
```

Also assert latest commit touched only the PendingAction file:

```ts
    const committed = await git(workspaceRoot, [
      'show',
      '--name-only',
      '--format=',
      'HEAD',
    ]);
    expect(committed.trim()).toBe('characters/heroine/personality.md');
```

- [ ] **Step 2: Add disabled auto commit test**

Add:

```ts
  it('can accept a PendingAction without auto-committing when config disables it', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    await initGitRepo(workspaceRoot);
    const tools = createWriteIntentTools({ workspaceRoot });
    const result = await executeTool(tools, 'state.set', {
      file: 'characters.yaml',
      path: 'characters.heroine.hp',
      value: 'recovering',
    });
    const action = expectSinglePendingAction(result);

    const accepted = await acceptPendingAction({
      workspaceRoot,
      id: action.id,
      autoCommitOnAccept: false,
    });

    expect(accepted.gitCommit).toMatchObject({
      status: 'skipped',
      reason: 'auto_commit_disabled',
    });
    expect(accepted.gitDiff).toContain('hp: recovering');
    expect(accepted.dirtyStatus).toContain('M  state/characters.yaml');

    const log = await git(workspaceRoot, ['log', '--oneline', '-1']);
    expect(log).toContain('initial');
  });
```

- [ ] **Step 3: Add `git()` helper**

Add near `initGitRepo()`:

```ts
async function git(workspaceRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: workspaceRoot,
    encoding: 'utf-8',
  });
  return stdout;
}
```

- [ ] **Step 4: Run tools tests**

Run:

```bash
npm run test:run --workspace @oh-awesome-novel/test-tools
```

Expected:

```text
Test Files  4 passed
```

---

### Task 5: Add Quick Commit Backend Endpoint

**Files:**

- Modify: `packages/backend/src/index.ts`
- Modify: `__test__/backend/src/backend.test.ts`

- [ ] **Step 1: Add endpoint contract**

Add route:

```ts
if (request.method === 'POST' && url.pathname === '/api/git/commit') {
  await handleQuickCommit(options, request, response);
  return;
}
```

- [ ] **Step 2: Implement handler**

Add:

```ts
async function handleQuickCommit(
  options: NovelBackendOptions,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readJsonBody(request);
  const message = getOptionalString(body, 'message')?.trim();

  if (!message) {
    writeJson(response, 400, { error: 'Commit message is required.' });
    return;
  }

  const files = Array.isArray(body.files)
    ? body.files.filter((file): file is string => typeof file === 'string')
    : [];

  if (!files.length) {
    writeJson(response, 400, { error: 'At least one file is required.' });
    return;
  }

  const workspaceRealpath = await realpath(options.workspaceRoot);
  const result = await commitFiles({
    workspaceRealpath,
    files,
    message,
  });
  writeJson(response, result.status === 'committed' ? 200 : 409, result);
}
```

Add imports:

```ts
import { realpath } from 'node:fs/promises';
import { commitFiles } from '@oh-awesome-novel/tools';
```

- [ ] **Step 3: Add backend test**

Add test:

```ts
  it('commits selected dirty files through the quick commit endpoint', async () => {
    const workspaceRoot = await createTempWorkspace();
    await initGitRepo(workspaceRoot);
    await writeFile(join(workspaceRoot, 'state/characters.yaml'), 'characters: {}\n', 'utf-8');
    const backend = await startNovelHttpBackend({ workspaceRoot });
    servers.push(backend);

    const response = await fetch(`${backend.url}/api/git/commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        files: ['state/characters.yaml'],
        message: 'chore(novel): manual quick commit',
      }),
    });

    await expect(response.json()).resolves.toMatchObject({
      status: 'committed',
      message: 'chore(novel): manual quick commit',
    });
  });
```

- [ ] **Step 4: Run backend tests**

Run:

```bash
npm run test:run --workspace @oh-awesome-novel/test-backend
```

Expected:

```text
Test Files  1 passed
```

---

### Task 6: Add Quick Commit UI

**Files:**

- Create: `apps/desktop-ui/src/composables/useQuickCommit.ts`
- Create: `apps/desktop-ui/src/components/git/QuickCommitButton.vue`
- Modify: `apps/desktop-ui/src/components/agent-checkpoint/AgentCheckpointView.vue`

- [ ] **Step 1: Create composable**

Create `apps/desktop-ui/src/composables/useQuickCommit.ts`:

```ts
import { shallowRef } from 'vue';

export function useQuickCommit(backendBaseUrl: string) {
  const status = shallowRef<'idle' | 'submitting' | 'error' | 'committed'>('idle');
  const error = shallowRef('');

  async function commit(files: string[], message: string) {
    status.value = 'submitting';
    error.value = '';
    const response = await fetch(`${backendBaseUrl}/api/git/commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ files, message }),
    });
    const payload = await response.json();
    if (!response.ok) {
      status.value = 'error';
      error.value = payload.error ?? payload.message ?? 'Commit failed.';
      return payload;
    }
    status.value = 'committed';
    return payload;
  }

  return { status, error, commit };
}
```

- [ ] **Step 2: Create button component**

Create `apps/desktop-ui/src/components/git/QuickCommitButton.vue`:

```vue
<script setup lang="ts">
import { shallowRef } from 'vue';
import { useQuickCommit } from '../../composables/useQuickCommit';

const props = defineProps<{
  backendBaseUrl: string;
  files: string[];
}>();

const message = shallowRef('chore(novel): manual quick commit');
const { status, error, commit } = useQuickCommit(props.backendBaseUrl);

function submit() {
  void commit(props.files, message.value);
}
</script>

<template>
  <section class="quick-commit" aria-label="Quick commit">
    <input v-model="message" aria-label="Commit message" />
    <button type="button" :disabled="!files.length || status === 'submitting'" @click="submit">
      Commit now
    </button>
    <p v-if="error">{{ error }}</p>
  </section>
</template>
```

- [ ] **Step 3: Mount in checkpoint UI**

In `AgentCheckpointView.vue`, import and render the component with dirty files from accepted pending actions until the full workspace toolbar exists.

```ts
import QuickCommitButton from '../git/QuickCommitButton.vue';
```

```vue
<QuickCommitButton
  :backend-base-url="backendBaseUrl"
  :files="decoratedPendingActions.flatMap((action) => action.touchedFiles ?? [])"
/>
```

If `PendingActionView` lacks `touchedFiles`, add it in `useAgentCheckpointChat.ts`:

```ts
  touchedFiles: string[];
```

- [ ] **Step 4: Build desktop UI**

Run:

```bash
npm run build --workspace @oh-awesome-novel/desktop-ui
```

Expected:

```text
built successfully
```

---

### Task 7: Final Verification

**Files:**

- Inspect: `docs/HUMAN_APPROVAL_AND_GIT.md`
- Inspect: `docs/tasks/0580.md`
- Inspect: implementation files from tasks above

- [ ] **Step 1: Search docs for old hard requirement**

Run:

```bash
rg -n 'Git commit 不应默认自动执行|Optional commit|User commits manually' docs/HUMAN_APPROVAL_AND_GIT.md docs/tasks/0580.md
```

Expected:

```text
no matches
```

- [ ] **Step 2: Run affected tests**

Run:

```bash
npm run test:run --workspace @oh-awesome-novel/test-core
npm run test:run --workspace @oh-awesome-novel/test-tools
npm run test:run --workspace @oh-awesome-novel/test-backend
```

Expected:

```text
all tests pass
```

- [ ] **Step 3: Run affected builds**

Run:

```bash
npm run build --workspace @oh-awesome-novel/tools
npm run build --workspace @oh-awesome-novel/backend
npm run build --workspace @oh-awesome-novel/desktop-ui
```

Expected:

```text
all builds complete
```

- [ ] **Step 4: Check diff hygiene**

Run:

```bash
git diff --check
```

Expected:

```text
no output
```

---

## Self-Review

- Spec coverage: Covers AI shadow-write boundary, default auto commit, configurable opt-out, quick commit button, touched-files-only auto commit, manual quick commit, commit failure dirty state, and backend/frontend boundary.
- Placeholder scan: No TBD/TODO placeholders remain.
- Type consistency: `WorkspaceConfig.git.autoCommitOnAccept`, `AcceptPendingActionInput.autoCommitOnAccept`, and `GitCommitResult` are used consistently.
- Scope check: This plan does not implement full Git history UI, auto sync, bundled Git binary, or external editor launch; those remain broader parts of `0580 Git History And Sync Page`.
