# Security notes

Graph Platform v3 separates published read-only knowledge from authenticated mutations.

Production checklist:

- Set `NODE_ENV=production`.
- Set strong unique `JWT_SECRET`, `API_KEY`, `OFFLINE_AI_KEY` and first-bootstrap `ADMIN_INITIAL_PASSWORD`.
- Set `CORS_ORIGINS` explicitly.
- Put the browser surface behind HTTPS.
- Keep Offline AI on loopback/private network; do not expose its service key to frontend code.
- Persist SQLite on a protected writable volume and use WAL-aware backups.
- Treat global `admin` and service API keys as privileged credentials.
- Run clean CI dependency installation, TypeScript/build checks and API/security smoke tests before release.

Do not commit `.env`, runtime databases, logs, tokens, API keys or exported customer Knowledge Packages containing sensitive data.
