# Play And Reference Usage Inspector Implementation

Related task: [1390](../../tasks/1390.md). Product scope: [next feature roadmap](../../plans/NEXT_FEATURE_ROADMAP_2026-11-06.md).

## Contract

Reuse `.workspace/sessions/<usage-session>/usage-stats.jsonl` and its bounded reader. Optional strict metadata extends existing records; no second usage database or provider framework.

- Request `operation`: host-owned `domain`, `operationId`, `stage`, and relevant Play session/run/attempt/step or Reference reference/run/unit identities. Unassociated older records remain explicitly unassociated.
- Request `fingerprint`: system/frozen-prefix hash and resolved tool-schema hash. A changed hash explains a changed prefix; it does not claim cache hits or misses.
- Step `timing`: request start, completion, and first provider response only when observed. Non-streaming generation does not manufacture a first-token timestamp.
- A pure projection deduplicates identical turn/step records, flags conflicts, and excludes conflicting records from totals. Partial tail reads retain partial/unavailable coverage.
- UI first-visible observation is separate client-observed telemetry. It never changes provider usage or Play facts and is not represented as a server-authoritative clock.

## Delivery Steps

- [x] Core strict parsers/types and bounded call projection; Runtime/Agent actual timing/fingerprints; propagate metadata through normal and specialized model paths.
- [x] Host binds Play world turn, Rehearsal actor/referee and Reference unit/attempt IDs; expose workspace-bound, filtered inspector APIs and strict Client parsers.
- [x] Play Player projection removes hidden source/association details on the server; Director views retain bounded content-free evidence. UI clears data immediately when scope/lens changes.
- [x] Dedicated Play and Reference Inspector entries show calls, availability, budget, cache fields, timing, fingerprints, sources and bounded historical coverage.
- [x] Explicit comparison runs exactly two bounded synthetic read-only requests against the current host-configured model. No novel text or write tools; separate probe usage prevents double counting story runs. Cancel stops subsequent requests.
- [x] Add schema/aggregation, lifecycle, privacy, request isolation, restart and probe regressions. Add a default SDK → actual HTTP/SSE → production Inspector journey using a controlled provider.
- [x] Build, typecheck, affected regressions and document gates; update task/index only to the extent demonstrated by evidence.

## Verification Boundaries

Tests use synthetic input and temporary workspaces. A controlled SDK provider verifies integration, not literary quality, live provider cache behavior or billing. No external provider request is issued by development verification. Raw prompts, bash arguments, credentials and internal draft paths stay outside the new Inspector DTO.
