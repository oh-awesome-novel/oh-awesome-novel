# Projections And Project Health Implementation Plan

> **For agentic workers:** Projection is a read model, not truth. It must be deletable and rebuildable.

**Goal:** Provide author-readable views and read-only health checks over existing Object File Tree domains.

**Architecture:** Projection generators read canonical Markdown/YAML and write derived Markdown under `.oan/indexes` only through explicit user-triggered rebuild or internal safe generation path defined by the task.

**Tech Stack:** TypeScript, existing Markdown/YAML engines, `packages/core` / `packages/tools`, backend read endpoint, Vue UI.

---

## File Structure

- Create: `packages/core/src/projections.ts`
- Create: `packages/core/src/project-health.ts`
- Modify: `packages/core/src/index.ts`
- Optional modify: `packages/backend/src/index.ts`
- Optional create: `apps/desktop-ui/src/components/workspace/ProjectHealthPanel.vue`
- Test: `__test__/core/src/projections.test.ts`
- Test: `__test__/core/src/project-health.test.ts`

---

### Task 1: Define Projection Targets

- [ ] `.oan/indexes/state.md`
- [ ] `.oan/indexes/foreshadow.md`
- [ ] `.oan/indexes/timeline.md`
- [ ] `.oan/indexes/progress.md`
- [ ] `.oan/indexes/context-snapshot.md` as optional agent-readable index

### Task 2: Build Generators

- [ ] Read `state/*.yaml`.
- [ ] Read `foreshadow/active.yaml` and `foreshadow/resolved.yaml`.
- [ ] Read `timeline/*.yaml`.
- [ ] Read `summaries/`.
- [ ] Generate deterministic Markdown.

### Task 3: Keep Projection Non-Canonical

- [ ] Add heading warning: generated projection, can be rebuilt.
- [ ] Do not let write-intent tools read projection instead of truth files when truth files are needed.
- [ ] If projection missing, agent should fall back to truth files.

### Task 4: Project Health Model

- [ ] Detect missing character card references where possible.
- [ ] Detect chapters with no summary.
- [ ] Count active hooks.
- [ ] Detect stale latest state if chapter accepted after state update.
- [ ] Detect timeline gaps when chapter summaries exist without events.
- [ ] Report pending action count.

### Task 5: Backend / UI

- [ ] Add read-only endpoint or core call for project health.
- [ ] Add minimal UI panel or inspector section.
- [ ] UI must not mutate canon.

### Task 6: Tests

- [ ] Projection rebuild from sample workspace.
- [ ] Delete projection and rebuild identical output.
- [ ] Project health returns warnings without writing files.
- [ ] Projection failure does not fail ordinary writing command tests.

