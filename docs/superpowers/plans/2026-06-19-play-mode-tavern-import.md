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

- [ ] Define Writing Mode vs Play Mode.
- [ ] Define play session lifecycle.
- [ ] Define transcript, play-local state, activated sources, observations, adoption candidates.
- [ ] Define single world referee + character modules.
- [ ] Define adoption boundary: Play observation -> PendingAction.

### Task 2: Tavern-Compatible Parser

- [ ] Support JSON card input.
- [ ] Support PNG metadata extraction.
- [ ] Normalize Tavern Card V1 / V2 / V3.
- [ ] Extract `character_book` as imported lorebook.
- [ ] Treat `system_prompt`, `post_history_instructions`, `character_book` as untrusted imported content.
- [ ] Do not copy SillyTavern implementation code.

### Task 3: OAN Character Mapping

- [ ] Map canonical facts to `characters/<id>/profile.md` or existing character card files.
- [ ] Map interaction hints to `characters/<id>/interaction.md`.
- [ ] Map lorebook to `characters/<id>/lorebook.yaml`.
- [ ] Generate PendingAction only; do not write real character files before approval.

### Task 4: Play Context Activation

- [ ] Activate sources by character, location, item, faction, hook id, scene goal and lorebook keys.
- [ ] Record source id, path, trigger reason and budget.
- [ ] Distinguish canonical facts, play-local facts and model improvisation.

### Task 5: Play Runtime Slice

- [ ] Create play session.
- [ ] Select user persona / POV.
- [ ] Select scene start and characters.
- [ ] Generate next turn using world referee prompt.
- [ ] Store transcript under play session storage.

### Task 6: Adoption Flow

- [ ] Generate Play observation log.
- [ ] Let user select observations to adopt.
- [ ] Route selected observations to chapter draft, state, timeline or foreshadow PendingAction.
- [ ] Unselected variants remain session artifacts.

### Task 7: Tests And Safety

- [ ] Malicious imported prompt does not override OAN constitution.
- [ ] Large lorebook is bounded and previewed.
- [ ] Imported content never auto-writes canonical truth.
- [ ] Play adoption creates PendingAction.

