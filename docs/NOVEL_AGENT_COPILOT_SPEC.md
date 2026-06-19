# Novel Agent Copilot Workflow Spec

Status: Draft Spec

Related vNext implementation spec:
`docs/OAN_AGENT_WRITING_GUIDE_IMPLEMENTATION_SPEC.md`

## Goal

Define the first complete Novel Agent Copilot workflow for `oh-awesome-novel`.
The Copilot must remain filesystem-first, human-approved, and implemented as a
single Aider-style tool loop rather than a heavy multi-agent platform.

This spec turns the current runtime pieces into a production workflow:

```text
User request or quick command
    -> load workspace context and active Novel Copilot skill
    -> stream model turn
    -> run read tools or write-intent tools
    -> show tool activity and PendingAction cards
    -> accept/reject writes through backend approval APIs
    -> refresh file viewer, workspace status, and git diff
```

## Current Implementation Audit

### Runtime

The core loop is mostly complete.

- `packages/runtime` implements the Aider-style loop:
  model response, tool calls, execute tools, append tool results, continue
  until no tool call or `maxToolLoops`.
- Runtime events are observable: message deltas, tool start/finish, pending
  actions, and final message.
- Tool errors are recoverable and returned to the model as tool results.
- Pending actions are collected from write-intent tool results without applying
  writes.

Remaining runtime concern:

- The runtime is generic and correct, but the production Novel Copilot skill
  and chapter lifecycle rules are not yet encoded as a stable default.

### Agent

`packages/agent` has the right foundation but only a thin novel prompt.

- It has `createNovelAgentSystemPrompt`, message assembly, AI SDK model bridge,
  runtime input assembly, and UI stream compatibility.
- `RuntimeSkill.system` can already be injected through the runtime context
  builder.
- Read tools and restricted write-intent tools can be assembled into a ToolSet.

Remaining pieces:

- The built-in `novel-copilot` skill exists, but vNext behavior must be kept
  aligned with `OAN_AGENT_WRITING_GUIDE_IMPLEMENTATION_SPEC.md`.
- Quick command metadata now carries capability ids, but UI discovery can still
  be improved later.
- Workspace snapshots are loaded in model mode, but context-package source
  discipline is a follow-up task.
- Chapter settlement exists as a skill contract, but observation log,
  settlement bundle, and session artifact materialization are follow-up tasks.
- The write tool set includes write-intent tools and must continue to keep all
  real writes behind PendingAction approval.

### Backend And Desktop

The backend and desktop are not yet wired as a production model-backed Copilot.

- The HTTP backend exposes `/api/agent/chat` and streams AI SDK UI messages.
- Provider config can be stored outside the novel workspace.
- Desktop starts the local backend and passes the backend URL to the renderer.
- Workspace status currently reports pending action count and git status.

Missing pieces:

- Desktop currently starts backend with a seed workspace root only; it does not
  resolve and pass an actual model provider by default.
- `createRuntimeEventStream` uses checkpoint mode unless `mode: "model"` and
  a provider resolver are explicitly supplied.
- Model mode passes only `{ workspaceRoot }` as the workspace snapshot.
- Model mode currently defaults to validation/checkpoint tools unless tools are
  injected, rather than the full Novel Copilot tool set.
- There are no backend endpoints for pending action list/accept/reject.

### Desktop UI

The UI has the first Copilot surface, but it is not yet the primary workspace.

- `WorkspaceShell.vue` has a workspace layout, file viewer, quick actions, and
  optional Copilot panel.
- `CopilotPanel.vue` streams chat, tool logs, and pending action cards.
- Pending action cards currently emit accept/reject events.

Missing pieces:

- Copilot is a right-side auxiliary panel instead of the central work area.
- The file content viewer is not yet a dedicated right-side inspector.
- PendingAction accept/reject is local UI state, not a backend approval call.
- UI code still needs a client/core abstraction so it does not know whether the
  transport is HTTP or Electron IPC.

## Novel Copilot Skill

The default skill id is `novel-copilot`.

The skill is a built-in default supplied by the app and may be overridden or
extended by a workspace file:

```text
.oan/skills/novel-copilot.md
```

When no workspace override exists, the built-in skill is used.

### Skill Contract

The skill must define:

- `name`: `novel-copilot`
- `displayName`: `Novel Copilot`
- `system`: the workflow and behavior instructions injected as skill context.
- `allowedTools`: read tools plus write-intent tools.
- `capabilities`: stable capability metadata used by prompts, session
  artifacts, and future UI surfaces.
- `quickCommands`: command contracts described below.

The app must treat the built-in and workspace skill as data loaded through
`packages/core`; `packages/agent` only receives the resolved `RuntimeSkill`.

### Required Workflow

Every Copilot turn follows these phases:

```text
observe -> plan -> draft/propose -> verify
```

`settle` is a conditional gate. It runs only when the user explicitly asks to
整理本章, adopt accepted chapter work, or apply review findings into canonical
state.

#### observe

Before making writing decisions, the Copilot must read the minimum relevant
filesystem context.

Always read:

- `.oan/workflow.yaml` through `workflow.get`
- `.oan/constitution/*` through `constitution.get`
- recent or requested summaries through `summary.get`
- current state through `state.get`
- timeline through `timeline.list`
- active foreshadow items through `foreshadow.list`

Conditionally read:

- character cards through `character.list` and `character.get` when a request
  mentions a character, scene cast, relationship, dialogue, or character state.
- world files through `world.search` when a request mentions setting, rules,
  factions, locations, power systems, creatures, or continuity facts.
- chapters through `chapter.get` when a request references a chapter, asks to
  continue, asks to review, or asks to settle a finished chapter.

#### plan

The Copilot must briefly explain what it will do and which files or domains it
expects to touch before calling write-intent tools.

The plan should be concise and user-facing. It must not include hidden chain of
thought or internal tool policy.

#### draft/propose

All file changes must be proposed as PendingActions.

Allowed write-intent tools:

- `chapter.createDraft` for chapter draft creation or replacement.
- `character.updatePersonality` for scoped character-card section updates.
- `state.set` for YAML state changes.
- `timeline.add` for timeline events.
- `foreshadow.create` for new active foreshadow items.
- `summary.generateChapter` for chapter summaries.

The Copilot must not claim that a file has been modified until the corresponding
PendingAction is accepted.

#### verify

Before finishing a turn, the Copilot checks whether its proposals are complete:

- requested output exists as assistant text or PendingAction.
- required context was read.
- proposed touched files match the user-facing plan.
- no direct write occurred.
- risky ambiguity is reported to the user.

#### settle

When a chapter draft is accepted or the user explicitly asks to "整理本章", the
Copilot must propose the chapter settlement bundle:

- chapter summary through `summary.generateChapter`.
- state updates for changed character state, relationship, location, items, or
  power level through `state.set`.
- timeline events for plot-changing beats through `timeline.add`.
- foreshadow creation or follow-up notes through `foreshadow.create`.

Settlement can be partial only when the Copilot states what could not be
determined from the available text.

`/审稿` is not a settlement trigger by default. It produces a report unless the
user explicitly asks for rewrite, settlement, state update, or applying review
findings.

### Writing Rules

The default skill uses lessons from the reference projects without copying their
architecture:

- From `awesome-novel-skill`: keep role boundaries clear, but collapse them into
  a single Copilot workflow instead of dispatching sub-agents.
- From StoryForge: use prompt workflows and user confirmation cards for writes.
- From Inkos: use a chapter lifecycle of draft, review, revise, and state
  settlement.

The Copilot must:

- preserve the user's established voice and constitution.
- read character cards before changing voice, motivation, relationship, or
  state.
- read recent summaries and the previous chapter before continuing a chapter.
- avoid inventing named characters or world rules without proposing updates.
- keep every write as an explicit PendingAction.
- after accepted chapter work, guide the user toward settlement if it has not
  been done.

## vNext Concepts

The skill contract uses these concepts as prompt and metadata contracts. Their
storage and UI materialization are split into later tasks.

- Capability id: stable id such as `novel.plan_chapter`,
  `novel.write_chapter`, `novel.review_chapter`, or `novel.settle_chapter`.
- Context package: explanation of selected and omitted sources for a writing,
  review, settlement, reference, or Play action. It is not a source of truth.
- Chapter contract: `/规划下一章` output used by `/写下一章`; it stays light for
  ordinary chapters and does not force volume-level structure.
- `PRE_WRITE_CHECK`: short calibration table before `/写下一章` calls
  `chapter.createDraft`.
- Review finding: structured report item with severity, category, location,
  evidence, issue, suggested fix, user-decision flag, and blocking flag.
- Observation log: evidence-only notes extracted from a completed chapter before
  settlement.
- Settlement bundle: proposed summary, state, timeline, foreshadow, character
  card updates, handoff, and unresolved ambiguity.
- Play and reference use: separate sandbox/reference modes; their outputs are
  non-canonical until adopted through PendingActions.

## Quick Command Contract

Quick commands are UI-visible command chips and slash commands. Each command has
a stable id, capability id, Chinese label, trigger prompt, required context,
allowed tools, and completion criteria.

### `/生成角色卡`

- id: `character.generateCard`
- capability id: `novel.generate_character_card`
- label: `生成角色卡`
- trigger: create or update a character card from user-provided traits or story
  context.
- required context:
  - `character.list`
  - relevant `character.get` when a similar character exists.
  - `world.search` when role depends on setting, faction, or power system.
- allowed tools:
  - read tools.
  - `character.updatePersonality` for updates.
  - future `character.createCard` when available.
- completion:
  - reports whether this is a new character or an update.
  - proposes a PendingAction when a write tool supports the target.
  - otherwise returns a structured character-card draft and states that the
    create-card write tool is still required.

### `/规划大纲`

- id: `outline.plan`
- capability id: `novel.plan_outline`
- label: `规划大纲`
- trigger: produce a project, arc, or current-story outline from the existing
  workflow and facts.
- required context:
  - `workflow.get`
  - `constitution.get`
  - recent `summary.get`
  - `state.get`
  - `timeline.list`
  - `foreshadow.list`
- allowed tools:
  - read tools only by default.
  - write-intent tools only when the user asks to persist the plan.
- completion:
  - returns an outline draft with assumptions and open questions.
  - does not canonicalize new facts unless the user asks to save them.

### `/规划下一卷`

- id: `volume.planNext`
- capability id: `novel.plan_volume`
- label: `规划下一卷`
- trigger: plan the next volume with heavier structure than ordinary
  single-chapter planning.
- required context:
  - `workflow.get`
  - `constitution.get`
  - existing outline or volume notes when available.
  - recent `summary.get`
  - `state.get`
  - `timeline.list`
  - `foreshadow.list`
- allowed tools:
  - read tools only by default.
  - write-intent tools only when the user asks to persist the volume plan.
- completion:
  - returns conflict ladder, information-gap changes, key beats, volume-level
    character arcs, foreshadow debt, payoff windows, and optional
    `CBN / CPNs / CEN`.
  - keeps those heavy fields at volume/key-chapter level rather than forcing
    them into ordinary chapter drafting.

### `/规划下一章`

- id: `chapter.planNext`
- capability id: `novel.plan_chapter`
- label: `规划下一章`
- trigger: produce the next chapter plan from current workflow, summaries, state,
  timeline, and foreshadow.
- required context:
  - `workflow.get`
  - `constitution.get`
  - recent `summary.get`
  - `state.get`
  - `timeline.list`
  - `foreshadow.list`
  - previous `chapter.get` when available.
- allowed tools:
  - read tools only by default.
  - write-intent tools only when the user asks to persist the plan.
- completion:
  - returns a light chapter contract: chapter id/title candidate, current task,
    POV, core conflict or scene direction, key cast and starting states, hooks
    to add/advance/mention/resolve/defer, ending change, and forbidden moves.

### `/写下一章`

- id: `chapter.writeNext`
- capability id: `novel.write_chapter`
- label: `写下一章`
- trigger: draft the next narrative chapter.
- required context:
  - all `/规划下一章` context.
  - `character.get` for planned cast.
  - `world.search` for setting and rules used in the chapter.
- allowed tools:
  - read tools.
  - `chapter.createDraft`.
  - optional settlement tools when the user also asks to finish/settle.
- completion:
  - outputs a short `PRE_WRITE_CHECK` before drafting.
  - creates a chapter draft PendingAction.
  - does not write the chapter file directly.
  - names follow-up settlement actions needed after acceptance.

### `/整理本章`

- id: `chapter.settle`
- capability id: `novel.settle_chapter`
- label: `整理本章`
- trigger: read a completed chapter and produce summary/state/timeline/foreshadow
  proposals.
- required context:
  - target `chapter.get`
  - `character.list`
  - relevant `character.get`
  - `state.get`
  - `timeline.list`
  - `foreshadow.list`
  - `summary.get` for neighboring summaries.
- allowed tools:
  - `summary.generateChapter`
  - `state.set`
  - `timeline.add`
  - `foreshadow.create`
- completion:
  - returns an evidence-only observation log before settlement.
  - returns a settlement bundle.
  - creates one or more PendingActions.
  - clearly marks any unresolved ambiguity.

### `/审稿`

- id: `chapter.review`
- capability id: `novel.review_chapter`
- label: `审稿`
- trigger: review a chapter for continuity, character behavior, pacing, hooks,
  and AI-like prose.
- required context:
  - target `chapter.get`
  - `constitution.get`
  - relevant `character.get`
  - `state.get`
  - `foreshadow.list`
  - recent `summary.get`
- allowed tools:
  - read tools.
  - `chapter.createDraft` only when the user asks for a revised draft.
- completion:
  - returns review findings grouped by severity and dimension pass results.
  - does not rewrite, settle, or update state unless requested.
  - proposed rewrites or settlement actions are PendingActions only after the
    user explicitly asks for them.

### `/更新状态`

- id: `state.update`
- capability id: `novel.update_state`
- label: `更新状态`
- trigger: update state from user notes, selected text, or a chapter.
- required context:
  - `state.get`
  - relevant `character.get`
  - target `chapter.get` when chapter-derived.
- allowed tools:
  - `state.set`
  - `timeline.add` when the update is plot-significant.
- completion:
  - proposes state PendingActions.
  - summarizes old value, new value, and source evidence.

### `/补伏笔`

- id: `foreshadow.plan`
- capability id: `novel.plan_foreshadow`
- label: `补伏笔`
- trigger: propose new hooks or strengthen existing ones.
- required context:
  - `foreshadow.list`
  - recent `summary.get`
  - `timeline.list`
  - relevant `chapter.get`
  - relevant `character.get`
- allowed tools:
  - `foreshadow.create`
  - `chapter.createDraft` when user asks to insert prose.
- completion:
  - recommends hook seed, expected payoff, risk, and target chapter range.
  - creates PendingActions only when user asks to persist.

### `/去AI味`

- id: `chapter.deAi`
- capability id: `novel.de_ai`
- label: `去AI味`
- trigger: revise selected prose or a chapter to reduce generic AI phrasing.
- required context:
  - selected text or target `chapter.get`
  - `constitution.get`
  - relevant style or writing constitution when present.
- allowed tools:
  - read tools.
  - `chapter.createDraft` for replacement proposals.
- completion:
  - preserves plot facts.
  - returns a PendingAction for replacement text.
  - explains the categories of edits without over-reporting line-by-line.

## Agent Loop Completion Criteria

The Novel Copilot loop is complete when all criteria below are true.

### Model Execution

- Desktop starts backend with a real provider resolver when provider config is
  available.
- `/api/agent/chat` can run `mode: "model"` without test-only injection.
- If no provider is configured, the UI displays a provider gate instead of
  silently falling back to checkpoint output.

### Context Loading

- Backend loads a workspace snapshot before each agent turn.
- Snapshot includes workflow, constitution, recent summaries, state, timeline,
  foreshadow, selected context, and resolved skill.
- Agent receives that snapshot through existing `streamNovelAgentTurn` inputs.

### Tool Activity

- Tool calls stream to the UI as visible tool activity.
- Unknown tool and failed tool results are shown as recoverable errors.
- Tool allow-list respects `RuntimeSkill.allowedTools`.

### PendingAction Approval

- Write-intent tools create PendingActions with diff previews.
- UI shows PendingAction cards from streamed data and from workspace status.
- Accept/reject calls backend APIs and does not mutate only local UI state.
- Accept writes the real files through `packages/tools` approval functions.
- Reject archives the action as rejected.
- After accept, UI refreshes file content, pending action count, and git status.

### Git Diff Visibility

- Accepted writes expose git diff or dirty status.
- The user can inspect the changed file in the right-side viewer.
- Future quick commit support must use the Human Approval and Git workflow.

## Backend And Client Interface Spec

### Backend Routes

Add these transport routes to the local backend:

```text
GET  /api/workspace/pending-actions
POST /api/workspace/pending-actions/:id/accept
POST /api/workspace/pending-actions/:id/reject
```

Responses:

```ts
interface PendingActionsResponse {
  pendingActions: WriteIntentPendingAction[];
}

interface AcceptPendingActionResponse {
  id: string;
  status: 'accepted';
  appliedFiles: string[];
  gitDiff: string;
}

interface RejectPendingActionResponse {
  id: string;
  status: 'rejected';
}
```

The backend must resolve the active workspace root internally and must not
accept arbitrary workspace roots from the renderer for these operations.

### Client Boundary

The UI layer must call client/core APIs rather than raw transport details.

Recommended client surface:

```ts
interface NovelCopilotClient {
  streamChat(input: CopilotChatInput): AsyncIterable<AgentUiEvent>;
  listPendingActions(): Promise<PendingActionsResponse>;
  acceptPendingAction(id: string): Promise<AcceptPendingActionResponse>;
  rejectPendingAction(id: string): Promise<RejectPendingActionResponse>;
  getWorkspaceSnapshot(): Promise<WorkspaceSnapshotSummary>;
}
```

The implementation may use HTTP in the web renderer and Electron IPC in desktop
later; Vue components must not depend on that distinction.

## Writing Tool Spec

### `chapter.createDraft`

Purpose: create a PendingAction for a narrative chapter draft or replacement.

Input:

```ts
interface ChapterCreateDraftInput {
  chapterId: string;       // 0001/0001
  title?: string;
  content: string;
  file?: string;           // optional override under chapters/
  mode?: 'create' | 'replace';
}
```

Rules:

- `chapterId` must be a narrative chapter id; `0000` is reserved for volume
  metadata.
- Target file must stay under `chapters/`.
- Hidden paths and `.workspace` targets are rejected.
- The tool writes only shadow drafts and returns PendingActions.
- Accepting the PendingAction materializes the chapter file.

Output patch:

```ts
interface ChapterDraftPatch {
  kind: 'narrative';
  domain: 'chapter';
  file: string;
  operation: 'replaceFile';
  selector: { chapterId: string };
  value: string;
}
```

## Desktop UI Spec

The workspace UI becomes Copilot-centered.

```text
┌──────────────┬──────────────────────────────┬──────────────────────────────┐
│ left nav     │ center: Agent Copilot        │ right: File / Diff Viewer    │
│              │                              │                              │
│ workspace    │ quick commands               │ selected file content        │
│ files        │ chat transcript              │ pending action diff          │
│ chapters     │ tool activity                │ context inspector            │
│ status       │ pending action cards         │ chapter/summary preview      │
└──────────────┴──────────────────────────────┴──────────────────────────────┘
```

### Left Navigation

- Workspace tree.
- Chapter navigation.
- Workspace status.
- Settings entry.

### Center Copilot

- Primary work area.
- Quick command chips at the top.
- Chat input stays visible.
- Tool activity is visible inline or in a compact timeline.
- PendingAction cards support accept/reject through client APIs.

### Right Viewer

- Shows selected workspace file content.
- Shows PendingAction diff when a pending card is selected.
- Shows selected context used by the Copilot when available.
- Refreshes after PendingAction accept/reject.

### Empty And Error States

- No provider configured: show provider setup callout in center Copilot.
- No workspace selected: show launcher flow.
- Tool failure: show recoverable tool error in transcript and activity list.
- PendingAction accept failure: keep card pending and display the backend error.

## Acceptance Tests

### `/整理本章`

Given a workspace with a chapter, character card, state, timeline, and foreshadow:

- command reads the target chapter.
- command reads relevant character/state/timeline/foreshadow context.
- command creates a chapter summary PendingAction.
- command creates state/timeline/foreshadow PendingActions when changes are
  detected.
- UI displays those PendingActions.

### `/生成角色卡`

Given user input describing a character:

- command first calls `character.list`.
- if a similar id exists, command calls `character.get`.
- command reports create vs update.
- update path creates a character PendingAction.
- create path either uses future `character.createCard` or returns a structured
  draft with a tool-gap note.

### `/写下一章`

Given a configured provider and a workspace with previous chapter context:

- command reads workflow, constitution, recent summary, state, timeline,
  foreshadow, previous chapter, and planned cast.
- command creates a `chapter.createDraft` PendingAction.
- no real chapter file is written before accept.
- accept writes the chapter file and refreshes the right viewer.

### PendingAction Approval

Given a streamed PendingAction:

- card accept calls backend accept route.
- card reject calls backend reject route.
- UI does not mark the action accepted/rejected until backend returns success.
- after accept, status pending count decreases.
- after accept, git status is dirty or git diff contains the applied change.

### UI Layout

Given an opened workspace:

- Copilot appears in the center region.
- selected file content appears in the right region.
- quick commands are available without opening a side panel.
- tool activity and PendingAction cards are visible during a streamed turn.

## Implementation Notes

- Do not introduce LangChain, AutoGen, CrewAI, Semantic Kernel, or an equivalent
  heavy agent framework.
- Keep `packages/runtime` provider-agnostic and domain-agnostic.
- Keep `packages/agent` responsible for prompt assembly, skill injection, model
  adapter, and runtime wiring.
- Keep `packages/core` responsible for pure config, workspace, skill/workflow
  loading, and data contracts.
- Keep Vue components transport-agnostic by going through a client abstraction.
- All production writes must use PendingAction approval before materialization.
