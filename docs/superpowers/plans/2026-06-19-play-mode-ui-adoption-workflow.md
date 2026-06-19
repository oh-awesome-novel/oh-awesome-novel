# Play Mode UI And Adoption Workflow Implementation Plan

> **For agentic workers:** Use one world referee in the existing runtime. Do not implement multi-agent roleplay as the default.

**Goal:** Connect Play session core helpers to backend routes, UI, and PendingAction adoption.

**Architecture:** Play session persistence remains under `.workspace/play-sessions`. Adoption uses existing write-intent tools and Human Approval.

**Tech Stack:** TypeScript, Hono backend, Vue, existing runtime / write-intent tools, Vitest.

---

## File Structure

- Modify: `packages/backend/src/index.ts`
- Modify: `packages/client/src/index.ts`
- Modify: `apps/desktop-ui/src/components/workspace/*` or add Play components
- Modify: `packages/core/src/play-session.ts` only if schema gaps appear
- Test: `__test__/core/src/play-session.test.ts`
- Test: `__test__/backend/src/backend.test.ts`

---

### Task 1: Backend Play Routes

- [ ] Add create Play session route.
- [ ] Add list / read Play session route.
- [ ] Add append transcript turn route.
- [ ] Add add observation / adoption candidate route.
- [ ] Keep every route scoped to active workspace.

### Task 2: Client API

- [ ] Add Play session types to `packages/client`.
- [ ] Add create / list / read / update methods.
- [ ] Keep Vue components transport-agnostic.

### Task 3: Play UI

- [ ] Add Play panel or route.
- [ ] Show transcript, play-local state, activated sources, observations, and adoption candidates.
- [ ] Make canonical/non-canonical boundary visible.

### Task 4: World Referee Turn

- [ ] Use `formatPlayWorldRefereePrompt()` as the Play system context.
- [ ] Reuse existing runtime / model adapter.
- [ ] Do not spawn character subagents.
- [ ] Persist transcript and observations after the turn.

### Task 5: Adoption To PendingAction

- [ ] Convert chapter adoption to `chapter.createDraft`.
- [ ] Convert state adoption to `state.set`.
- [ ] Convert timeline adoption to `timeline.add`.
- [ ] Convert foreshadow adoption to `foreshadow.create`.
- [ ] Require user action before creating adoption PendingAction.

### Task 6: Tests

- [ ] Route test proves session files stay under `.workspace/play-sessions`.
- [ ] Adoption test proves canonical files are unchanged before accept.
- [ ] UI/client test covers Play route shape or client methods.

