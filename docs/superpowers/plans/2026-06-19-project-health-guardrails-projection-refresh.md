# Project Health Guardrails And Projection Refresh Implementation Plan

> **For agentic workers:** Health and projections are read-only or generated views. They must not become truth files.

**Goal:** Integrate project health and projection rebuild into user-visible guardrails and post-accept refresh.

**Architecture:** `packages/core` already computes health and projections. Backend exposes explicit refresh endpoints. UI presents warnings and refresh results.

**Tech Stack:** TypeScript, Hono backend, Vue, existing PendingAction approval flow, Vitest.

---

## File Structure

- Modify: `packages/backend/src/index.ts`
- Modify: `packages/client/src/index.ts`
- Modify: `apps/desktop-ui/src/composables/useWorkspaceApi.ts`
- Modify: `apps/desktop-ui/src/components/workspace/ProjectHealthTab.vue`
- Modify: `apps/desktop-ui/src/components/workspace/ApprovalTab.vue` or PendingAction components
- Test: `__test__/backend/src/backend.test.ts`
- Test: `__test__/client/src/client.test.ts`

---

### Task 1: Projection Rebuild Endpoint

- [ ] Add explicit backend route for projection rebuild.
- [ ] Route calls `writeWorkspaceProjections()`.
- [ ] Return generated paths and warnings.
- [ ] Keep writes limited to `.oan/indexes/*`.

### Task 2: Post-Accept Refresh Payload

- [ ] After PendingAction accept / reject, refresh pending action count.
- [ ] Refresh git status.
- [ ] Refresh project health.
- [ ] Return enough data for UI to avoid stale local-only state.

### Task 3: UI Refresh Flow

- [ ] PendingAction accept / reject updates status from backend response only.
- [ ] Refresh Project Health panel after decision.
- [ ] Offer explicit projection rebuild action.
- [ ] Show projection rebuild errors as non-blocking.

### Task 4: Agent Guardrail Context

- [ ] Provide concise project health warning summary as optional selected context.
- [ ] Do not feed projections as substitute truth source.
- [ ] Mark stale state / missing settlement / timeline gaps as warnings, not automatic blockers.

### Task 5: Tests

- [ ] Backend route rebuilds projections under `.oan/indexes`.
- [ ] PendingAction decision returns refreshed health or triggers client refresh.
- [ ] Projection rebuild failure does not mark PendingAction accept as failed.
- [ ] Client test confirms UI APIs call backend rather than local-only mutation.

