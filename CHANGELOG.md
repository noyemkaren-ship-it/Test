# Changelog

## 3.0.0 graph layout safety update - 2026-07-27

- Added frontend collision detection and automatic separation for overlapping graph nodes.
- Increased the default layout spacing to 340×280 px and capped card content height.
- Broken, duplicate and non-finite imported coordinates now recover to a deterministic safe layout.
- Added layout regression tests, including 80 nodes starting at the same coordinates.

## 3.0.0 member import update - 2026-07-27

- Added member-facing JSON upload directly to the main graph workspace.
- Member imports always create a new private graph in the authenticated workspace.
- Added keyless JSON import for every registered user, hourly rate limiting, structural validation and content moderation.
- Added built-in public «Выбор стоматолога» domain with 22 nodes and 26 relations.
- Added upload preview, drag-and-drop and responsive import dialog.
- Expanded isolated smoke coverage to 35 passing scenarios.

## 3.0.0 - 2026-07

- Redesigned main dashboard, graph control center, auth UX and Admin Console.
- Added unauthenticated read-only public domain catalog and graph endpoints.
- Added public/private graph visibility with protected mutations.
- Isolated self-registration into personal workspaces by default.
- Unified SQLite access, WAL/migrations and graph-scoped entities.
- Hardened Knowledge Package import against cross-domain ID collisions.
- Completed Workspace Library templates/project cloning/actor bindings flow.
- Reworked RAG scoping and Copilot context/history isolation.
- Replaced random char-RNN fallback with Hybrid Offline AI v3.
- Removed third-party Python requirement for Offline AI and smoke tests.
- Added production deploy/security guidance and `info.pdf` handbook.
