# Play Snapshot Write Cost Follow-up

Related task: [1260](../../tasks/1260.md).

Keep complete snapshot transactions and validation. The objective is less fresh
rewriting and duplicate source reading, not constant-time saves.

1. Measure the existing writer and missing-index reconstruction using real Node
   filesystem calls. Separate fresh `writeFile` / `appendFile` bytes from logical
   clone/copy bytes; report read bytes, wall/CPU time and lock duration.
2. On a CAS-validated update, compare the old and new derived transcript text.
   For a strict prefix extension, make a private COW clone (ordinary copy
   fallback) inside the new stage, verify its hash against text derived from the
   fully validated old graph, and write only the suffix there. Missing/corrupt
   derived transcript files and non-prefix edits regenerate the full file.
   Never append to the published session, use hardlinks or introduce another
   transaction protocol. Corrupt source artifacts still reject the save.
3. Reuse the current save's validated facts for projection and summary, and use
   a map when projecting selected artifacts. Keep public projection entrypoints
   fully validating. Write `session.yaml` once with its final read-model anchor.
4. During missing/cold index reconstruction, capture hashes from the raw bytes
   the full reader actually validates. Check file identity before/after reading
   and again before installing a warm witness; reject concurrent drift. Avoid a
   second complete source-content pass. This evidence exists for one operation
   and never substitutes for a future mutation's full graph/CAS read.
5. Cover prefix/non-prefix/Unicode output, missing/corrupt transcript repair,
   candidate/source sibling corruption, private clone independence, I/O counts,
   concurrent rebuild drift and SIGKILL at every existing durable boundary.
6. Run Core build and tests, then record before/after measurements and remaining
   linear costs in task 1260. Do not infer physical disk savings from logical
   clone bytes or a single timing run.

Implemented 2026-10-02. The existing stage/ready/backup/swap/fsync/cleanup order,
full mutation validation, CAS semantics and recovery protocol are unchanged.
