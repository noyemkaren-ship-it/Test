# ADR-002: Optional Offline AI Extension

- Status: accepted
- Date: 2026-07-28
- Requirement boundary: Graph Copilot must use graph and RAG context. An offline model is not required by the base specification.

## Decision

Offline AI is an optional deployment extension, disabled by default. It is not presented as a base-TZ requirement and does not replace the deterministic graph/RAG response.

`AI_EXECUTION_MODE` selects one explicit route:

- `hybrid`: external provider first; optional offline provider only when `OFFLINE_AI_ENABLED=1`; then deterministic local graph/RAG response.
- `external`: external provider only; then deterministic local graph/RAG response.
- `offline`: offline provider only; requires `OFFLINE_AI_ENABLED=1`; then deterministic local graph/RAG response.
- `local`: no model endpoint is called; only deterministic graph/RAG processing is used.

## Rationale

The extension exists for installations that require data locality or must remain useful during loss of external connectivity. It is justified by privacy and availability constraints, not by an unrecorded expansion of the product scope.

## Data boundary and opt-out

The offline endpoint is loopback by default and receives only the already selected graph/RAG context. Operators can fully disable it with `OFFLINE_AI_ENABLED=0` or select `external`/`local`. `/api/ai/capabilities` reports the active policy at runtime.
