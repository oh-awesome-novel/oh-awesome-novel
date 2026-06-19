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

- [x] `.oan/indexes/state.md`
- [x] `.oan/indexes/foreshadow.md`
- [x] `.oan/indexes/timeline.md`
- [x] `.oan/indexes/progress.md`
- [x] `.oan/indexes/context-snapshot.md` as optional agent-readable index

### Task 2: Build Generators

- [x] Read `state/*.yaml`.
- [x] Read `foreshadow/active.yaml` and `foreshadow/resolved.yaml`.
- [x] Read `timeline/*.yaml`.
- [x] Read `summaries/`.
- [x] Generate deterministic Markdown.

### Task 3: Keep Projection Non-Canonical

- [x] Add heading warning: generated projection, can be rebuilt.
- [x] Do not let write-intent tools read projection instead of truth files when truth files are needed.
- [x] If projection missing, agent should fall back to truth files.

### Task 4: Project Health Model

- [x] Detect missing character card references where possible.
- [x] Detect chapters with no summary.
- [x] Count active hooks.
- [x] Detect stale latest state if chapter accepted after state update.
- [x] Detect timeline gaps when chapter summaries exist without events.
- [x] Report pending action count.

### Task 5: Backend / UI

- [x] Add read-only endpoint or core call for project health.
- [x] Add minimal UI panel or inspector section.
- [x] UI must not mutate canon.

### Task 6: Tests

- [x] Projection rebuild from sample workspace.
- [x] Delete projection and rebuild identical output.
- [x] Project health returns warnings without writing files.
- [x] Projection failure does not fail ordinary writing command tests.
