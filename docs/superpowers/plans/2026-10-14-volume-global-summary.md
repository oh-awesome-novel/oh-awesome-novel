# Volume And Global Summary Generation

Related task: [0700](../../tasks/0700.md). Dependencies: completed 1030 / 1290; remaining reliability scope tracked by 1230.

## Design

- Explicit `/整理本卷` (host-selected numbered chapter / volume summary) and `/整理全书` workflows. No background generation, implicit chapter settlement, or new runtime loop.
- Volume input consists only of verified current chapter evidence, excluding author notes and historical blocks. Global input consists only of verified current volume summaries. Require complete coverage of the current canonical chapter inventory; missing/stale/unverified inputs produce a bounded report and no proposal.
- Strict versioned managed Markdown block contains target identity, ordered chapter coverage, direct source byte/payload hashes, a transitive source fingerprint and paragraphs with validated source references. Preserve author text outside the block; reject malformed/edited managed content instead of overwriting it. Hash validation establishes provenance, not literary correctness.
- A shared pure evaluator uses frozen bytes. Changes to chapter inventory, raw chapter bytes, evidence files or direct summaries propagate transitively without rewriting any file. Touch does not invalidate. Manual summaries stay unverified; stale or malformed managed blocks are excluded from default current-fact context.
- One deterministic summary producer, exact summary target, strict origin and existing PendingAction/materializer/Git. Proposal and Accept recheck all source evidence and inventory; existing target baseline protects author edits. Restart must retain the same checks. No shell replay and no new compatibility reader.
- Bounded input, output, source counts and coverage reports; oversized input fails explicitly without hidden truncation/model compression.

## Steps

- [x] Core: verified chapter-only payload; aggregate source/metadata/parser/evaluator; shared project health.
- [x] Tools: producer, final validator, strict origin, built-in Accept freshness and exact target checks.
- [x] Agent / Backend / Client / UI: explicit commands, fixed source projection, source-bound model tool, strict public origin, current-only context selection.
- [x] Tests: recursive stale without intermediate regeneration, additions/deletions/moves, missing/manual/corrupt input, touch, author preservation, limits and 100/500 chapters; default SDK → HTTP/SSE → PendingAction → Accept/Reject/restart, source/target drift and Git configuration.
- [x] Run relevant regression/build/typecheck and repository quality gates; update stable docs, wiki and task status only after acceptance evidence.

Final verification: 207 test files / 1,635 tests; 10 production workspace typechecks, 9 builds and documentation checks passed. See 0700 for evidence and remaining boundaries.
