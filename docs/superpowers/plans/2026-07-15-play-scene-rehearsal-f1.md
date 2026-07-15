# First Playable Scene Rehearsal Implementation Plan

**Goal:** Deliver the F1 Scene Rehearsal vertical slice without changing ordinary Quick Start or introducing a multi-agent runtime.

**Architecture:** A v5 rehearsal parent pairs exactly with a versioned sidecar and committed scene evidence. Uncommitted attempts live only in `.recovery`. Actor generation uses a perception-only, tool-free AI SDK stream; Finish is a typed transaction that reuses the existing Play settlement and staged writer.

**Tech Stack:** TypeScript, YAML, Hono, AI SDK `streamText`, Vue 3 Composition API, Vitest.

---

## Task 1: Freeze Core Rehearsal Schemas

- [x] Add Scene Contract, participant, frozen knowledge evidence, perception, NarrativeBlock and committed evidence codecs in an independent module.
- [x] Add a pure attempt state machine with exact revision and idempotency receipts.
- [x] Add a recovery store under `.recovery/turn-attempts` that is never projected as committed truth.

## Task 2: Add v4 / v5 Session Pairing

- [x] Keep ordinary sessions on v4; create v5 only for new Scene Rehearsal sessions.
- [x] Add strict parent / sidecar / active scene pairing and staged writer manifest support.
- [x] Reject orphan, missing, future or mismatched rehearsal artifacts.

## Task 3: Commit Rehearsal Evidence

- [x] Add rehearsal turn artifact v3 evidence refs while preserving v1 / v2 reads.
- [x] Aggregate selected step contributions through the existing typed settlement validator.
- [x] Commit turn, scene evidence and projections in one staged snapshot; verify selected-branch ownership.

## Task 4: Backend And Client Attempt Contract

- [x] Add create/get attempt, step stream / stop, accept, finalize and cancel routes.
- [x] Keep step-run, attempt and committed-turn identity separate.
- [x] Enforce one active attempt, attempt revision, idempotency and finalize session revision recheck.
- [x] Stream actor steps with direct `streamText` and no workspace tools or broad agent context.
- [x] Add strict Client types, guards, request methods and SSE parser.

## Task 5: Desktop Scene Rehearsal

- [x] Add purpose selection and compact Scene / Cast / Review without changing Quick Start.
- [x] Add independent setup, attempt and actor-step stream composables.
- [x] Add actor queue, provisional / selected / committed panels and Accept / Retry / Finish / Cancel controls.
- [x] Add keyboard, focus return, `aria-live` and reduced-motion coverage using neutral design tokens.

## Task 6: Verification And Documentation

- [x] Cover perception filtering, idempotency, Stop / Cancel, hard-due once, atomic Finish and evidence ownership.
- [x] Add one complete mocked Desktop journey and Quick Start regression.
- [x] Run Core / Backend / Client / Desktop tests, Desktop build and `git diff --check`.
- [x] Update task status and both Play upgrade plans with accurate completed / remaining scope.
