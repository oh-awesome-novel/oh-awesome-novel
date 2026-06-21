# Local Development Guide

This guide describes how to run oh-awesome-novel locally without Electron, using the standalone HTTP backend and the Vite web UI.

## Prerequisites

- Node.js 24. The repo includes `mise.toml`, so `mise install` can prepare the expected runtime.
- npm dependencies installed with `npm install`.
- A local Git command available on `PATH`.
- Optional for agent testing: Ollama running locally with the model you want to use.

## Recommended Local Paths

For browser-based development, keep test data under `examples/`:

- Workspace root: `examples/simple-novel`
- Global config dir: `examples/global`

`examples/simple-novel` is the filesystem-first novel workspace. It contains chapters, world files, character state, timelines, summaries, and `.oan` workflow/config files.

`examples/global` stores machine-level app configuration used by the web client, such as workspace history and LLM provider settings. Do not use `localStorage` for app settings that should behave like desktop/global config.

## Start the HTTP Backend

Run the backend from the repo root:

```sh
REPO_ROOT="$(pwd)"

npm run dev --workspace @oh-awesome-novel/http-backend -- \
  --workspace-root "$REPO_ROOT/examples/simple-novel" \
  --global-config-dir "$REPO_ROOT/examples/global" \
  --port 3210
```

Expected output:

```text
Oh Awesome Novel HTTP backend listening at http://127.0.0.1:3210
Workspace: <repo>/examples/simple-novel
```

Useful options:

- `--workspace-root <path>` or `--workspace <path>` selects the active novel workspace.
- `--global-config-dir <path>` selects where global config files are stored.
- `--host <host>` defaults to `127.0.0.1`.
- `--port <port>` defaults to `3210`.

The same values can also be supplied through `OAN_WORKSPACE_ROOT`, `OAN_GLOBAL_CONFIG_DIR`, `OAN_HTTP_HOST`, and `OAN_HTTP_PORT`.

## Start the Web UI

In a second terminal, run:

```sh
npm run dev --workspace @oh-awesome-novel/desktop-ui
```

Open:

```text
http://127.0.0.1:5173/
```

The Vite dev server proxies `/api` to:

```text
http://127.0.0.1:3210
```

To point the UI at a different backend:

```sh
VITE_OAN_BACKEND_PROXY_TARGET=http://127.0.0.1:3211 npm run dev --workspace @oh-awesome-novel/desktop-ui
```

## Configure a Local LLM Provider

Provider settings should be configured through the web UI so they are written to the global config dir.

For local Ollama testing, use values like:

```text
Provider kind: openai-compatible
Base URL: http://127.0.0.1:11434/v1
Model: gemma4:26b-a4b-it-q4_K_M
API key: ollama
```

Make sure Ollama is running and the model exists locally before sending agent messages.

## Common Development Flow

1. Start the HTTP backend with `examples/simple-novel` and `examples/global`.
2. Start the Vite web UI.
3. Open `http://127.0.0.1:5173/`.
4. Enter or create the `Simple Novel` workspace.
5. Configure the LLM provider from the UI if agent calls are needed.
6. Use the workspace UI to test file tree, chapters, pending actions, Git, references, and agent chat.

## Electron Development

Electron can still be run for desktop integration testing:

```sh
npm run dev --workspace @oh-awesome-novel/desktop
```

This path builds backend dependencies first and starts Electron through Electron Forge. For most UI/backend iteration, the standalone HTTP backend plus Vite UI is faster.

## Build And Test

Build the web UI:

```sh
npm run build --workspace @oh-awesome-novel/desktop-ui
```

Build backend packages:

```sh
nx run @oh-awesome-novel/backend:build
```

Run module tests from their package workspaces, for example:

```sh
npm run test:run --workspace @oh-awesome-novel/test-core
npm run test:run --workspace @oh-awesome-novel/test-runtime
npm run test:run --workspace @oh-awesome-novel/test-backend
npm run test:run --workspace @oh-awesome-novel/test-agent
npm run test:run --workspace @oh-awesome-novel/test-client
```

Tests live under the root `__test__/` workspaces. Do not add tests inside package-local `src/__tests__/` directories.

## Notes

- The project is filesystem-first. Novel content and durable state should be explainable from Markdown, YAML, object files, and Git history.
- AI-generated writes to real target files must go through PendingAction review before being accepted.
- `examples/global` is local development state and may contain machine-specific config.
- If Nx prompts for analytics during local runs, answer according to your preference. Avoid committing unrelated analytics changes unless the team explicitly wants them.
