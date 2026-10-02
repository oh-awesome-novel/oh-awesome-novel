# Multi-domain Chapter Settlement

Related task: [1030](../../tasks/1030.md). Continues [1230](../../tasks/1230.md) without expanding the deferred Extension system.

## Contract

Keep the existing host-selected chapter, fixed read projection, evidence validation, deterministic CandidateChangeSet and human Accept workflow. The model supplies structured domain intent with observation IDs, never target paths or arbitrary YAML edits.

1. Extend the strict observation input with bounded domain changes and explicit unresolved observation IDs. Require exact chapter quotes and source hash, high confidence and a compatible category for every materialized domain change. Unknown IDs/fields are invalid; conflicting or unresolved observations remain report-only, including omission from chapter summary/state.
2. Merge supported scalar dynamic fields into `state/characters.yaml` with expected-value checks and per-field chapter provenance. Refuse older chapters replacing newer state. Do not replace an author's unmodeled fields or structured values.
3. Add deterministic, evidence-keyed entries to `timeline/events.yaml`; preserve existing events/order and report conflicts instead of duplicating or overwriting them.
4. Apply explicit create/mention/advance/resolve/defer operations to the existing active/resolved foreshadow ledgers. Verify lifecycle expectations and move resolved entries within one candidate. Preserve evidence history and unrelated entries.
5. Append bounded evidence records to existing characters' `growth.md`, and preserve author-written chapter summary text with managed evidence blocks. Repeating accepted evidence is idempotent; conflicting managed content is reported.
6. Derive exact targets from validated IDs and operations. Bind the source chapter, existing/absent target files and read-only merge dependencies to a bounded sorted hash read set in the immutable origin. Also bind the character file inventory so newly added metadata cannot introduce an unnoticed identity ambiguity. Recheck both at Accept in addition to repository, target baseline and final-tree validation. No compatibility reader for old origin records.
7. Expose relevant domain files only through the same fixed read-only projection. Update the production tool schema/prompt and strict public origin DTO together.

## Verification

- Core: strict schemas, category/observation matching, confidence and unresolved observations.
- Tools: all supported merges, preservation, stable identity, retries/idempotence, conflict reporting, old-chapter protection, lifecycle and read-set freshness.
- Agent: default capability factory, fixed domain reads, no generic editing tools, stale projection rejection.
- Backend: installed SDK mock → HTTP/SSE → one PendingAction → Accept/Reject, all files unchanged beforehand, stale chapter/target/read-only dependency rejection, repeat settlement behavior.
- Client: strict origin read-set parsing, no draft bytes or private paths.
- Run related package builds and test workspaces; record actual results and limits in task 1030. Exact quotes establish source identity, not automatic proof of literary interpretation; authors still review the diff.
