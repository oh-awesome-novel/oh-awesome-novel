# Align Apply Engine Implementation Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the codebase with the documented implementation order: keep the completed write-intent/PendingAction path working now, then implement the full SemanticPatch Apply Engine under task `0800`.

**Architecture:** `0400` remains a validation-only restricted write path. `0600` remains the current production-facing write-intent path using `.workspace` shadow writes and PendingAction approval. `0800` introduces SemanticPatch executors and gradually routes formal write-intent tools through Apply Engine preview/apply behavior without bypassing Human Approval.

**Tech Stack:** TypeScript, existing `packages/tools` write-intent tools, future Apply Engine module under `packages/tools` or a focused package if the repository already has one, `.workspace` shadow writes, Vitest tests under `__test__/tools`.

---

## File Structure

- Inspect: `packages/tools/src/write-intent-tools.ts`
  - Current write-intent and PendingAction path.
- Inspect: `packages/tools/src/restricted-write-tool.ts`
  - Keep as validation-only, not part of agent default formal write path.
- Modify or add when implementing `0800`: `packages/tools/src/apply-engine.ts`
  - SemanticPatch types and preview executor.
- Modify when implementing `0800`: `packages/tools/src/write-intent-tools.ts`
  - Route formal write-intent tools through Apply Engine preview where practical.
- Modify: `packages/tools/src/index.ts`
  - Export Apply Engine types/helpers if added.
- Test: `__test__/tools/src/apply-engine.test.ts`
- Test: `__test__/tools/src/write-intent-tools.test.ts`

Do not remove the current PendingAction approval boundary. Do not make the restricted write tool a formal write path.

---

### Task 1: Verify Current Write Order

**Files:**

- Inspect: `packages/tools/src/restricted-write-tool.ts`
- Inspect: `packages/tools/src/write-intent-tools.ts`
- Inspect: `packages/agent/src/index.ts`

- [ ] **Step 1: Confirm restricted write is validation-only**

Run:

```bash
rg -n 'createRestrictedWriteTools|workspace.writeFile' packages apps __test__
```

Expected:

- `createRestrictedWriteTools` may be exported.
- It may be used by validation/checkpoint harnesses.
- It must not be part of the default formal novel agent toolset.

- [ ] **Step 2: Confirm default agent toolset uses write-intent tools**

Inspect `packages/agent/src/index.ts`.

Expected:

```ts
export const createNovelAgentToolSet = (
  input: NovelAgentToolSetInput,
): ToolSet => input.tools ?? {
  ...createReadTools({ workspaceRoot: input.workspaceRoot }),
  ...createWriteIntentTools({ workspaceRoot: input.workspaceRoot }),
};
```

- [ ] **Step 3: Confirm Accept is the materialization boundary**

Inspect `packages/tools/src/write-intent-tools.ts`.

Expected:

- write-intent tool execution creates PendingAction data.
- candidate content is stored under `.workspace`.
- target files are not modified before `acceptPendingAction()`.
- `rejectPendingAction()` does not write target files.

---

### Task 2: Introduce Apply Engine Types

**Files:**

- Add or modify: `packages/tools/src/apply-engine.ts`
- Modify: `packages/tools/src/index.ts`
- Test: `__test__/tools/src/apply-engine.test.ts`

- [ ] **Step 1: Add SemanticPatch union**

Create:

```ts
export type SemanticPatch = ObjectPatch | CollectionPatch | NarrativePatch;

export interface ObjectPatch {
  kind: 'object';
  domain: 'character' | 'world' | 'constitution';
  entityId: string;
  file: string;
  operation:
    | 'replaceFile'
    | 'appendBlock'
    | 'replaceBlock'
    | 'appendSection'
    | 'replaceSection'
    | 'frontmatterSet'
    | 'frontmatterDelete';
  selector?: {
    section?: string;
    block?: string;
    path?: string;
  };
  value?: string | number | boolean | object;
  instruction?: string;
}

export interface CollectionPatch {
  kind: 'collection';
  domain: 'state' | 'timeline' | 'foreshadow';
  file: string;
  operation: 'yamlSet' | 'yamlDelete' | 'yamlAppend' | 'yamlMove';
  path: string;
  value?: unknown;
}

export interface NarrativePatch {
  kind: 'narrative';
  domain: 'chapter' | 'summary';
  file: string;
  operation:
    | 'replaceScene'
    | 'insertScene'
    | 'appendScene'
    | 'replaceChunk'
    | 'appendSection';
  selector?: {
    scene?: string;
    chunkId?: string;
    section?: string;
  };
  instruction?: string;
  value?: string;
}
```

- [ ] **Step 2: Add initial type export**

In `packages/tools/src/index.ts`:

```ts
export type {
  CollectionPatch,
  NarrativePatch,
  ObjectPatch,
  SemanticPatch,
} from './apply-engine';
```

- [ ] **Step 3: Add type smoke test**

Create `__test__/tools/src/apply-engine.test.ts` with a runtime-safe assertion around a simple exported validator or builder if one exists. If only types exist, skip test until Task 3 adds executable behavior.

---

### Task 3: Add Apply Preview For Collection Patch

**Files:**

- Modify: `packages/tools/src/apply-engine.ts`
- Test: `__test__/tools/src/apply-engine.test.ts`

- [ ] **Step 1: Write failing test for YAML patch preview**

Test:

```ts
it('previews a collection yamlSet patch without writing the target file', async () => {
  const result = await previewSemanticPatches({
    workspaceRoot,
    patches: [
      {
        kind: 'collection',
        domain: 'state',
        file: 'characters.yaml',
        operation: 'yamlSet',
        path: 'characters.heroine.status',
        value: 'injured',
      },
    ],
  });

  expect(result.touchedFiles).toEqual(['state/characters.yaml']);
  expect(result.diff).toContain('injured');
  expect(await readFile(join(workspaceRoot, 'state/characters.yaml'), 'utf-8')).not.toContain(
    'injured',
  );
});
```

- [ ] **Step 2: Implement minimal preview**

Implement `previewSemanticPatches()` so it:

- resolves allowed target paths from patch domain.
- rejects hidden target paths.
- loads current file content.
- applies `yamlSet` using existing YAML engine.
- writes candidate content only under `.workspace`.
- returns touched files and diff.

- [ ] **Step 3: Run tools test**

Run:

```bash
npm run test:run --workspace @oh-awesome-novel/test-tools -- src/apply-engine.test.ts
```

Expected: the new test passes.

---

### Task 4: Route One Write-Intent Tool Through Apply Engine

**Files:**

- Modify: `packages/tools/src/write-intent-tools.ts`
- Test: `__test__/tools/src/write-intent-tools.test.ts`

- [ ] **Step 1: Start with `state.set`**

Change only `state.set` first. It should construct a `CollectionPatch` and call `previewSemanticPatches()`.

Expected patch:

```ts
{
  kind: 'collection',
  domain: 'state',
  file,
  operation: 'yamlSet',
  path,
  value,
}
```

- [ ] **Step 2: Preserve PendingAction shape**

The returned PendingAction must still include:

- `id`
- `title`
- `description`
- `patches`
- `touchedFiles`
- `diff`
- `createdAt`
- `status: 'pending'`

- [ ] **Step 3: Run write-intent tests**

Run:

```bash
npm run test:run --workspace @oh-awesome-novel/test-tools -- src/write-intent-tools.test.ts
```

Expected: existing tests pass with the Apply Engine-backed `state.set`.

---

### Task 5: Verify No Approval Boundary Regression

**Files:**

- Relevant tools files.

- [ ] **Step 1: Run full tools tests**

Run:

```bash
npm run test:run --workspace @oh-awesome-novel/test-tools
```

Expected: all tools tests pass.

- [ ] **Step 2: Confirm target files are not written before accept**

Run or add tests proving:

- write-intent creates `.workspace` shadow candidate.
- target files remain unchanged before accept.
- accept materializes files.
- reject does not materialize files.

- [ ] **Step 3: Confirm restricted write is not the formal path**

Run:

```bash
rg -n 'createRestrictedWriteTools' packages/agent packages/backend apps
```

Expected: only validation/checkpoint code uses restricted write tools.

- [ ] **Step 4: Run diff hygiene**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.
