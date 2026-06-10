# Chapter Navigation View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated read-only chapter navigation view so authors can browse readable volume and chapter titles even though files use stable numeric paths like `chapters/0001/0001.md`.

**Architecture:** Chapter navigation is a derived filesystem view, not a database. The backend scans `chapters/`, recognizes `0000.md` as volume metadata only, extracts readable titles from frontmatter/headings, and returns a structured index to the Vue workspace UI. The UI uses this index to open the existing plain-text file viewer.

**Tech Stack:** TypeScript, Node.js filesystem helpers, existing Markdown/frontmatter parser, HTTP backend, Vue renderer, Vitest tests under `__test__/tools` and the relevant app test workspace if available.

**Related Plan:** `docs/superpowers/plans/2026-06-10-chapter-index-file-git-hash.md` extends this view with persisted `.oan/indexes/chapters.yaml` generation and Git HEAD freshness checks.

---

## File Structure

- Modify or add: `packages/tools/src/chapter-index.ts`
  - Build a read-only chapter index from `chapters/`.
  - Keep `0000.md` as volume metadata, not a chapter item.
- Modify: `packages/tools/src/index.ts`
  - Export the chapter index helper or tool.
- Modify or add backend route in the app package that owns workspace HTTP endpoints.
  - Add `GET /api/workspace/chapters` or equivalent existing route shape.
- Modify Vue workspace shell files under `apps/`.
  - Add `ChapterNavigationView.vue`.
  - Add a toolbar or sidebar entry.
  - Add a workspace home quick action.
- Test: `__test__/tools/src/chapter-index.test.ts`
  - Cover ordering, title extraction, `0000.md` exclusion, and path safety.
- Test app/backend route where existing frontend/backend tests live.

Do not modify code until this plan is selected for implementation. Do not add compatibility for old chapter path formats.

---

### Task 1: Add Chapter Index Domain Model

**Files:**

- Modify or add: `packages/tools/src/chapter-index.ts`
- Modify: `packages/tools/src/index.ts`

- [ ] **Step 1: Define index result types**

Create types shaped like:

```ts
export interface ChapterIndex {
  volumes: ChapterIndexVolume[];
}

export interface ChapterIndexVolume {
  id: string;
  path: string;
  title: string;
  metadataPath: string;
  chapters: ChapterIndexChapter[];
}

export interface ChapterIndexChapter {
  id: string;
  path: string;
  title: string;
  volumeId: string;
  chapterNumber: string;
}
```

- [ ] **Step 2: Implement stable path scanning**

Scan only:

```text
chapters/<4-digit-volume>/<4-digit-chapter>.md
```

Rules:

- Accept volume directories matching `/^\d{4}$/`.
- Treat `0000.md` as `metadataPath` only.
- Accept narrative chapters matching `/^[0-9]{4}\.md$/` where basename is not `0000`.
- Sort volumes and chapters numerically by stable ids.
- Reject or ignore hidden paths and paths outside the active workspace.

- [ ] **Step 3: Extract readable titles**

Use the existing Markdown/frontmatter parser where possible.

Title priority:

1. frontmatter `title`
2. first level-one heading
3. fallback `${volumeId}/${chapterNumber} 未命名章节`

For volume title fallback, use `${volumeId} 未命名卷`.

- [ ] **Step 4: Export helper**

Export the helper from `packages/tools/src/index.ts`.

---

### Task 2: Add Tool Tests

**Files:**

- Add: `__test__/tools/src/chapter-index.test.ts`

- [ ] **Step 1: Build fixture workspace**

Create a temp workspace containing:

```text
chapters/
  0001/
    0000.md
    0001.md
    0002.md
  0002/
    0000.md
    0001.md
```

Use frontmatter or headings with distinct titles so tests prove the UI is not relying on filename display.

- [ ] **Step 2: Assert index shape**

Expected:

- Two volumes.
- `0001/0000` is not present in `chapters`.
- `0001/0001`, `0001/0002`, and `0002/0001` are present.
- Paths are workspace-relative.
- Titles come from frontmatter/headings.

- [ ] **Step 3: Assert ordering**

Create files out of order and assert returned volumes/chapters are numerically sorted.

- [ ] **Step 4: Run tools tests**

Run:

```bash
npm run test:run --workspace @oh-awesome-novel/test-tools
```

Expected: all tools tests pass.

---

### Task 3: Expose Backend Read Endpoint

**Files:**

- Modify backend HTTP route files under `apps/`.
- Test backend route where existing tests live, if present.

- [ ] **Step 1: Locate existing workspace read endpoints**

Find the route that opens files or returns workspace state.

- [ ] **Step 2: Add chapter index endpoint**

Add a read-only endpoint:

```text
GET /api/workspace/chapters
```

or the closest existing route convention.

The endpoint must:

- Require an active workspace root.
- Call the chapter index helper.
- Return structured JSON.
- Never accept arbitrary absolute paths from the frontend.
- Never write files.

- [ ] **Step 3: Add route tests if backend route tests exist**

Cover:

- Happy path.
- Empty `chapters/`.
- Workspace path safety.

---

### Task 4: Add Vue Chapter Navigation View

**Files:**

- Add: `ChapterNavigationView.vue` near the workspace UI components.
- Add composable if local patterns use composables, for example `useChapterIndex.ts`.
- Modify workspace shell component.
- Modify workspace home component.

- [ ] **Step 1: Add view component**

Render:

- Volume groups.
- Volume title and id.
- Chapter title.
- Chapter id.
- Relative path.
- Empty state.
- Loading and error states.

- [ ] **Step 2: Wire chapter click**

When a chapter is clicked:

- Set active file path to `chapters/<volume>/<chapter>.md`.
- Open the existing center plain-text viewer.
- Highlight the current chapter row.
- Keep Copilot closed unless the user explicitly opens it.

- [ ] **Step 3: Add entry points**

Add:

- Toolbar/sidebar button for Chapter Navigation.
- Workspace home quick action.

If the left sidebar supports tabs, add a `Files | Chapters` segmented control.

---

### Task 5: Verify UX And Constraints

**Files:**

- Relevant Vue workspace shell and backend files.

- [ ] **Step 1: Run relevant tests**

Run:

```bash
npm run test:run --workspace @oh-awesome-novel/test-tools
```

Run app/frontend tests if the repository has a matching workspace.

- [ ] **Step 2: Manual app verification**

Start the local app using the repository's normal dev command and verify:

- Chapter navigation opens.
- `0000.md` is not displayed as a chapter.
- Repeated filenames are distinguishable by title and id.
- Clicking a chapter opens the plain-text viewer.
- File tree selection follows or can locate the same file.
- No write request is triggered.

- [ ] **Step 3: Run diff hygiene**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.
