# Unify AI SDK ToolSet Tool Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure the implementation uses Vercel AI SDK `ToolSet` as the only runtime/tool-calling abstraction, with no `defineStoryTool()`, `StoryTool`, or independent `RuntimeToolRegistry`.

**Architecture:** `packages/tools` owns concrete read/write-intent tool factories that return AI SDK `ToolSet`. `packages/agent` assembles the default novel `ToolSet` and injects it into `packages/runtime`. `packages/runtime` only receives and executes `ToolSet` entries; if UI metadata is needed later, it lives in a thin sidecar map keyed by tool name.

**Tech Stack:** TypeScript, Vercel AI SDK `tool()` / `jsonSchema()` / `ToolSet`, existing `packages/tools`, `packages/agent`, `packages/runtime`, Vitest tests under `__test__/tools`, `__test__/agent`, and `__test__/runtime`.

---

## File Structure

- Inspect: `packages/runtime/src/types.ts`
  - Confirm runtime accepts AI SDK `ToolSet`.
- Inspect: `packages/runtime/src/runtime.ts`
  - Confirm runtime executes `ToolSet[string]` tools directly.
- Inspect: `packages/tools/src/read-tools.ts`
  - Confirm read tools use AI SDK `tool()` / `jsonSchema()`.
- Inspect: `packages/tools/src/write-intent-tools.ts`
  - Confirm write-intent tools use AI SDK `tool()` / `jsonSchema()`.
- Inspect: `packages/agent/src/index.ts`
  - Confirm `createNovelAgentToolSet()` assembles read and write-intent `ToolSet`.
- Modify only if stale abstractions exist: implementation files containing `defineStoryTool`, `StoryTool`, `RuntimeToolRegistry`, or custom `ToolRegistry`.
- Test: existing runtime, tools, and agent test workspaces.

Do not create a new registry framework. Do not replace AI SDK `ToolSet`.

---

### Task 1: Verify No Second Tool Abstraction Exists

**Files:**

- Inspect: `packages/runtime/src/types.ts`
- Inspect: `packages/runtime/src/runtime.ts`
- Inspect: `packages/tools/src/read-tools.ts`
- Inspect: `packages/tools/src/write-intent-tools.ts`
- Inspect: `packages/agent/src/index.ts`

- [ ] **Step 1: Search for stale symbols**

Run:

```bash
rg -n 'defineStoryTool|StoryTool|RuntimeToolRegistry|class ToolRegistry|interface ToolRegistry' packages apps __test__
```

Expected:

```text
no matches
```

If matches exist, they are stale unless they are only comments explaining removed behavior.

- [ ] **Step 2: Confirm runtime type boundary**

Inspect `packages/runtime/src/types.ts`.

Expected shape:

```ts
import type { ToolSet } from 'ai';

export interface RuntimeModelRequest {
  messages: RuntimeMessage[];
  tools: ToolSet;
  abortSignal?: AbortSignal;
}

export interface CopilotRuntimeOptions {
  model: RuntimeModelAdapter;
  tools?: ToolSet;
  contextBuilder?: RuntimeContextBuilder;
  maxToolLoops?: number;
  onEvent?: (event: RuntimeEvent) => void | Promise<void>;
}
```

- [ ] **Step 3: Confirm tool execution uses `ToolSet`**

Inspect `packages/runtime/src/runtime.ts`.

Expected behavior:

- `listActiveTools()` returns `ToolSet`.
- tool lookup uses the tool call name as a `ToolSet` key.
- execution calls the AI SDK tool `execute` function.
- unknown tool returns recoverable `TOOL_NOT_FOUND`.

Do not add a registry class.

---

### Task 2: Verify Tool Factories Return AI SDK `ToolSet`

**Files:**

- Inspect: `packages/tools/src/read-tools.ts`
- Inspect: `packages/tools/src/write-intent-tools.ts`
- Inspect: `packages/tools/src/restricted-write-tool.ts`
- Inspect: `packages/tools/src/index.ts`

- [ ] **Step 1: Confirm read tools**

Expected:

```ts
import { jsonSchema, tool } from 'ai';
import type { ToolSet } from 'ai';

export function createReadTools(options: CreateReadToolsOptions): ToolSet {
  return {
    'character.get': createCharacterGetTool(options),
  };
}
```

The exact returned tool list may differ, but the factory must return `ToolSet` and individual tools must be built with AI SDK `tool()`.

- [ ] **Step 2: Confirm write-intent tools**

Expected:

```ts
import { jsonSchema, tool } from 'ai';
import type { ToolSet } from 'ai';

export function createWriteIntentTools(
  options: CreateWriteIntentToolsOptions,
): ToolSet {
  return {
    'state.set': createStateSetTool(options),
  };
}
```

Do not introduce `defineStoryTool()`.

- [ ] **Step 3: Confirm package exports**

Expected `packages/tools/src/index.ts` exports factory functions:

```ts
export { createReadTools } from './read-tools';
export { createWriteIntentTools } from './write-intent-tools';
export { createRestrictedWriteTools } from './restricted-write-tool';
```

No `StoryTool` export should exist.

---

### Task 3: Verify Agent ToolSet Assembly

**Files:**

- Inspect: `packages/agent/src/index.ts`
- Test: `__test__/agent/src/tool-registry.test.ts`

- [ ] **Step 1: Confirm default assembly**

Expected:

```ts
export const createNovelAgentToolSet = (
  input: NovelAgentToolSetInput,
): ToolSet => input.tools ?? {
  ...createReadTools({ workspaceRoot: input.workspaceRoot }),
  ...createWriteIntentTools({ workspaceRoot: input.workspaceRoot }),
};
```

The test file may keep a historical name like `tool-registry.test.ts`, but assertions should describe AI SDK `ToolSet` assembly, not a custom registry class.

- [ ] **Step 2: Confirm model-visible filtering keeps `ToolSet`**

If `packages/agent/src/index.ts` filters tools before sending them to the model, it should accept and return `ToolSet`, not custom registry entries.

- [ ] **Step 3: Run agent tests**

Run:

```bash
npm run test:run --workspace @oh-awesome-novel/test-agent
```

Expected:

```text
Test Files  4 passed
```

or the current full agent test suite passing.

---

### Task 4: Add Sidecar Metadata Only If Needed

**Files:**

- Modify only if a current UI/runtime need exists: `packages/tools/src/tool-metadata.ts`
- Modify only if added: `packages/tools/src/index.ts`
- Test only if added: `__test__/tools/src/tool-metadata.test.ts`

- [ ] **Step 1: Skip this task unless there is a real consumer**

If no UI/backend code needs `readOnly`, `risk`, or `allowedInSkills`, do not add metadata yet.

Expected outcome:

```text
No code changes.
```

- [ ] **Step 2: If metadata is required, keep it as a sidecar map**

Only if there is a real consumer, create:

```ts
export interface ToolMetadata {
  readOnly: boolean;
  risk: 'low' | 'medium' | 'high';
  allowedInSkills?: string[];
}

export type ToolMetadataMap = Record<string, ToolMetadata>;

export const DEFAULT_TOOL_METADATA: ToolMetadataMap = {
  'character.get': { readOnly: true, risk: 'low' },
  'state.set': { readOnly: false, risk: 'medium' },
};
```

This metadata must not wrap or replace the AI SDK tool implementation.

- [ ] **Step 3: Export metadata if added**

If Task 4 Step 2 created metadata, export it:

```ts
export {
  DEFAULT_TOOL_METADATA,
} from './tool-metadata';
export type {
  ToolMetadata,
  ToolMetadataMap,
} from './tool-metadata';
```

---

### Task 5: Verify Full Tool Boundary

**Files:**

- Relevant runtime, tools, and agent files.

- [ ] **Step 1: Run runtime tests**

Run:

```bash
npm run test:run --workspace @oh-awesome-novel/test-runtime
```

Expected: all runtime tests pass.

- [ ] **Step 2: Run tools tests**

Run:

```bash
npm run test:run --workspace @oh-awesome-novel/test-tools
```

Expected: all tools tests pass.

- [ ] **Step 3: Run agent tests**

Run:

```bash
npm run test:run --workspace @oh-awesome-novel/test-agent
```

Expected: all agent tests pass.

- [ ] **Step 4: Confirm stale abstractions are absent**

Run:

```bash
rg -n 'defineStoryTool|StoryTool|RuntimeToolRegistry|class ToolRegistry|interface ToolRegistry' packages apps __test__
```

Expected:

```text
no matches
```

- [ ] **Step 5: Run diff hygiene**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.
