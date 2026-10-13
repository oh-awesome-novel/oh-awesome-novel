# Play Reliability And Tavern Import Closure

Scope: tasks [1120](../../tasks/1120.md) and [1060](../../tasks/1060.md). The user requested both unfinished Play tasks be continued together. This supersedes the older pre-release deferral of the Tavern import journey and explicit Play session migration.

## Reliability

- Reuse the existing cross-process lock and staged snapshot writer. Clean abandoned stages only while holding that lock; validate published/recovered snapshots before deleting recovery copies.
- Retain stale-owner lock tombstones during online operation because delayed contenders can otherwise move a replacement live lock. Do not claim online TTL deletion is safe.
- Retain terminal run receipts for 30 days. Delete only provably terminal receipts; preserve unresolved, corrupt and mismatched evidence. Bound cleanup batches and rotate the cursor.
- Require explicit migration preview/confirmation for v1/v2/eligible v3 sessions. Bind confirmation to revision and all original file bytes, preserve backups, reject ordinary legacy mutation before provider execution.
- Enable absolute world time only for explicitly declared ISO triggers; reuse one pure comparator in host and Client replay. Optional event state refs must identify actual changed leaves of their owning turn.

## Tavern Import

- Bound JSON, PNG metadata/decompression and lorebooks. Independently parse base64 `chara`/`ccv3`, reject ambiguous/unsafe inputs and retain untrusted-content warnings.
- Create and merge through a deterministic `character.edit` producer, immutable prepared preview, PendingAction and existing materializer. Merge preserves canonical facts and deduplicates interaction/lore; bind the full seven-file read set as well as changed bytes.
- Play-only preview creates one separate session only after confirmation; persist imported hints as Play-local metadata and activate bounded matching lore. Never treat imported overrides as system instructions.
- Add typed HTTP/Client contracts and a local file import UI with preview, conflict explanation, review handoff and session selection. No shared-site fetch or host-path upload.

## Verification And Limits

Run Core/Tools/Backend/Client/Desktop tests, builds, typechecks and documentation checks. Include real temporary-workspace Accept/Reject/reopen journeys and process-crash boundaries. Keep external provider, native cross-platform and device-power-loss evidence separate from deterministic tests. Further full-ledger mutation cost reduction, mandatory causal ownership for every new delta and safe offline tombstone deletion remain explicit follow-up scope in 1120.

Verification completed on 2026-10-07: nine-project build, workspace typechecks, seven-workspace regression with isolated retry of one existing 5-second Reference timeout, final targeted import/bounds tests, docs checks/build and real Electron renderer smoke passed. Task 1060 is Completed; task 1120 remains Needs Review for the explicitly listed external and policy/design follow-ups.

## Follow-up: Reachable Frontend Entrypoints

The user requested checking for backend capabilities with no usable frontend entry. The audit found an invisible Review handoff in Play, missing manual observation creation and missing optional event-policy inputs. Reuse the existing shared approval panel in a visible Play drawer; add an author observation form bound to a committed selected-branch message and revision; expose existing event-policy settings in Quick Start. Add explicit ISO time help/validation and explain pending unformatted triggers. Keep recovery/retention automatic and deprecated transcript/nonstream APIs out of the main UI. Verify actual visible controls and submitted API payloads, not only hidden component props.

Verified: nine-project build and workspace typechecks; Client 191, Desktop 288, Backend 80 tests; Electron renderer smoke; documentation checks/build. The backend observation journey verifies persisted provenance, adoption, stale rejection and rejection after restoring away from the source branch without canonical writes.
