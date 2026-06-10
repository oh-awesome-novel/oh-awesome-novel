# Align Monorepo Source Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep all future implementation work aligned to the current monorepo layout (`packages/*`, `apps/*`, `__test__/*`) and prevent new code from being added under the obsolete single-package `src/` layout.

**Architecture:** Core domain/runtime/backend functionality lives in focused packages. Desktop composition and Vue renderer live in `apps/`. Tests live in root `__test__/<module>` workspaces and import public package entrypoints where possible.

**Tech Stack:** npm workspaces, TypeScript, Vite/Vue renderer, Electron main app, Vitest module test workspaces.

---

## File Structure

- Inspect: root workspace configuration (`package.json`, workspace config files if present).
- Inspect: `packages/core`
  - Workspace initialization and config pure functions.
- Inspect: `packages/tools`
  - Markdown/YAML engines, AI SDK ToolSet factories, read/write-intent tools.
- Inspect: `packages/runtime`
  - Aider-style runtime loop.
- Inspect: `packages/agent`
  - Prompt assembly, provider adapter composition, ToolSet injection.
- Inspect: `packages/backend`
  - Local HTTP/SSE transport.
- Inspect: `apps/desktop`
  - Electron main process.
- Inspect: `apps/desktop-ui`
  - Vue renderer.
- Inspect: `__test__/*`
  - Module-scoped test workspaces.

Do not create new implementation files under a root `src/` directory.

---

### Task 1: Verify No Root `src/` Implementation Exists

**Files:**

- Inspect: repository root.

- [ ] **Step 1: List root implementation directories**

Run:

```bash
find . -maxdepth 2 -type d \( -path './packages' -o -path './apps' -o -path './__test__' -o -path './src' \) | sort
```

Expected:

```text
./__test__
./apps
./packages
```

If `./src` exists, inspect it. It should not contain active implementation code for this project.

- [ ] **Step 2: Search docs and code for obsolete layout guidance**

Run:

```bash
rg -n 'src/copilot|src/.*filesystem|src/.*apply-engine|src/.*approval|src/.*cli' docs packages apps __test__
```

Expected:

- No implementation guidance pointing future work to root `src/`.
- Historical mentions are acceptable only if they explicitly say the layout is obsolete.

---

### Task 2: Verify Package Ownership Boundaries

**Files:**

- Inspect: `packages/core/src/index.ts`
- Inspect: `packages/tools/src/index.ts`
- Inspect: `packages/runtime/src/index.ts`
- Inspect: `packages/agent/src/index.ts`
- Inspect: `packages/backend/src/index.ts`

- [ ] **Step 1: Confirm package responsibilities**

Expected:

- `packages/core`: workspace and config pure functions.
- `packages/tools`: Markdown/YAML engines and AI SDK ToolSet factories.
- `packages/runtime`: model-agnostic Aider-style loop.
- `packages/agent`: prompt/message assembly and runtime composition.
- `packages/backend`: HTTP/SSE transport.

- [ ] **Step 2: Confirm forbidden dependencies**

Run:

```bash
rg -n \"from '@oh-awesome-novel/(agent|tools)'|from '@ai-sdk/vue'|from 'electron'\" packages/runtime
```

Expected:

```text
no matches
```

Runtime must not depend on agent/tools/Vue/Electron.

---

### Task 3: Verify App Ownership Boundaries

**Files:**

- Inspect: `apps/desktop/src/main.ts`
- Inspect: `apps/desktop-ui/src`

- [ ] **Step 1: Confirm Electron main is composition only**

Expected:

- `apps/desktop` starts/stops local backend or loads renderer.
- It does not implement novel domain tools.
- It does not implement runtime loop.

- [ ] **Step 2: Confirm Vue renderer uses backend**

Expected:

- `apps/desktop-ui` uses HTTP/SSE or app-provided backend base URL.
- It does not directly execute filesystem writes.
- It does not import `packages/tools` to run tools in the renderer.

---

### Task 4: Verify Test Workspace Layout

**Files:**

- Inspect: `__test__/core/package.json`
- Inspect: `__test__/tools/package.json`
- Inspect: `__test__/runtime/package.json`
- Inspect: `__test__/agent/package.json`
- Inspect: `__test__/backend/package.json`

- [ ] **Step 1: Confirm each test workspace imports package entrypoints**

Search:

```bash
rg -n \"from '@oh-awesome-novel/\" __test__
```

Expected:

- Tests import public package names such as `@oh-awesome-novel/core`.
- Avoid new tests importing private paths like `packages/core/src/*`.

- [ ] **Step 2: Run representative tests**

Run:

```bash
npm run test:run --workspace @oh-awesome-novel/test-core
npm run test:run --workspace @oh-awesome-novel/test-tools
npm run test:run --workspace @oh-awesome-novel/test-runtime
npm run test:run --workspace @oh-awesome-novel/test-agent
npm run test:run --workspace @oh-awesome-novel/test-backend
```

Expected: all relevant test workspaces pass.

---

### Task 5: Diff Hygiene

**Files:**

- Any files modified while aligning layout.

- [ ] **Step 1: Confirm no root `src/` was added**

Run:

```bash
test ! -d src
```

Expected: exit code `0`.

- [ ] **Step 2: Run diff hygiene**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.
