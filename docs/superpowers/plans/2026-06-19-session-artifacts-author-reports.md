# Session Artifacts And Author Reports Implementation Plan

> **For agentic workers:** Start lightweight. Do not build a database or comprehensive telemetry platform.

**Goal:** Persist enough long-task metadata for resume, author-facing status, and safe continuation.

**Architecture:** Session artifacts live under `.workspace/sessions`. They are recoverable workspace internals, not canonical novel truth.

**Tech Stack:** TypeScript, Node filesystem APIs, YAML, `packages/core` / `packages/agent`, Vitest.

---

## File Structure

- Create: `packages/core/src/session-artifacts.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/agent/src/*` for long-task artifact writing
- Test: `__test__/core/src/session-artifacts.test.ts`
- Optional UI later: `apps/desktop-ui/src/components/workspace/SessionArtifactPanel.vue`

---

### Task 1: Define Session Layout

- [x] Define `.workspace/sessions/<session-id>/run.yaml`.
- [x] Define optional `context-package.yaml`.
- [x] Define `outputs.yaml`.
- [x] Define `proposed-patches.yaml`.
- [x] Define `unresolved.md`.

### Task 2: Add Safe Path Helpers

- [x] Add `resolveSessionArtifactPath(workspaceRoot, sessionId, file)`.
- [x] Reject traversal.
- [x] Keep all writes inside `.workspace/sessions`.

### Task 3: Add Artifact Types

- [x] `AgentSessionArtifact`.
- [x] `SessionRunMetadata`.
- [x] `SessionOutputArtifact`.
- [x] `SessionResumeBoundary`.
- [x] `AuthorReport`.

### Task 4: Resume Boundary

- [x] Store input source hashes where cheap and useful.
- [x] Store output artifact paths.
- [x] Store proposed PendingAction ids.
- [x] On resume, compare current file mtime/hash for touched files.
- [x] If user changed files, report choices: use manual changes, continue from manual changes, or abandon stale artifact.

### Task 5: Author Report

- [x] Add formatter with:
  - total status
  - candidate outputs
  - accepted/rejected/pending actions
  - unresolved decisions
  - next suggested action
- [x] Keep raw JSON/logs out of final author report.

### Task 6: Tests

- [x] Unit test writing run metadata.
- [x] Unit test path safety.
- [x] Unit test resume boundary detects changed touched file.
- [x] Unit test report formatter is concise and human-readable.
