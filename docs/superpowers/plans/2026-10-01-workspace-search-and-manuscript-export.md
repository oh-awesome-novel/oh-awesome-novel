# Workspace body search and readable manuscript export

Tasks: [0570](../../tasks/0570.md), [1270](../../tasks/1270.md). Review: B01/B03. Extension, import, and volume/global summary generation remain outside this delivery.

- [x] Implement bounded, read-only canonical text scanning, with exact hidden constitution/workflow exceptions and link/UTF-8/path checks.
- [x] Return Unicode substring body/path results with snippets and line numbers; rescan on every query and explicit refresh, never treat a cache as canonical state.
- [x] Expose search and manuscript export through backend and strict client DTO parsers.
- [x] Replace path-only search with body search, keyboard-accessible modal and right-panel line navigation, without adding agent context or sending chat.
- [x] Export canonical numbered chapter bodies in volume/chapter order, exclude `0000.md`/frontmatter/other domains; explicitly download a timestamped Markdown or TXT file without a server write target.
- [x] Test scope/link failures, Chinese/mixed text, external changes, client contract, stale UI requests, line highlighting and explicit downloads. Build/typecheck and document limits.

Each text file is bounded at 2 MiB; a scan at 32 MiB, 10,000 entries and depth 24. Unsafe sources fail the request rather than silently exposing partial matches. Search is a per-file verified read, not an atomic multi-file filesystem snapshot. Refresh after concurrent external editing for a new view. No persistent search index or new MiniSearch dependency is needed for literal Chinese matching.

TXT is a plain-text manuscript preserving body punctuation/Markdown inline syntax; only Markdown heading prefixes are removed. Browser download preferences/save dialogs control the output location and same-name handling. The backend never receives a destination path and never overwrites canonical files.

Validation: 54 dedicated cases pass (Core 22, Client 16, Backend 6, UI 10); Core/Client/Backend builds succeed. Core and Client full suites also pass. Desktop UI vue-tsc + Vite build passes. Full suites pass: Core 406, Client 144, Backend 148 (two workers), Desktop UI 241.
