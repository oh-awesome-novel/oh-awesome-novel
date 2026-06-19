# Play Mode And Tavern Character Import Implementation Plan

> **For agentic workers:** Play is a separate product surface. It can feed writing, but it is not canonical truth by default.

**Goal:** Plan and implement the first Play Mode / Roleplay Sandbox slice and Tavern-compatible Character Card import.

**Architecture:** Play uses one world referee with multiple character voice/state modules. Play transcript and play-local state live separately from novel truth files. Adoption back into Writing Mode uses PendingAction.

**Tech Stack:** TypeScript, `packages/core`, `packages/tools`, backend endpoints, Vue UI, PNG metadata parsing, YAML/Markdown Object File Tree.

---

## File Structure

- Inspect: `docs/IMPORT_TAVERN_COMPATIBLE_CHARACTER_CARD.md`
- Create: `docs/PLAY_MODE_SPEC.md`
- Create: `packages/core/src/play-session.ts`
- Create: `packages/core/src/tavern-card.ts`
- Modify: `packages/core/src/workspace.ts` if initializing play directories
- Create tests:
  - `__test__/core/src/tavern-card.test.ts`
  - `__test__/core/src/play-session.test.ts`
- Later create backend endpoints and Vue Play UI

---

### Task 1: Write Play Mode Spec

- [x] Define Writing Mode vs Play Mode.
- [x] Define play session lifecycle.
- [x] Define transcript, play-local state, activated sources, observations, adoption candidates.
- [x] Define single world referee + character modules.
- [x] Define adoption boundary: Play observation -> PendingAction.

### Task 2: Tavern-Compatible Parser

- [x] Support JSON card input.
- [x] Support PNG metadata extraction.
- [x] Normalize Tavern Card V1 / V2 / V3.
- [x] Extract `character_book` as imported lorebook.
- [x] Treat `system_prompt`, `post_history_instructions`, `character_book` as untrusted imported content.
- [x] Do not copy SillyTavern implementation code.

### Task 3: OAN Character Mapping

- [x] Map canonical facts to `characters/<id>/profile.md` or existing character card files.
- [x] Map interaction hints to `characters/<id>/interaction.md`.
- [x] Map lorebook to `characters/<id>/lorebook.yaml`.
- [x] Generate PendingAction only; do not write real character files before approval.

### Task 4: Play Context Activation

- [x] Activate sources by character, location, item, faction, hook id, scene goal and lorebook keys.
- [x] Record source id, path, trigger reason and budget.
- [x] Distinguish canonical facts, play-local facts and model improvisation.

### Task 5: Play Runtime Slice

- [x] Create play session.
- [x] Select user persona / POV.
- [x] Select scene start and characters.
- [x] Generate next turn using world referee prompt.
- [x] Store transcript under play session storage.

### Task 6: Adoption Flow

- [x] Generate Play observation log.
- [x] Let user select observations to adopt.
- [x] Route selected observations to chapter draft, state, timeline or foreshadow PendingAction.
- [x] Unselected variants remain session artifacts.

### Task 7: Tests And Safety

- [x] Malicious imported prompt does not override OAN constitution.
- [x] Large lorebook is bounded and previewed.
- [x] Imported content never auto-writes canonical truth.
- [x] Play adoption creates PendingAction.
