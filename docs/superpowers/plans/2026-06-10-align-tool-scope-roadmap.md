# Align Tool Scope Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep completed tool scope and future/proposed tool scope separate so implementation does not accidentally treat `chapter.rewriteScene`, `foreshadow.resolve`, or Constitution proposal/search tools as already completed M5/M6 work.

**Architecture:** M5 is completed read tools. M6 is completed write-intent tools. Post-M6 tools are implemented only when their owning roadmap item is selected: chapter rewrite after `0800 SemanticPatch Apply Engine`, foreshadow resolve in workflow polish or Apply Engine follow-up, and Constitution proposal/search in Constitution workflow.

**Tech Stack:** Vercel AI SDK `ToolSet`, `packages/tools` tool factories, `packages/agent` default toolset assembly, Vitest tests under `__test__/tools` and `__test__/agent`.

---

## File Structure

- Inspect: `packages/tools/src/read-tools.ts`
  - Completed M5 read tools.
- Inspect: `packages/tools/src/write-intent-tools.ts`
  - Completed M6 write-intent tools.
- Inspect: `packages/agent/src/index.ts`
  - Default agent ToolSet assembly.
- Modify later for `chapter.rewriteScene`: Apply Engine files from the `0800` implementation plan.
- Modify later for `foreshadow.resolve`: `packages/tools/src/write-intent-tools.ts` after a dedicated task is selected.
- Modify later for Constitution search/proposal: Constitution workflow tools after a dedicated task is selected.

Do not add proposed tools to the default ToolSet until their owning task is implemented and tested.

---

### Task 1: Verify Completed M5 Read Tool Scope

**Files:**

- Inspect: `packages/tools/src/read-tools.ts`
- Test: `__test__/tools/src/read-tools.test.ts`

- [ ] **Step 1: Confirm current read tool ids**

Run:

```bash
npm run test:run --workspace @oh-awesome-novel/test-tools -- src/read-tools.test.ts
```

Expected test coverage should include these ids:

```text
character.get
character.list
world.search
chapter.get
state.get
timeline.list
foreshadow.list
summary.get
constitution.get
workflow.get
```

- [ ] **Step 2: Confirm proposed read tools are absent**

Run:

```bash
rg -n \"constitution.search|chapter.search\" packages/tools/src __test__/tools/src
```

Expected:

```text
no matches
```

If matches exist, confirm they are behind a selected future task and not part of M5 claims.

---

### Task 2: Verify Completed M6 Write-Intent Tool Scope

**Files:**

- Inspect: `packages/tools/src/write-intent-tools.ts`
- Test: `__test__/tools/src/write-intent-tools.test.ts`

- [ ] **Step 1: Confirm current write-intent tool ids**

Run:

```bash
npm run test:run --workspace @oh-awesome-novel/test-tools -- src/write-intent-tools.test.ts
```

Expected completed ids:

```text
character.updatePersonality
state.set
timeline.add
foreshadow.create
summary.generateChapter
```

- [ ] **Step 2: Confirm proposed write-intent tools are absent**

Run:

```bash
rg -n \"chapter\\.rewriteScene|foreshadow\\.resolve|constitution\\.proposeUpdate\" packages/tools/src __test__/tools/src
```

Expected:

```text
no matches
```

If matches exist, confirm they are behind their selected future task and have tests.

---

### Task 3: Keep Default Agent ToolSet Limited To Completed Tools

**Files:**

- Inspect: `packages/agent/src/index.ts`
- Test: `__test__/agent/src/tool-registry.test.ts`

- [ ] **Step 1: Confirm default assembly uses completed factories**

Expected:

```ts
export const createNovelAgentToolSet = (
  input: NovelAgentToolSetInput,
): ToolSet => input.tools ?? {
  ...createReadTools({ workspaceRoot: input.workspaceRoot }),
  ...createWriteIntentTools({ workspaceRoot: input.workspaceRoot }),
};
```

- [ ] **Step 2: Add or verify agent test for absent proposed tools**

The default ToolSet should not include:

```text
chapter.rewriteScene
foreshadow.resolve
constitution.proposeUpdate
constitution.search
```

- [ ] **Step 3: Run agent tests**

Run:

```bash
npm run test:run --workspace @oh-awesome-novel/test-agent
```

Expected: all agent tests pass.

---

### Task 4: Implement Future Tools Only Under Owning Tasks

**Files:**

- Future `chapter.rewriteScene`: Apply Engine plan / `0800`.
- Future `foreshadow.resolve`: workflow polish or Apply Engine follow-up plan.
- Future `constitution.search`: Constitution workflow plan.
- Future `constitution.proposeUpdate`: Constitution workflow plan.

- [ ] **Step 1: For `chapter.rewriteScene`, require NarrativePatch**

Do not implement `chapter.rewriteScene` as a full-file rewrite. It must use `NarrativePatch` / scene or chunk semantics after Apply Engine support exists.

- [ ] **Step 2: For `foreshadow.resolve`, require YAML patch semantics**

It should move/update entries between active/resolved foreshadow files through SemanticPatch or equivalent write-intent preview, not direct writes.

- [ ] **Step 3: For Constitution tools, require explicit proposal workflow**

`constitution.proposeUpdate` must only create a PendingAction/proposal. It must not silently change `.oan/constitution/*`.

---

### Task 5: Verify Docs And Diff Hygiene

**Files:**

- Relevant docs and future implementation files.

- [ ] **Step 1: Search for mixed-scope wording**

Run:

```bash
rg -n \"初始工具|推荐：|示例：|chapter\\.rewriteScene|foreshadow\\.resolve|constitution\\.proposeUpdate|constitution\\.search\" docs --glob '!ChatGPT对话.md'
```

Expected:

- Completed tools are listed under completed/current scope.
- Future tools are listed under proposed/future scope.

- [ ] **Step 2: Run diff hygiene**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.
