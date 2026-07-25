# Changelog

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
