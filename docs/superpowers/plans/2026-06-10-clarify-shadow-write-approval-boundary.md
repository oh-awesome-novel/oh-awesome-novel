# Clarify Shadow Write Approval Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure approval-before-write semantics mean “do not write real target files before approval” while still allowing internal `.workspace` shadow recovery and PendingAction files before approval.

**Architecture:** Write-intent tools and future Apply Engine preview may write candidate content under `workspace/.workspace` for diff preview and crash recovery. Real target files under the novel workspace remain unchanged until `acceptPendingAction()`. Callers must never be able to request `.workspace` as a target path.

**Tech Stack:** TypeScript, existing `packages/tools` write-intent tools, `.workspace/shadow-writes`, `.workspace/pending-actions`, Vitest tests under `__test__/tools`.

---

## File Structure

- Inspect: `packages/tools/src/write-intent-tools.ts`
  - Ensure write-intent tools write only shadow/PendingAction data before accept.
- Inspect: `packages/tools/src/restricted-write-tool.ts`
  - Ensure caller-supplied paths cannot target `.workspace`.
- Inspect future Apply Engine files when implementing `0800`.
  - Preview writes only `.workspace` candidates.
  - Apply materializes only after accept.
- Test: `__test__/tools/src/write-intent-tools.test.ts`
- Test: `__test__/tools/src/restricted-write-tool.test.ts`

Do not add any pre-approval write to real target files.

---

### Task 1: Verify Write-Intent Pre-Approval Behavior

**Files:**

- Inspect: `packages/tools/src/write-intent-tools.ts`
- Test: `__test__/tools/src/write-intent-tools.test.ts`

- [ ] **Step 1: Confirm write-intent creates shadow data**

Run:

```bash
npm run test:run --workspace @oh-awesome-novel/test-tools -- src/write-intent-tools.test.ts
```

Expected test behavior:

- write-intent tool creates a PendingAction.
- candidate content is stored under `workspace/.workspace/shadow-writes`.
- PendingAction metadata is stored under `workspace/.workspace/pending-actions`.
- real target files are unchanged before accept.

- [ ] **Step 2: Add missing regression if needed**

If no test proves target files remain unchanged before accept, add a test shaped like:

```ts
it('does not materialize target files before accept', async () => {
  const before = await readFile(targetPath, 'utf-8');
  const tools = createWriteIntentTools({ workspaceRoot });

  await executeTool(tools, 'state.set', {
    file: 'characters.yaml',
    path: 'characters.heroine.status',
    value: 'injured',
  });

  await expect(readFile(targetPath, 'utf-8')).resolves.toBe(before);
});
```

---

### Task 2: Verify Accept/Reject Boundary

**Files:**

- Inspect: `packages/tools/src/write-intent-tools.ts`
- Test: `__test__/tools/src/write-intent-tools.test.ts`

- [ ] **Step 1: Confirm accept materializes real target files**

Expected:

- `acceptPendingAction()` copies/applies accepted shadow candidate content to touched real target files.
- It returns visible diff/status information.
- It does not write unrelated dirty files.

- [ ] **Step 2: Confirm reject never materializes target files**

Expected:

- `rejectPendingAction()` marks or archives the PendingAction.
- It removes or marks abandoned shadow files.
- The real target files remain unchanged.

---

### Task 3: Verify `.workspace` Cannot Be Caller Target

**Files:**

- Inspect: `packages/tools/src/restricted-write-tool.ts`
- Inspect: `packages/tools/src/write-intent-tools.ts`
- Test: `__test__/tools/src/restricted-write-tool.test.ts`
- Test: `__test__/tools/src/write-intent-tools.test.ts`

- [ ] **Step 1: Confirm restricted write rejects `.workspace`**

Run:

```bash
npm run test:run --workspace @oh-awesome-novel/test-tools -- src/restricted-write-tool.test.ts
```

Expected:

- `.workspace/shadow.md` as user-supplied target fails.
- hidden path targets fail.

- [ ] **Step 2: Confirm formal write-intent tools reject hidden targets**

Formal write-intent tool args must not allow target paths under:

```text
.workspace/
.oan/
.git/
```

If a tool accepts a `file` or `path` argument, tests should cover hidden-directory rejection.

---

### Task 4: Apply Engine Preview Must Match Boundary

**Files:**

- Future: Apply Engine files from `0800`.
- Test: future `__test__/tools/src/apply-engine.test.ts`.

- [ ] **Step 1: Preview writes only shadow candidates**

When implementing `previewSemanticPatches()`, assert:

- target files are unchanged.
- candidate files are written under `.workspace`.
- diff compares target file content against candidate content.

- [ ] **Step 2: Apply only after approval**

Apply/materialize behavior should only be reachable through the approval boundary, not directly from model/tool execution.

---

### Task 5: Verify Documentation And Diff Hygiene

**Files:**

- Relevant docs and future implementation files.

- [ ] **Step 1: Search for ambiguous wording**

Run:

```bash
rg -n '不得写盘|不写盘|静默写入文件' docs --glob '!ChatGPT对话.md'
```

Expected:

- No ambiguous “不得写盘” phrasing remains.
- Wording should say “不得写真实目标文件” or explicitly distinguish `.workspace` shadow writes.

- [ ] **Step 2: Run tools tests**

Run:

```bash
npm run test:run --workspace @oh-awesome-novel/test-tools
```

Expected: all tools tests pass.

- [ ] **Step 3: Run diff hygiene**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.
