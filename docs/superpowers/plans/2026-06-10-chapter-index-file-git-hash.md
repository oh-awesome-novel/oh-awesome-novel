# Chapter Index File Git Hash Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a chapter scan, generate `.oan/indexes/chapters.yaml` with the Git HEAD hash used during the scan. When opening the chapter navigation view later, compare the saved hash with the current Git HEAD and prompt the user to rescan if they differ.

**Architecture:** The chapter index file is a derived cache stored inside `.oan/indexes/`, not a source of truth. `chapters/` remains canonical. The backend owns scanning, Git hash lookup, index read/write, validation, and stale-state reporting. The frontend only displays index state and triggers explicit rescan actions.

**Tech Stack:** TypeScript, Node.js fs/path helpers, existing Markdown/frontmatter parser, Git command integration or existing Git helper, YAML serializer, HTTP backend, Vue renderer, Vitest tests under `__test__/tools` and backend/app tests where available.

---

## File Structure

- Modify or add: `packages/tools/src/chapter-index.ts`
  - Generate the chapter index data.
  - Read/write `.oan/indexes/chapters.yaml`.
  - Validate stored Git hash against current Git HEAD.
- Modify or add Git helper module if needed.
  - Read current `HEAD` hash.
  - Detect dirty state if an existing helper already supports it.
- Modify backend workspace route under `apps/`.
  - Add explicit rescan endpoint.
  - Return index freshness state.
- Modify Vue chapter navigation UI.
  - Show current / stale / unknown / dirty index status.
  - Provide rescan button.
- Test: `__test__/tools/src/chapter-index-file.test.ts`
  - Cover file generation, hash mismatch, missing Git, dirty state, and path safety.

Do not treat `.oan/indexes/chapters.yaml` as a novel fact source. Do not let the frontend write it directly.

---

### Task 1: Define Index File Schema

**Files:**

- Modify or add: `packages/tools/src/chapter-index.ts`

- [ ] **Step 1: Add persisted schema types**

Define a persisted shape like:

```ts
export interface PersistedChapterIndex {
  kind: 'chapter-index';
  version: 1;
  generatedAt: string;
  git: {
    head: string | null;
    dirty: boolean;
  };
  source: {
    root: 'chapters';
  };
  volumes: ChapterIndexVolume[];
}
```

- [ ] **Step 2: Use workspace-relative paths only**

The index file must store paths like:

```text
chapters/0001/0001.md
```

Never store absolute local machine paths in `.oan/indexes/chapters.yaml`.

- [ ] **Step 3: Keep `0000.md` as metadata only**

Persist `metadataPath` for each volume, but never include `0000.md` as a chapter item.

---

### Task 2: Generate `.oan/indexes/chapters.yaml`

**Files:**

- Modify or add: `packages/tools/src/chapter-index.ts`
- Test: `__test__/tools/src/chapter-index-file.test.ts`

- [ ] **Step 1: Add writer helper**

Add a helper like:

```ts
export async function writeChapterIndexFile(options: {
  workspaceRoot: string;
}): Promise<PersistedChapterIndex>
```

It should:

- Build the chapter index from `chapters/`.
- Read current Git HEAD if available.
- Detect dirty state if existing Git helpers support it.
- Create `.oan/indexes/` if missing.
- Write YAML to `.oan/indexes/chapters.yaml`.
- Return the same persisted object.

- [ ] **Step 2: Add generation tests**

Test that:

- The file is created at `.oan/indexes/chapters.yaml`.
- It includes `kind: chapter-index`.
- It includes `version: 1`.
- It includes `git.head`.
- It includes chapter titles and workspace-relative paths.
- It excludes `0000.md` from chapters.

---

### Task 3: Validate Index Freshness

**Files:**

- Modify or add: `packages/tools/src/chapter-index.ts`
- Test: `__test__/tools/src/chapter-index-file.test.ts`

- [ ] **Step 1: Add read and validate helper**

Add a helper like:

```ts
export async function readChapterIndexStatus(options: {
  workspaceRoot: string;
}): Promise<{
  index: PersistedChapterIndex | null;
  status: 'missing' | 'current' | 'stale' | 'unknown' | 'dirty';
  currentGitHead: string | null;
}>
```

Rules:

- Missing file -> `missing`.
- Current Git HEAD equals `index.git.head` and workspace clean -> `current`.
- Current Git HEAD differs from `index.git.head` -> `stale`.
- Git HEAD cannot be read -> `unknown`.
- Workspace is dirty -> `dirty` or `current` plus an explicit dirty flag, depending on existing UI state patterns.

- [ ] **Step 2: Add validation tests**

Cover:

- Matching hash.
- Mismatched hash.
- Missing index file.
- Missing Git repository or unreadable HEAD.
- Dirty workspace if Git helper supports it.

---

### Task 4: Expose Backend Scan And Status Endpoints

**Files:**

- Modify backend workspace route files under `apps/`.
- Test backend routes where existing tests live.

- [ ] **Step 1: Add status endpoint**

Extend the chapter endpoint or add:

```text
GET /api/workspace/chapters/index-status
```

It should return:

- `status`
- `currentGitHead`
- persisted index if available
- dirty flag if available

- [ ] **Step 2: Add explicit rescan endpoint**

Add:

```text
POST /api/workspace/chapters/rescan
```

This endpoint performs a read scan and writes the derived index file.

Requirements:

- It must require an active workspace.
- It must not accept arbitrary paths from the frontend.
- It must write only `.oan/indexes/chapters.yaml`.
- It must not modify `chapters/`.
- It must not trigger Copilot or PendingAction.

- [ ] **Step 3: Add backend tests**

Cover:

- Rescan writes index file.
- Status returns `current` after rescan.
- Status returns `stale` after Git HEAD changes.
- Endpoint rejects missing workspace.

---

### Task 5: Add UI Stale-State Handling

**Files:**

- Modify Vue chapter navigation UI files under `apps/`.

- [ ] **Step 1: Display index state**

Show one of:

- Current index.
- Missing index.
- Stale index, needs rescan.
- Unknown Git state.
- Dirty workspace warning.

- [ ] **Step 2: Add rescan action**

The rescan button should:

- Call the backend rescan endpoint.
- Refresh the displayed chapter index.
- Refresh the status badge.
- Not open Copilot.
- Not create PendingAction.

- [ ] **Step 3: Keep old index visible but marked stale**

If an index exists but is stale, the UI may still display it as last scan result, but it must be visually marked as stale and must show a rescan action.

---

### Task 6: Verify

**Files:**

- Relevant tools, backend, and Vue files.

- [ ] **Step 1: Run tools tests**

Run:

```bash
npm run test:run --workspace @oh-awesome-novel/test-tools
```

- [ ] **Step 2: Run app tests**

Run the relevant app/backend/frontend test command if this repository has one.

- [ ] **Step 3: Manual verification**

Verify:

- Scanning writes `.oan/indexes/chapters.yaml`.
- The file contains current Git HEAD.
- Changing Git HEAD makes the UI show stale index.
- Dirty workspace state is visible.
- Rescan refreshes the index and status.

- [ ] **Step 4: Diff hygiene**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.
