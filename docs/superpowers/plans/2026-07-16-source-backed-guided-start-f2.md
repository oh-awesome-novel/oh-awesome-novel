# Source-backed Guided Start F2 Implementation Plan

**Goal:** Deliver the five-step Guided Start for Immersive Journey and Scene Rehearsal from real workspace sources while preserving Quick Start.

**Architecture:** A versioned, immutable launch package lives under `.workspace/play-setups/<setup-id>/setup.yaml`. Preview reads real workspace files and records source identity, role, content hash, bounded excerpt and diagnostics without creating session truth. Final confirmation persists the setup, revalidates hashes and creates the session through the existing v4 / v5 paths.

**Tech Stack:** TypeScript, YAML, SHA-256, Hono, Vue 3 Composition API, Vitest.

---

## Task 1: Freeze Launch Package Contracts

- [x] Add purpose, start mode, source selection, entry, identity, participant role and diagnostic schemas in an independent Core module.
- [x] Reuse `PlayActivatedSource` identity and add only setup-specific object id, content hash and source role.
- [x] Store refs, hashes and bounded excerpts, never canonical full-file copies or a second world-clock truth.

## Task 2: Preview And Persist Setups

- [x] Resolve real files inside the active workspace, reject hidden / escaping paths, bound bytes and excerpt length, and hash the raw bytes before UTF-8 decoding.
- [x] Return missing / invalid diagnostics during preview and stale diagnostics when committing or starting from an old preview.
- [x] Persist only an explicitly confirmed, error-free, server-rebuilt package under `.workspace/play-setups`.

## Task 3: Create Sessions From The Package

- [x] Add Backend / Client preview and create methods with strict runtime guards.
- [x] Revalidate every source before session creation and guided session use; prompt budgeting does not skip validation.
- [x] Map an immersive package to v4 and a rehearsal package to the existing v5 Scene Contract / frozen knowledge path.
- [x] Preserve Quick Start defaults and existing v1-v4 compatibility.

## Task 4: Desktop Five-step Guided Start

- [x] Move new-session launch out of the narrow Session Rail and keep the rail list-focused.
- [x] Add Sources, Entry, Identity, Cast and Review steps with suggestion-only drafts.
- [x] Do not persist setup or create session truth before final confirmation.
- [x] Block confirmation on missing / stale sources and keep focus, `aria-live`, reduced-motion and neutral tokens.

## Task 5: Verification And Documentation

- [x] Cover source path containment, hashes, stale / missing diagnostics, round-trip and no-write preview.
- [x] Cover Backend / Client strict contracts and both guided purposes.
- [x] Cover five-step Desktop flow, Quick Start regression and final-confirmation boundary.
- [x] Run Core / Backend / Client / Desktop tests, Desktop build and `git diff --check`.
- [x] Mark task `1140` and the guided-entry upgrade plan with accurate implementation notes.

**Verification (2026-07-16):** Core 201, Backend 53, Client 57 and Desktop 115 tests passed; Desktop production build passed. The regression set includes source-evidence tampering, ninth-source drift, setup/session reopen, concurrent create-only writers and the mounted five-step `PlayWorkspace` journey.
