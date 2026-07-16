# Play Worldline M2 Implementation Plan

**Goal:** Make Play world events understandable and make branch exploration usable without exposing the turn graph as the primary product language.

**Architecture:** Reuse the immutable turn ledger, selected path, branch base, Restore and Retry. Add only checkpoint annotations to `session.yaml`; do not add `checkpoints/` or `variants/` truth directories. Event explanations are derived from selected artifacts, schedules and momentum records, while hidden reasons remain behind the spoiler gate.

**Tech Stack:** TypeScript, YAML, Hono, Vue 3 Composition API, Vitest.

---

## Task 1: Freeze The Worldline Contract

- [x] Add a real `initialWorld` checkpoint target backed by the virtual branch base.
- [x] Add stable checkpoint ids, parent links, depth and optional author names without pretending the initial world is a turn artifact.
- [x] Store names as validated session metadata annotations and advance the Play-local revision through the staged writer.

## Task 2: Add Backend And Client CAS Routes

- [x] List initial / turn checkpoints through the existing checkpoint endpoint.
- [x] Restore and rename by checkpoint id with mandatory `baseRevision`.
- [x] Keep active-attempt conflicts, staged writes and strict Client guards intact.

## Task 3: Explain Events

- [x] Derive spoiler-safe action, trigger, source-event, pressure and agenda labels from the selected branch.
- [x] Present the event summary as impact, show world time and related state changes, and keep ids / revisions in expandable technical details.
- [x] Keep structured `cause.reason` author-only.

## Task 4: Replace The Flat History UI

- [x] Present one branch timeline rooted at the initial world.
- [x] Support naming, Restore and Retry with clear worldline language.
- [x] Keep old results visibly retained as variants and preserve keyboard / focus / `aria-live` behavior.

## Task 5: Verification And Documentation

- [x] Cover initial restore, naming persistence, branch retention, strict transport and stale revision conflicts.
- [x] Cover event explanation, spoiler gating and Desktop worldline interaction.
- [x] Run Core / Backend / Client / Desktop tests, Desktop build and `git diff --check`.
- [x] Update task `1120` and both Play upgrade plans with the delivered M2 boundary.

**Verification (2026-07-16):** Core 201, Backend 53, Client 57 and Desktop 115 tests passed; Desktop production build passed. Historical event explanations use owning-artifact evidence and fail closed when unavailable; Player projection hides technical and hidden momentum details.
