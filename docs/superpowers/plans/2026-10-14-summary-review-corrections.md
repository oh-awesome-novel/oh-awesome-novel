# Summary Review Corrections

Related task: [0700](../../tasks/0700.md). Follow-up to the two reviews of `24d006a` and their verified reproductions.

## Scope And Decisions

- Keep raw byte source fingerprints, missing `.yaml` / `.yml` slots, complete chapter coverage and the single PendingAction/materializer write boundary. No semantic fingerprint replacement, partial-book scope, compatibility reader or migration.
- Aggregate generation is selected by explicit slash commands (with a command boundary) or exact catalog prompts. Ordinary mentions, questions and negated requests do not select it. Keep explicit command priority.
- Preflight malformed existing targets before exposing verified inputs or `summary.propose`. A blocked turn may still use a model to explain the bounded diagnostics; this is not a zero-provider-call guarantee.
- Parse only real reserved aggregate comments on aggregate paths. Permit marker names in author prose and chapter evidence. Keep unknown versions, duplicates, incomplete blocks and edited metadata/prose fail-closed. Tolerate CRLF only in managed-block parsing/comparison; preserve raw offsets, author bytes and byte hashes.
- Add missing H1 headings in reviewable candidates for both manual and managed targets. Preserve frontmatter and author text.
- Separate raw verified prose from escaped Markdown rendering at chapter and aggregate levels. Do not change the canonical block renderer. Derived payload hashes can change for existing special-character inputs; affected summaries must be regenerated, without rewriting them automatically. Accept compares current source references and payload hashes as well as the fingerprint, including after restart.
- Keep the 256 KiB complete-input limit, count serialized inputs incrementally and discard the payload collection on overflow. Give volume/book-specific recovery instructions; explicitly support grouped citations within 32 paragraphs. No hidden compression or automatic subset selection.
- Union selected chapter and volume scopes; explain non-active volume omissions accurately. Do not introduce an automatic previous-volume fallback.
- Share capability IDs and summary selection through a browser-safe contract entry. Document the generic sandbox selector's limited role; do not duplicate deterministic target derivation there or add outline/state selection entry points.
- Add an early volume-selection hint and separate optional missing aggregate summaries in the health panel. Keep all evaluator statuses; do not persist a hidden “has run generation” flag.

## Verification

- [x] Core: target preflight, marker literals, strict malformed rejection, CRLF offsets, raw prose, input overflow and grouped volume coverage.
- [x] Tools: heading repair through Accept, chapter marker observations, checksum-consistent malformed drafts and changed payload references after restart.
- [x] Agent/Backend: explicit routing, consultations without volume selection errors, blocked target without generation tools/inputs, mixed selected scopes.
- [x] Client/UI: browser-safe contracts, reactive selection hints and optional-health grouping.
- [x] Build, production typechecks, regression tests, docs checks and Wiki build; record actual results in 0700.

Verification: quality gate passed with 208 test files / 1,663 tests. The final aggregate-only command-boundary adjustment was additionally rebuilt/typechecked and verified by all 123 Agent tests and 10 summary HTTP tests. See 0700 for the module breakdown and environment limits.
