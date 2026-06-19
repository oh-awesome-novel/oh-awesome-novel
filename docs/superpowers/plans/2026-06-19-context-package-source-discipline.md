# Context Package And Source Discipline Implementation Plan

> **For agentic workers:** Implement as a lightweight explanatory layer. Do not build a heavy runtime registry.

**Goal:** Give each writing task an explicit explanation of selected context, omitted context, rule priority, and minimal memory.

**Architecture:** Context package builders live in `packages/core` or `packages/agent` as deterministic helpers. Read tools remain the way facts are loaded.

**Tech Stack:** TypeScript, YAML serialization, existing `.workspace` shadow/session conventions, Vitest.

---

## File Structure

- Create: `packages/core/src/agent-context-package.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/agent/src/*` where runtime context is assembled
- Test: `__test__/core/src/agent-context-package.test.ts`
- Test: `__test__/agent/src/*` if session assembly tests exist

---

### Task 1: Define Types

- [x] Add `ContextBudgetLayer = 'L0' | 'L1' | 'L2' | 'L3'`.
- [x] Add `SemanticBoundary = 'protected' | 'compressible' | 'excluded'`.
- [x] Add `ContextSourceRef`.
- [x] Add `MinimalMemory`.
- [x] Add `RuleStackEntry`.
- [x] Add `ContextPackage`.

### Task 2: Define Lightweight Source IDs

- [x] Add constants for `workflow`, `constitution`, `chapterContract`, `previousChapterEnding`, `latestState`, `characters`, `worldRules`, `foreshadowLedger`, `timeline`, `styleGuide`, `referenceDistilled`, `playTranscript`.
- [x] Keep constants as metadata only; do not create dynamic source readers.

### Task 3: Build Context Package Helpers

- [x] Add `createContextPackageDraft(input)`.
- [x] Add `addSelectedSource()` and `addOmittedSource()` helpers.
- [x] Add `deriveMinimalMemory()` placeholder that accepts already-read facts and returns a filtered summary.
- [x] Add validation that omitted sources have a reason.

### Task 4: Session Artifact Persistence

- [x] Reuse or define `.workspace/sessions/<session-id>/` path helpers.
- [x] Add `writeContextPackageArtifact()` for long tasks.
- [x] Ensure writes stay under `.workspace`, not truth files.

### Task 5: Agent Integration

- [x] Include context package summary in model-visible context for writing commands.
- [x] Ensure final responses can mention selected / omitted sources succinctly.
- [x] Do not require every casual chat to create an artifact.

### Task 6: Tests

- [x] Unit test L0/L1 cannot be silently omitted without reason.
- [x] Unit test minimal-memory is nested under context package.
- [x] Unit test artifact path rejects traversal and hidden target override.
