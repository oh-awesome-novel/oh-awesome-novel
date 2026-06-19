# Agent Writing Guide vNext Spec Implementation Plan

> **For agentic workers:** Execute task-by-task. Keep `docs/OAN_AGENT_WRITING_GUIDE_REFERENCE_NOTES.md` as source attribution, but implement against `docs/OAN_AGENT_WRITING_GUIDE_IMPLEMENTATION_SPEC.md`.

**Goal:** Establish the stable vNext Copilot writing contract before implementing derived artifacts or UI.

**Architecture:** Core owns the skill data and command contracts. Agent/runtime remain Aider-style. Tools remain AI SDK `ToolSet`.

**Tech Stack:** TypeScript, `packages/core`, existing `packages/agent`, Vitest under `__test__/core` and `__test__/agent`.

---

## File Structure

- Modify: `docs/NOVEL_AGENT_COPILOT_SPEC.md`
- Modify: `packages/core/src/novel-copilot-skill.ts`
- Modify: `packages/core/src/index.ts`
- Test: `__test__/core/src/novel-copilot-skill.test.ts`
- Inspect: `packages/agent/src/*`

Do not modify `packages/runtime`.

---

### Task 1: Align Specs

- [x] Update `docs/NOVEL_AGENT_COPILOT_SPEC.md` to reference `OAN_AGENT_WRITING_GUIDE_IMPLEMENTATION_SPEC.md`.
- [x] Clarify `/审稿` is report-only unless user asks for rewrite or settlement.
- [x] Add `/规划大纲` and `/规划下一卷` command contracts.
- [x] Add vNext concepts: capability id, context package, chapter contract, pre-write check, review finding, settlement bundle.

### Task 2: Add Capability Metadata

- [x] Add `NovelCopilotCapabilityId` union in `packages/core/src/novel-copilot-skill.ts`.
- [x] Extend quick command metadata with `capabilityId`.
- [x] Add non-command capability metadata for `novel.play_scene`, `novel.import_tavern_character`, and `novel.deconstruct_reference` as planned capabilities.
- [x] Export capability types from `packages/core/src/index.ts`.

### Task 3: Update Quick Commands

- [x] Add `/规划大纲`.
- [x] Add `/规划下一卷`.
- [x] Update `/规划下一章` prompt to output light chapter contract.
- [x] Update `/写下一章` prompt to require short `PRE_WRITE_CHECK`.
- [x] Update `/审稿` prompt to forbid implicit settlement.
- [x] Update `/整理本章` prompt to require observation log before PendingAction bundle.

### Task 4: Add Tests

- [x] Assert quick command registry contains all existing commands plus `/规划大纲` and `/规划下一卷`.
- [x] Assert `/审稿` prompt contains report-only wording.
- [x] Assert `/写下一章` prompt mentions `PRE_WRITE_CHECK`.
- [x] Assert default allowed tools did not add non-existent tools.

### Task 5: Run Verification

- [x] Run `npm run test:run --workspace @oh-awesome-novel/test-core`.
- [x] Run agent tests if prompt assembly snapshots exist.
- [x] Manually inspect generated prompt for no hidden multi-agent or direct-write language.
