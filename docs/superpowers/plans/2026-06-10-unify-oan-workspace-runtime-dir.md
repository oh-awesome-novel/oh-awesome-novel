# Unify OAN Workspace Runtime Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure the application, tests, examples, and docs consistently use `.oan/` as the only canonical workspace runtime directory.

**Architecture:** `.oan/` is the workspace-local runtime/config directory for workflow, constitution, sessions, prompts, skills, extensions, and future logs. `.storyforge/` is obsolete and invalid for this project; do not implement fallback detection, migration, import compatibility, or aliases for it.

**Tech Stack:** TypeScript, Node.js filesystem APIs, Vitest workspaces under `__test__/`, docs under `docs/`.

---

## Current Baseline

Stable docs have already been updated to describe `.oan/` as canonical:

- `docs/REQUIREMENTS.md`
- `docs/FILESYSTEM_SPEC.md`
- `docs/NOVEL_CONSTITUTION.md`
- `docs/HUMAN_APPROVAL_AND_GIT.md`
- `docs/DEVELOPMENT_PLAN.md`

Current code search shows `packages/`, `apps/`, and `__test__/` already use `.oan/` for workspace config, constitution, workflow, and sessions. Future implementation work should still execute this plan to verify no `.storyforge/` references or compatibility behavior have been introduced.

## File Structure

Files to inspect and modify only if implementation has drifted:

- `packages/core/src/workspace.ts`: owns workspace initialization and global OAN config directory resolution.
- `packages/tools/src/read-tools.ts`: reads `.oan/constitution/` and `.oan/workflow.yaml`.
- `packages/tools/src/restricted-write-tool.ts`: blocks user-supplied writes into `.oan/`.
- `packages/agent/src/session-store.ts`: writes sessions under `.oan/sessions/`.
- `__test__/core/src/workspace.test.ts`: verifies workspace initialization and global config directory behavior.
- `__test__/tools/src/read-tools.test.ts`: verifies read tools return `.oan` paths.
- `__test__/tools/src/restricted-write-tool.test.ts`: verifies ordinary write tools cannot write `.oan`.
- `__test__/agent/src/session-store.test.ts`: verifies agent sessions persist under `.oan/sessions`.
- `examples/sample-novel/.oan/`: sample workspace runtime/config files.

Do not modify `docs/ChatGPT对话.md` for this item. It is historical source material and may mention old names. Do not copy `.storyforge/` behavior from it into implementation docs or code.

---

### Task 1: Verify No Runtime `.storyforge/` References Remain

**Files:**

- Inspect: `packages/`
- Inspect: `apps/`
- Inspect: `__test__/`
- Inspect: `examples/`

- [ ] **Step 1: Search implementation and test files for `.storyforge`**

Run:

```bash
rg -n '\.storyforge' packages apps __test__ examples
```

Expected:

```text
no matches
```

- [ ] **Step 2: If matches exist, treat each match as stale**

Stale match examples:

```text
runtime path
workspace validation path
tool read/write path
UI label for canonical runtime directory
test expectation for canonical runtime directory
example workspace runtime directory
fallback or migration path
```

- [ ] **Step 3: Replace stale runtime references**

For each stale reference, replace `.storyforge` with `.oan`. Do not add compatibility branches that check both names.

Example before:

```ts
const workflowPath = join(workspaceRoot, '.storyforge', 'workflow.yaml');
```

Example after:

```ts
const workflowPath = join(workspaceRoot, '.oan', 'workflow.yaml');
```

- [ ] **Step 4: Re-run the search**

Run:

```bash
rg -n '\.storyforge' packages apps __test__ examples
```

Expected:

```text
no matches
```

---

### Task 2: Verify Workspace Initialization Creates `.oan/`

**Files:**

- Modify if needed: `packages/core/src/workspace.ts`
- Test: `__test__/core/src/workspace.test.ts`

- [ ] **Step 1: Confirm the initialization constants use `.oan`**

Inspect `packages/core/src/workspace.ts`.

Expected implementation shape:

```ts
const OAN_SUBDIRS = ['constitution', 'prompts', 'skills', 'extensions'] as const;

const oanDir = join(rootDir, '.oan');
await mkdir(oanDir, { recursive: true });

await writeFile(join(oanDir, 'workflow.yaml'), defaultWorkflow, 'utf-8');
await writeFile(join(oanDir, 'config.yaml'), defaultConfig, 'utf-8');
```

- [ ] **Step 2: If initialization still uses `.storyforge`, update it**

Replace old initialization paths with `.oan`.

```ts
const oanDir = join(rootDir, '.oan');
await mkdir(oanDir, { recursive: true });
```

- [ ] **Step 3: Confirm workspace initialization tests expect `.oan`**

Inspect `__test__/core/src/workspace.test.ts`.

Expected assertions:

```ts
await expect(stat(join(tempDir, '.oan', 'workflow.yaml'))).resolves.toBeDefined();
await expect(stat(join(tempDir, '.oan', 'config.yaml'))).resolves.toBeDefined();
```

- [ ] **Step 4: Run core tests**

Run:

```bash
npm run test:run --workspace @oh-awesome-novel/test-core
```

Expected:

```text
Test Files  2 passed
Tests  37 passed
```

---

### Task 3: Verify Read Tools Use `.oan/constitution` And `.oan/workflow.yaml`

**Files:**

- Modify if needed: `packages/tools/src/read-tools.ts`
- Test: `__test__/tools/src/read-tools.test.ts`

- [ ] **Step 1: Confirm constitution and workflow read paths**

Inspect `packages/tools/src/read-tools.ts`.

Expected implementation shape:

```ts
const constitutionRoot = resolveWorkspacePath(options.workspaceRoot, '.oan', 'constitution');
const filePath = resolveWorkspacePath(options.workspaceRoot, '.oan', 'workflow.yaml');
```

- [ ] **Step 2: If read tools still use `.storyforge`, update them**

Replace old read paths with `.oan`.

```ts
const constitutionRoot = resolveWorkspacePath(options.workspaceRoot, '.oan', 'constitution');
```

```ts
const filePath = resolveWorkspacePath(options.workspaceRoot, '.oan', 'workflow.yaml');
```

- [ ] **Step 3: Confirm read tool tests expect `.oan` paths**

Inspect `__test__/tools/src/read-tools.test.ts`.

Expected assertion:

```ts
await expect(
  executeTool(tools, 'workflow.get', {}),
).resolves.toMatchObject({ file: '.oan/workflow.yaml' });
```

- [ ] **Step 4: Run tools tests**

Run:

```bash
npm run test:run --workspace @oh-awesome-novel/test-tools
```

Expected:

```text
Test Files  4 passed
Tests  23 passed
```

---

### Task 4: Verify Write Boundaries Protect `.oan/`

**Files:**

- Modify if needed: `packages/tools/src/restricted-write-tool.ts`
- Modify if needed: `packages/tools/src/write-intent-tools.ts`
- Test: `__test__/tools/src/restricted-write-tool.test.ts`
- Test: `__test__/tools/src/write-intent-tools.test.ts`

- [ ] **Step 1: Confirm restricted write tools block `.oan`**

Inspect `packages/tools/src/restricted-write-tool.ts`.

Expected implementation shape:

```ts
if (part === '.oan') {
  throw new Error('User paths cannot target workspace/.oan.');
}
```

- [ ] **Step 2: Confirm formal write-intent tools block hidden directories**

Inspect `packages/tools/src/write-intent-tools.ts`.

Expected safety behavior:

```ts
if (normalized.split(sep).some((part) => part.startsWith('.'))) {
  throw new Error(`Invalid workspace relative path: ${value}`);
}
```

- [ ] **Step 3: Confirm tests cover `.oan` write rejection**

Inspect `__test__/tools/src/restricted-write-tool.test.ts`.

Expected table entry:

```ts
['.oan/session.json'],
```

- [ ] **Step 4: Run tools tests**

Run:

```bash
npm run test:run --workspace @oh-awesome-novel/test-tools
```

Expected:

```text
Test Files  4 passed
Tests  23 passed
```

---

### Task 5: Verify Agent Sessions Persist Under `.oan/sessions`

**Files:**

- Modify if needed: `packages/agent/src/session-store.ts`
- Test: `__test__/agent/src/session-store.test.ts`

- [ ] **Step 1: Confirm session root is `.oan/sessions`**

Inspect `packages/agent/src/session-store.ts`.

Expected implementation shape:

```ts
const sessionsRoot = resolve(workspaceRealpath, '.oan', 'sessions');
```

- [ ] **Step 2: If session storage still uses `.storyforge`, update it**

Replace old session path with:

```ts
const sessionsRoot = resolve(workspaceRealpath, '.oan', 'sessions');
```

- [ ] **Step 3: Confirm session tests expect `.oan/sessions`**

Inspect `__test__/agent/src/session-store.test.ts`.

Expected assertions:

```ts
join(workspaceRoot, '.oan/sessions', session.id, 'messages.jsonl')
join(workspaceRoot, '.oan/sessions', sessionId, 'tool-log.jsonl')
join(workspaceRoot, '.oan/sessions', sessionId, 'recovery.yaml')
```

- [ ] **Step 4: Run agent tests**

Run:

```bash
npm run test:run --workspace @oh-awesome-novel/test-agent
```

Expected:

```text
Test Files  4 passed
Tests  11 passed
```

---

### Task 6: Verify Examples Use `.oan/`

**Files:**

- Modify if needed: `examples/sample-novel/.oan/`
- Remove if present: `examples/sample-novel/.storyforge/`

- [ ] **Step 1: Inspect sample workspace runtime directory**

Run:

```bash
find examples/sample-novel -maxdepth 3 -type d | sort
```

Expected directories include:

```text
examples/sample-novel/.oan
examples/sample-novel/.oan/constitution
```

Expected directories do not include:

```text
examples/sample-novel/.storyforge
```

- [ ] **Step 2: If `.storyforge/` exists in examples, remove it**

Do not migrate `.storyforge/` contents at runtime. If the sample needs missing canonical files, create them under `.oan/` using the expected current workspace layout, then remove the stale `.storyforge/` files. Use `git rm` for tracked stale files.

Example commands:

```bash
git rm -r examples/sample-novel/.storyforge
```

- [ ] **Step 3: Re-run example path search**

Run:

```bash
rg -n '\.storyforge' examples
```

Expected:

```text
no matches
```

---

### Task 7: Final Verification

**Files:**

- Inspect: `docs/`
- Inspect: `packages/`
- Inspect: `apps/`
- Inspect: `__test__/`
- Inspect: `examples/`

- [ ] **Step 1: Confirm stable docs reject `.storyforge` compatibility**

Run:

```bash
rg -n '\.storyforge' docs/README.md docs/PROJECT_VISION.md docs/REQUIREMENTS.md docs/ARCHITECTURE.md docs/FILESYSTEM_SPEC.md docs/APPLY_ENGINE.md docs/HUMAN_APPROVAL_AND_GIT.md docs/AGENT_RUNTIME_AND_TOOLS.md docs/AGENT_OPERATING_MANUAL.md docs/DEVELOPMENT_PLAN.md docs/NOVEL_CONSTITUTION.md docs/adr
```

Expected allowed matches:

```text
docs/REQUIREMENTS.md: note that .storyforge is not a valid workspace directory
docs/FILESYSTEM_SPEC.md: note that .storyforge is not a valid workspace directory
```

- [ ] **Step 2: Confirm implementation has no `.storyforge` runtime references**

Run:

```bash
rg -n '\.storyforge' packages apps __test__ examples
```

Expected:

```text
no matches
```

- [ ] **Step 3: Run all directly affected tests**

Run:

```bash
npm run test:run --workspace @oh-awesome-novel/test-core
npm run test:run --workspace @oh-awesome-novel/test-tools
npm run test:run --workspace @oh-awesome-novel/test-agent
```

Expected:

```text
core: 37 passed
tools: 23 passed
agent: 11 passed
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

- Spec coverage: Covers `.oan/` workspace initialization, read tools, write boundaries, session storage, examples, and stable docs.
- Placeholder scan: No TBD/TODO placeholders remain.
- Type consistency: Uses existing names from the codebase: `initWorkspace`, `createReadTools`, `createRestrictedWriteTools`, `createWriteIntentTools`, `.oan/workflow.yaml`, `.oan/constitution`, `.oan/sessions`.
- Scope check: This plan does not implement unrelated workspace launcher, Git sync, search, or Apply Engine behavior.
