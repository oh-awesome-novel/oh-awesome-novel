# Stable Numbered Chapter Paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce stable numbered novel body paths everywhere: `chapters/0001/0001.md`, `summaries/chapter/0001/0001.md`, `summaries/volume/0001.md`, and chapter ids like `0001/0001`.

**Architecture:** Volume directories and chapter files are stable 4-digit numeric identifiers. `0000.md` is a special volume metadata file inside each volume directory, not a narrative chapter and not a valid target for `chapter.get`, chapter summaries, or NarrativePatch chapter edits.

**Tech Stack:** TypeScript, Node.js path helpers, existing `packages/core` workspace path utilities, `packages/tools` read/write tools, Vitest tests under `__test__/core` and `__test__/tools`.

---

## File Structure

- Modify: `packages/core/src/workspace.ts`
  - Keep stable format helpers.
  - Add explicit helpers for volume metadata path vs narrative chapter path if needed.
- Modify: `packages/core/src/index.ts`
  - Export any new path helpers.
- Modify: `packages/tools/src/read-tools.ts`
  - Reject `chapter.get` ids whose chapter component is `0000`.
  - Keep reading `chapters/<volume>/<chapter>.md` for narrative chapters.
- Modify: `packages/tools/src/write-intent-tools.ts`
  - Reject `summary.generateChapter` chapter ids ending in `/0000`.
  - Ensure default summary path is `summaries/chapter/<volume>/<chapter>.md`.
- Modify: `__test__/core/src/workspace.test.ts`
  - Cover volume metadata path and narrative chapter path separately.
- Modify: `__test__/tools/src/read-tools.test.ts`
  - Cover `chapter.get` accepts `0001/0001` and rejects `0001/0000`.
- Modify: `__test__/tools/src/write-intent-tools.test.ts`
  - Cover `summary.generateChapter` rejects `0001/0000`.
- Inspect: `examples/sample-novel/`
  - Verify sample paths already use stable numbering.

Do not add compatibility for `volume-01/001.md` or flat `chapters/012.md`. The project is still early; old path formats are stale documentation, not supported input formats.

---

### Task 1: Verify Core Numbering Helpers

**Files:**

- Modify if needed: `packages/core/src/workspace.ts`
- Modify if needed: `packages/core/src/index.ts`
- Test: `__test__/core/src/workspace.test.ts`

- [ ] **Step 1: Confirm existing formatting helpers**

Inspect `packages/core/src/workspace.ts`.

Expected current behavior:

```ts
formatVolumeDirectoryName(1) === '0001'
formatChapterFileName(0) === '0000.md'
formatChapterFileName(12) === '0012.md'
resolveChapterFilePath('/novel', 2, 1).relativePath === 'chapters/0002/0001.md'
```

- [ ] **Step 2: Add semantic helper names if the code is ambiguous**

If implementation needs clearer names, add:

```ts
export function resolveVolumeMetadataFilePath(
  rootDir: string,
  volumeNumber: number,
): ChapterPathParts {
  return resolveChapterFilePath(rootDir, volumeNumber, 0);
}

export function resolveNarrativeChapterFilePath(
  rootDir: string,
  volumeNumber: number,
  chapterNumber: number,
): ChapterPathParts {
  if (chapterNumber === 0) {
    throw new Error('chapterNumber 0 is reserved for volume metadata.');
  }

  return resolveChapterFilePath(rootDir, volumeNumber, chapterNumber);
}
```

- [ ] **Step 3: Export new helpers**

If Task 1 Step 2 added helpers, export them from `packages/core/src/index.ts`:

```ts
export {
  resolveNarrativeChapterFilePath,
  resolveVolumeMetadataFilePath,
} from './workspace.js';
```

- [ ] **Step 4: Add core tests**

Add to `__test__/core/src/workspace.test.ts`:

```ts
  it('separates volume metadata paths from narrative chapter paths', () => {
    expect(resolveVolumeMetadataFilePath('/novel', 1).relativePath).toBe(
      'chapters/0001/0000.md',
    );
    expect(resolveNarrativeChapterFilePath('/novel', 1, 1).relativePath).toBe(
      'chapters/0001/0001.md',
    );
    expect(() => resolveNarrativeChapterFilePath('/novel', 1, 0)).toThrow(
      'reserved for volume metadata',
    );
  });
```

- [ ] **Step 5: Run core tests**

Run:

```bash
npm run test:run --workspace @oh-awesome-novel/test-core
```

Expected:

```text
Test Files  2 passed
```

---

### Task 2: Reject `0000` In `chapter.get`

**Files:**

- Modify: `packages/tools/src/read-tools.ts`
- Test: `__test__/tools/src/read-tools.test.ts`

- [ ] **Step 1: Add chapter id validator**

In `packages/tools/src/read-tools.ts`, add:

```ts
function safeNarrativeChapterId(value: string): string {
  const normalized = safeRelativePath(value);
  const parts = normalized.split('/');

  if (parts.length !== 2 || !/^\d{4}$/.test(parts[0]) || !/^\d{4}$/.test(parts[1])) {
    throw new Error(`Invalid chapter id: ${value}`);
  }

  if (parts[1] === '0000') {
    throw new Error('Chapter id 0000 is reserved for volume metadata.');
  }

  return normalized;
}
```

- [ ] **Step 2: Use validator in chapter tool**

Modify `chapterGetTool`:

```ts
const id = safeNarrativeChapterId(expectStringArg(args, 'id'));
const filePath = resolveWorkspacePath(
  options.workspaceRoot,
  'chapters',
  `${id}.md`,
);
```

- [ ] **Step 3: Add read tool regression test**

Add to `__test__/tools/src/read-tools.test.ts`:

```ts
  it('rejects volume metadata as a chapter.get target', async () => {
    const tools = createReadTools({ workspaceRoot });

    await expect(
      executeTool(tools, 'chapter.get', { id: '0001/0000' }),
    ).rejects.toThrow(/reserved for volume metadata/);
  });
```

- [ ] **Step 4: Run tools tests**

Run:

```bash
npm run test:run --workspace @oh-awesome-novel/test-tools -- src/read-tools.test.ts
```

Expected:

```text
Test Files  1 passed
```

---

### Task 3: Reject `0000` In Chapter Summary Generation

**Files:**

- Modify: `packages/tools/src/write-intent-tools.ts`
- Test: `__test__/tools/src/write-intent-tools.test.ts`

- [ ] **Step 1: Add chapter summary id validator**

In `packages/tools/src/write-intent-tools.ts`, add:

```ts
function safeNarrativeChapterId(value: string): string {
  const normalized = safeRelativePath(value);
  const parts = normalized.split(sep);

  if (parts.length !== 2 || !/^\d{4}$/.test(parts[0]) || !/^\d{4}$/.test(parts[1])) {
    throw new Error(`Invalid chapter id: ${value}`);
  }

  if (parts[1] === '0000') {
    throw new Error('Chapter id 0000 is reserved for volume metadata.');
  }

  return normalized;
}
```

- [ ] **Step 2: Use validator in summary generation**

Modify `summaryGenerateChapterTool`:

```ts
const chapterId = safeNarrativeChapterId(expectStringArg(args, 'chapterId'));
const content = normalizeMarkdownFile(expectStringArg(args, 'content'));
const file = getOptionalStringArg(args, 'file') ?? `chapter/${chapterId}.md`;
```

- [ ] **Step 3: Add write-intent regression test**

Add to `__test__/tools/src/write-intent-tools.test.ts`:

```ts
  it('rejects generating a chapter summary for volume metadata 0000', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    const tools = createWriteIntentTools({ workspaceRoot });

    await expect(
      executeTool(tools, 'summary.generateChapter', {
        chapterId: '0001/0000',
        content: 'not a chapter',
      }),
    ).rejects.toThrow(/reserved for volume metadata/);
  });
```

- [ ] **Step 4: Run write-intent tests**

Run:

```bash
npm run test:run --workspace @oh-awesome-novel/test-tools -- src/write-intent-tools.test.ts
```

Expected:

```text
Test Files  1 passed
```

---

### Task 4: Verify Sample Workspace Paths

**Files:**

- Inspect: `examples/sample-novel/`

- [ ] **Step 1: List sample chapter and summary files**

Run:

```bash
find examples/sample-novel/chapters examples/sample-novel/summaries -type f | sort
```

Expected includes:

```text
examples/sample-novel/chapters/0001/0000.md
examples/sample-novel/chapters/0001/0001.md
examples/sample-novel/chapters/0001/0002.md
examples/sample-novel/summaries/chapter/0001/0001.md
examples/sample-novel/summaries/volume/0001.md
```

Expected excludes:

```text
examples/sample-novel/chapters/volume-01/001.md
examples/sample-novel/summaries/chapter/volume-01/001.md
examples/sample-novel/summaries/volume/volume-01.md
```

- [ ] **Step 2: Search for stale path formats**

Run:

```bash
rg -n 'volume-01|volume-02|chapters/[0-9]{3}\.md|summaries/chapter/[0-9]{3}\.md' examples packages apps __test__
```

Expected:

```text
no matches
```

---

### Task 5: Final Verification

**Files:**

- Inspect: `docs/FILESYSTEM_SPEC.md`
- Inspect: `docs/APPLY_ENGINE.md`
- Inspect: `docs/tasks/0100.md`
- Inspect: implementation files from tasks above

- [ ] **Step 1: Search docs and implementation for stale path formats**

Run:

```bash
rg -n 'volume-01|volume-02|chapters/[0-9]{3}\.md|summaries/chapter/[0-9]{3}\.md|summaries/chapter/volume|summaries/volume/volume' docs packages apps __test__ examples
```

Expected:

```text
no matches outside docs/ChatGPT对话.md if that file is included in a broader search
```

- [ ] **Step 2: Run affected tests**

Run:

```bash
npm run test:run --workspace @oh-awesome-novel/test-core
npm run test:run --workspace @oh-awesome-novel/test-tools
```

Expected:

```text
all tests pass
```

- [ ] **Step 3: Run affected builds**

Run:

```bash
npm run build --workspace @oh-awesome-novel/core
npm run build --workspace @oh-awesome-novel/tools
```

Expected:

```text
Build complete
```

- [ ] **Step 4: Check diff hygiene**

Run:

```bash
git diff --check
```

Expected:

```text
no output
```

---

## Self-Review

- Spec coverage: Covers stable volume directory numbers, stable chapter filenames, `0000.md` as volume metadata, narrative chapter id validation, summary path validation, stale path rejection, and sample workspace verification.
- Placeholder scan: No TBD/TODO placeholders remain.
- Type consistency: Uses existing helpers `formatVolumeDirectoryName`, `formatChapterFileName`, and `resolveChapterFilePath`; optional new helpers are named consistently.
- Scope check: This plan does not implement UI navigation, global search, Git history, or NarrativePatch scene editing.
