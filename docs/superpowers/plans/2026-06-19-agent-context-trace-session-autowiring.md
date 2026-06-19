# Agent Context Trace And Session Artifact Autowiring Implementation Plan

> **For agentic workers:** Extend the existing lightweight contracts. Do not build a telemetry platform or heavy context registry.

**Goal:** Automatically create context trace and session artifacts for writing-related agent runs.

**Architecture:** `packages/core` owns pure types / formatters / artifact helpers. `packages/agent` wires runtime results to artifacts. `packages/backend` can request baseline context package creation for model mode.

**Tech Stack:** TypeScript, YAML, existing runtime events, existing `.workspace/sessions` layout, Vitest.

---

## File Structure

- Modify: `packages/core/src/agent-context-package.ts`
- Modify: `packages/core/src/session-artifacts.ts` if extra output classification is needed
- Modify: `packages/agent/src/index.ts`
- Modify: `packages/backend/src/index.ts`
- Test: `__test__/core/src/agent-context-package.test.ts`
- Test: `__test__/agent/src/message-assembly.test.ts`
- Test: `__test__/agent/src/session-store.test.ts` or new artifact autowiring tests

---

### Task 1: Add Context Trace Type

- [ ] Add `ContextTraceEntry`.
- [ ] Add `trace: ContextTraceEntry[]` to `ContextPackage`.
- [ ] Keep trace free of hidden chain-of-thought.
- [ ] Validate trace reason when outcome is selected / omitted / compressed / failed.

### Task 2: Build Baseline Context Package In Agent Layer

- [ ] Add helper to infer capability from quick command slash text or explicit metadata.
- [ ] Map workspace snapshot fields to source ids.
- [ ] Record selected and omitted source reasons.
- [ ] Keep normal chat turns artifact-light.

### Task 3: Connect Runtime Tool Log To Trace

- [ ] Convert read tool calls into trace entries when source id can be inferred.
- [ ] Convert PendingAction-producing tool calls into proposed patch metadata.
- [ ] Preserve recoverable tool failures in trace without blocking the run.

### Task 4: Write Session Artifacts After Long Or Write-Producing Runs

- [ ] Add agent-layer function to convert `RunTurnResult` into `AgentSessionArtifact`.
- [ ] Write `context-package.yaml` when a package exists.
- [ ] Write `run.yaml`, `outputs.yaml`, `proposed-patches.yaml`, and `unresolved.md`.
- [ ] Include touched files and PendingAction ids.

### Task 5: Author Report And Resume Boundary

- [ ] Generate concise author report for long or write-producing runs.
- [ ] Capture resume boundary for touched files.
- [ ] On resume, warn when files were manually changed or removed.

### Task 6: Tests

- [ ] Unit test context trace formatting and validation.
- [ ] Agent test proves baseline context package appears in model-visible context.
- [ ] Agent test proves PendingAction run writes session artifact files.
- [ ] Resume test proves manual change prompt is surfaced.

