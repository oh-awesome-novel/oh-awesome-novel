# Planning Commands And Prewrite Calibration Implementation Plan

> **For agentic workers:** Keep ordinary chapter writing lightweight. Put heavy structure in outline, volume, or key-chapter planning.

**Goal:** Implement chapter contracts, planning granularity, and short pre-write checks.

**Architecture:** Planning artifacts are assistant output or session artifacts until the user explicitly persists them through PendingAction.

**Tech Stack:** TypeScript, core command metadata, optional YAML/Markdown artifact helpers, Vitest.

---

## File Structure

- Create: `packages/core/src/writing-planning.ts`
- Modify: `packages/core/src/novel-copilot-skill.ts`
- Modify: `docs/NOVEL_AGENT_COPILOT_SPEC.md`
- Test: `__test__/core/src/writing-planning.test.ts`
- Test: `__test__/core/src/novel-copilot-skill.test.ts`

---

### Task 1: Add Planning Types

- [ ] Define `ChapterContract`.
- [ ] Define `VolumePlanningPacket`.
- [ ] Define `OutlinePlanningPacket`.
- [ ] Define `PreWriteCheck`.
- [ ] Define `PlanningGranularity = 'outline' | 'volume' | 'chapter' | 'keyChapter'`.

### Task 2: Add Formatters

- [ ] Add Markdown formatter for light chapter contract.
- [ ] Add Markdown formatter for volume planning packet.
- [ ] Add Markdown formatter for `PRE_WRITE_CHECK`.
- [ ] Keep formatters deterministic for tests.

### Task 3: Update Command Prompts

- [ ] `/规划大纲`: reads constitution, workflow, long direction, existing summaries/state, distilled references if enabled.
- [ ] `/规划下一卷`: reads prior volume/stage summary, current state, active hooks, character arcs, timeline, necessary world rules.
- [ ] `/规划下一章`: outputs light chapter contract by default.
- [ ] `/写下一章`: must output short `PRE_WRITE_CHECK` before `chapter.createDraft`.

### Task 4: Prevent Overweight Single-Chapter Flow

- [ ] Prompt says CBN / CPNs / CEN only for volume, outline, key chapters, or user-requested detailed planning.
- [ ] Tests assert ordinary `/写下一章` prompt does not require full prewrite/precommit/postcommit gate.

### Task 5: Persistence Boundary

- [ ] Planning outputs remain assistant/session artifacts by default.
- [ ] If user asks to persist a plan, route through a future write-intent or existing appropriate PendingAction path.
- [ ] Do not store chapter contract in `chapters/` body.

### Task 6: Verification

- [ ] Run core tests.
- [ ] Manually inspect prompt text for no direct writes.

