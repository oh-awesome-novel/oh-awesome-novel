# Retire StoryForge Current Naming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure StoryForge remains only historical/reference terminology and is not reintroduced as a current product name, component name, runtime directory, or compatibility target.

**Architecture:** Current naming is `oh-awesome-novel`, OAN, `.oan/`, and Apply Engine. Stable docs may mention StoryForge only as historical inspiration or rejected early context. Implementation must not add StoryForge compatibility layers, `.storyforge` runtime handling, or “StoryForge Apply Engine” naming.

**Tech Stack:** Documentation hygiene, TypeScript code search, current `.oan/` workspace runtime directory.

---

## File Structure

- Inspect: `docs/README.md`
- Inspect: `docs/PROJECT_VISION.md`
- Inspect: `docs/adr/0001-filesystem-first.md`
- Inspect: implementation files under `packages/`, `apps/`, `__test__/`, and `examples/`

Do not modify `docs/ChatGPT对话.md`; it is historical source material.

---

### Task 1: Verify Stable Docs Naming

**Files:**

- Inspect: stable docs excluding `docs/ChatGPT对话.md`

- [ ] **Step 1: Search StoryForge mentions**

Run:

```bash
rg -n 'StoryForge|storyforge|StoryForge Apply|StoryForge FS|二开' docs --glob '!ChatGPT对话.md'
```

Expected:

- Mentions are only historical/reference context.
- No current component is called “StoryForge Apply Engine”.
- No current runtime directory is called `.storyforge`.

- [ ] **Step 2: Confirm current naming**

Expected stable names:

- `oh-awesome-novel`
- OAN
- `.oan/`
- Apply Engine
- SemanticPatch

---

### Task 2: Verify Implementation Does Not Add Compatibility

**Files:**

- Inspect: `packages/`
- Inspect: `apps/`
- Inspect: `__test__/`
- Inspect: `examples/`

- [ ] **Step 1: Search implementation for StoryForge names**

Run:

```bash
rg -n 'StoryForge|storyforge|\\.storyforge' packages apps __test__ examples
```

Expected:

```text
no matches
```

If matches exist, remove them unless they are explicitly part of a historical fixture selected by a future import task.

- [ ] **Step 2: Confirm no compatibility layer exists**

Implementation must not:

- detect both `.oan/` and `.storyforge/`.
- migrate `.storyforge/` at runtime.
- alias StoryForge component names to current OAN components.
- name Apply Engine classes/functions after StoryForge.

---

### Task 3: Diff Hygiene

**Files:**

- Any docs or implementation files touched by this cleanup.

- [ ] **Step 1: Run diff hygiene**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.
