# Reference Context Selector And Loading Map Implementation Plan

> **For agentic workers:** Selector reads distilled reference artifacts only. It must not become hidden RAG memory.

**Goal:** Let writing tasks safely use enabled reference bundles through explicit included / omitted source decisions.

**Architecture:** Build on `0900` reference bundle storage. Selector outputs context package source refs and no-copy warnings; it does not implement full reference deconstruction.

**Tech Stack:** TypeScript, YAML / Markdown readers, existing context package types, Vitest.

---

## File Structure

- Create: `packages/core/src/reference-context-selector.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/agent/src/index.ts` or later selector integration point
- Test: `__test__/core/src/reference-context-selector.test.ts`
- Docs: update `docs/tasks/0900.md` only if storage shape changes

---

### Task 1: Define Selector Schema

- [ ] Define `ReferenceContextSelectorInput`.
- [ ] Define `ReferenceContextSelection`.
- [ ] Include selected entries, omitted entries, reasons, budget layer, and no-copy warnings.
- [ ] Include `originalSourceRead: false` by default.

### Task 2: Read Enabled Reference Index

- [ ] Read project-level reference index from the final `0900` storage.
- [ ] Filter disabled references.
- [ ] Validate distilled files stay under reference bundle directories.
- [ ] Return safe empty result when no references are enabled.

### Task 3: Select Distilled Entries

- [ ] Match by capability id, scene type, style request, hook / pacing request, or explicit reference id.
- [ ] Prefer `context/reference-summary.md` and `distilled/*`.
- [ ] Do not read original source by default.
- [ ] Record omitted references with reasons.

### Task 4: Context Package Integration

- [ ] Convert included distilled entries to `referenceDistilled` selected sources.
- [ ] Convert omitted references to `referenceDistilled` omitted sources.
- [ ] Include no-copy warnings in model-visible reference summary.

### Task 5: Tests

- [ ] Enabled reference is included when relevant.
- [ ] Disabled reference is omitted with reason.
- [ ] Missing distilled file is recoverable and reported.
- [ ] Original source path is not read by default.
- [ ] No-copy warning is present.

