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

- [ ] Define `.workspace/sessions/<session-id>/run.yaml`.
- [ ] Define optional `context-package.yaml`.
- [ ] Define `outputs.yaml`.
- [ ] Define `proposed-patches.yaml`.
- [ ] Define `unresolved.md`.

### Task 2: Add Safe Path Helpers

- [ ] Add `resolveSessionArtifactPath(workspaceRoot, sessionId, file)`.
- [ ] Reject traversal.
- [ ] Keep all writes inside `.workspace/sessions`.

### Task 3: Add Artifact Types

- [ ] `AgentSessionArtifact`.
- [ ] `SessionRunMetadata`.
- [ ] `SessionOutputArtifact`.
- [ ] `SessionResumeBoundary`.
- [ ] `AuthorReport`.

### Task 4: Resume Boundary

- [ ] Store input source hashes where cheap and useful.
- [ ] Store output artifact paths.
- [ ] Store proposed PendingAction ids.
- [ ] On resume, compare current file mtime/hash for touched files.
- [ ] If user changed files, report choices: use manual changes, continue from manual changes, or abandon stale artifact.

### Task 5: Author Report

- [ ] Add formatter with:
  - total status
  - candidate outputs
  - accepted/rejected/pending actions
  - unresolved decisions
  - next suggested action
- [ ] Keep raw JSON/logs out of final author report.

### Task 6: Tests

- [ ] Unit test writing run metadata.
- [ ] Unit test path safety.
- [ ] Unit test resume boundary detects changed touched file.
- [ ] Unit test report formatter is concise and human-readable.

