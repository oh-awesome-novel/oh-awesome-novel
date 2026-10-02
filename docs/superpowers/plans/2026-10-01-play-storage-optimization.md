# Play Storage Optimization Plan

Related task: [1260](../../tasks/1260.md).

1. Derive summary, current selected snapshot, transcript and event presentation from the existing validated projection in one pass.
2. Publish content-addressed pages and bounded fanout tree nodes in `.read-model/` inside the existing staged snapshot. Bind the portable root to reserved session metadata and all source content hashes; keep physical file identity in a bounded process-local witness only.
3. Read summaries and selected windows under the existing lock; validate metadata, root/page hashes and source identity. Missing indexes or new/changed physical identity rebuild from a full validated session and must reproduce the stored content root before rebinding the witness. Copying workspaces and content-identical touches preserve the root. Corrupt or stale indexes fail closed.
4. Preserve the full reader for mutations, Retry/Restore, provenance checks and old unindexed sessions. Wire only ordinary list/detail APIs to the indexed readers.
5. Reuse unchanged immutable turn files with copy-on-write clone where supported, falling back to a private copy. Retain the same staged directory and fsync protocol; do not mutate prior snapshots or append scattered facts.
6. Exercise cursor/visibility, sibling history, missing/corrupt/source-drift index, CAS and crash recovery tests; rerun the real storage-cost script with new write/copy metrics and report measured limits.
