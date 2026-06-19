# Review And Settlement Workflow Implementation Plan

> **For agentic workers:** Review reports are not writes. Settlement writes only evidence-supported facts through PendingAction.

**Goal:** Stabilize review findings, de-AI protection, observation log, and settlement bundle.

**Architecture:** Review and settlement schema live in core. Actual fact writes continue through write-intent tools and later SemanticPatch Apply Engine.

**Tech Stack:** TypeScript, core schema helpers, existing `packages/tools` write-intent tools, Vitest.

---

## File Structure

- Create: `packages/core/src/writing-review.ts`
- Create: `packages/core/src/writing-settlement.ts`
- Modify: `packages/core/src/novel-copilot-skill.ts`
- Modify: `docs/NOVEL_AGENT_COPILOT_SPEC.md`
- Test: `__test__/core/src/writing-review.test.ts`
- Test: `__test__/core/src/writing-settlement.test.ts`
- Later modify: `packages/tools/src/write-intent-tools.ts` when adding richer settlement write-intent helpers

---

### Task 1: Review Schema

- [x] Define `ReviewFinding`.
- [x] Define `ReviewDimensionResult`.
- [x] Define categories: continuity, character, world, plot, hook, pacing, style, evidence.
- [x] Add formatter that groups findings by severity.

### Task 2: Review Command Contract

- [x] `/审稿` prompt defaults to report-only.
- [x] Require evidence, location, suggested fix, needs user decision.
- [x] Require dimension pass for dimensions with no issues.
- [x] Only use `chapter.createDraft` when user asks for revised draft.

### Task 3: De-AI Protection

- [x] Add `/去AI味` rule block:
  - only expression changes
  - no plot fact changes
  - no deletion of hooks, character traits, key information, necessary turns
  - preserve style constitution
- [x] Add tests checking prompt contains protections.

### Task 4: Observation Log

- [x] Define `ObservationLog`.
- [x] Include characters, location, item/resource/injury/power/status, relationship, emotion arc, information boundary, time, scene state, foreshadow, world facts.
- [x] Add evidence and confidence fields.

### Task 5: Settlement Bundle

- [x] Define `SettlementBundle`.
- [x] Include fulfillment, ambiguities, observations, patches, summary, state changes, timeline events, foreshadow changes, character updates, next handoff.
- [x] Add hook operation taxonomy: create, mention, advance, resolve, defer.
- [x] Ensure unresolved ambiguity defaults to report/session artifact, not truth files.

### Task 6: Prompt And Tests

- [x] Update `/整理本章` prompt to require observation log before PendingAction bundle.
- [x] Test review does not imply settlement.
- [x] Test settlement formatter separates observations and patches.
- [x] Test evidence-only wording exists in skill prompt.
