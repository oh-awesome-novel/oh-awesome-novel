# ADR 0004: Sandbox Change Engine

## Status

Accepted

## Context

The implemented SemanticPatch architecture makes every supported writing operation depend on an OAN-specific patch union, normalizer, validator, target resolver and executor. That duplicates file-editing behavior already learned by modern coding agents, makes cross-file create/update/delete work cumbersome, and couples the private DSL to PendingAction, backend and renderer contracts.

The product invariants remain unchanged: Markdown/YAML/Object File Tree is canonical truth, Git is the history engine, the AI is a copilot, and no canonical target may change before explicit human Accept.

## Decision

Replace SemanticPatch in one pre-release breaking migration with:

```text
LLM
  -> AI SDK ToolSet from bash-tool
  -> just-bash over a fixed in-memory workspace
  -> CandidateChangeSet
  -> PendingAction
  -> human Accept
  -> transactional ChangeMaterializer
  -> Git commit or explicit quick commit
```

OAN owns the fixed workspace projection, baseline manifest, capability policy, final-document validators, resource limits and lifecycle. `PolicyFs` and `TrackingFs` wrap just-bash's public `IFileSystem`; neither host filesystem access nor host shell execution is exposed to the model.

`CandidateChangeSet` is the authoritative normalized create/update/delete proposal. Unified diff and bounded command previews are display/audit data only. Accept materializes immutable draft artifacts after repository, path, baseline, mode and hash checks; it never parses the diff or replays model commands.

The migration has no feature flag, dual-run, compatibility reader, downgrade path or old-state migrator. New PendingAction and prepared-preview protocols start at strict schema version 1 in a separate storage namespace. Old or unversioned records fail closed with `UNSUPPORTED_PENDING_ACTION_SCHEMA`.

## Security Boundary

- Production uses a fixed `InMemoryFs` snapshot, not a real-workspace `ReadWriteFs` or host-backed overlay.
- Every turn receives one host-selected capability; unknown workflows are read-only and tool arguments cannot widen it.
- Hidden/internal paths, symlinks, non-regular files, network, Python, JavaScript, trusted custom commands and host processes remain unavailable.
- Final reconciliation compares baseline bytes with the final VFS; command transcript and mutation log are not authorities.
- Every writable file family remains read-only until complete final-content validation is registered and tested.
- Repository identity, branch and HEAD are fixed at proposal and revalidated at Accept.
- The accepted terminal record is the file transaction commit point. A later Git failure is recorded in a separate receipt and never rolls canonical files back.

just-bash is a same-process interpreter and a trusted pinned dependency, not a VM/container. This local single-user v1 does not claim protection against arbitrary code execution defects in that dependency. Untrusted plugins, multi-tenant execution or remote third-party workspaces require OS process/container isolation before support.

## One-Time Internal-State Reset

After the new parser/materializer is ready and Backend/Electron are stopped, development workspaces may delete only these disposable, exact, realpath-validated directories:

```text
<workspace>/.workspace/
<workspace>/.oan/sessions/
```

Before deletion, record Git status and a SHA-256 manifest of canonical files, and prove neither target contains Git-tracked files. After reset, recompute both and require canonical equality. The reset must preserve `.git`, `.oan/config.yaml`, `.oan/constitution`, `.oan/workflow.yaml`, `.oan/skills`, every novel object tree and all other canonical files. It does not commit, stash, rewrite or delete canonical content or Git history.

## Consequences

Benefits:

- models use well-trained shell/file-editing behavior for iterative and cross-file work;
- OAN keeps one proposal, approval, transaction, recovery and Git path for agent and deterministic producers;
- safety rules validate final files and fixed baselines instead of trusting a private operation DSL.

Costs:

- OAN must maintain a complete virtual-filesystem policy surface, bounded tools and final validators;
- in-memory snapshots have an explicit size ceiling;
- the dependency supply chain and packaged Electron path become release gates;
- old disposable runtime state is intentionally unsupported and must be reset once.

## Implementation

Task `0800 Sandbox Change Engine Migration` and its sole related plan, `docs/superpowers/plans/2026-08-12-migrate-semantic-patch-to-sandbox-change-engine.md`, define the frozen contracts, implementation order and verification matrix.
