# Graph Platform v3

Graph Platform — self-hosted knowledge operating system: независимые графы доменов, процессы, Actor/Role-модель, RAG и Graph Copilot в одном интерфейсе.

Версия 3 делает проект пригодным не только как demo: публичные домены можно безопасно читать без аккаунта, запись изолирована по workspace, админка стала полноценной консолью, а offline AI получил локальный hybrid retrieval с контекстом выбранного графа.

## Главные возможности

- **Public Domain Catalog** — опубликованные графы доступны read-only без JWT.
- **Workspace isolation** — регистрация создаёт отдельный workspace; чужой публичный граф нельзя менять.
- **Graph-aware data model** — nodes, edges, actors, work items, RAG, reviews, ontology, bindings и AI history привязаны к `graph_id`.
- **Graph Copilot** — внешний OpenAI-compatible LLM при наличии ключа, иначе полностью локальный Hybrid Offline AI.
- **Zero-dependency Offline AI** — BM25 + fuzzy char n-grams + русская нормализация + graph-context + dialogue memory + источники/confidence. Только Python standard library.
- **Admin Console** — обзор системы, домены и visibility, Knowledge Package import/export, users/roles, AI history и health.
- **Workspace Library** — проекты, Actor↔Project bindings, snapshots/templates и независимое клонирование проекта.
- **Default First ontology** — новый граф сразу получает рабочий профиль, который можно расширять.
- **Full graph editor** — создание, изменение и удаление узлов/связей прямо в React Flow; drag layout сохраняется в SQLite.
- **Member JSON import** — обычный зарегистрированный пользователь загружает Knowledge Package прямо из рабочей панели; новый граф создаётся приватным в его workspace и проходит структурную/контентную проверку.
- **Dentist Choice domain** — встроенный публичный граф «Выбор стоматолога» с 22 узлами, 26 связями и официальными источниками по лицензии и информированному согласию.

Подробная архитектура, API, security model, deploy и форматы данных описаны в `info.pdf`.

## Быстрый старт

Требования: Node.js 20+ (рекомендуется 22), npm, Python 3.10+.

```bash
# 1) Backend
cd backend
cp .env.example .env
npm ci
npm run dev

# 2) Offline AI — отдельный терминал
cd offline-ai
python3 server.py

# 3) Frontend — отдельный терминал
cd frontend
npm ci
npm run dev -- --host 0.0.0.0
```

Откройте `http://localhost:5173`. Backend по умолчанию работает на `http://localhost:3001`, Offline AI — на `http://127.0.0.1:5005`.

В development при первой пустой БД создаётся локальный admin:

```text
admin@graph.local
Admin1234!
```

В production дефолтный пароль не используется: для первого bootstrap обязательно задайте `ADMIN_INITIAL_PASSWORD`, а также реальные `JWT_SECRET`, `API_KEY` и `OFFLINE_AI_KEY`.

## Public API без авторизации

```bash
# Каталог опубликованных доменов
curl http://localhost:3001/api/public/domains

# Метаданные домена
curl http://localhost:3001/api/public/domains/bank

# Read-only граф
curl 'http://localhost:3001/api/public/domains/bank/graph?tab=tobe'

# GET /api/graphs для guest также возвращает только public-графы
curl http://localhost:3001/api/graphs
```

Public означает **только чтение**. Создание/изменение/удаление графов, RAG ingest, templates/projects, role bindings, импорт, пользователи и admin endpoints требуют авторизации и соответствующих прав.

## Конфигурация frontend

`frontend/public/config.js` читается runtime, поэтому API origin можно менять без пересборки готового frontend:

```js
window.__GP_CONFIG__ = {
  API_URL: "", // пусто = same-origin /api, удобно за nginx
  OFFLINE_AI_URL: "http://127.0.0.1:5005",
  APP_TITLE: "Graph Platform"
};
```

Frontend работает только через Backend API; Offline AI URL нужен для инфраструктурной конфигурации, но ключ сервиса не должен попадать в браузер.

## Архитектура

```text
Browser / React + Vite
        |
        | /api
        v
Express API v3  --------------------> Optional OpenAI-compatible LLM
  |   |   |                                  |
  |   |   +--> Graph Copilot / RAG ----------+
  |   |
  |   +------> Workspace / Auth / Admin / FSM / Ontology
  |
  +----------> SQLite (single connection, WAL, migrations)
  |
  +----------> Local Offline AI :5005
                 BM25 + fuzzy retrieval + graph context
```

## Данные и изоляция

Иерархия доступа:

```text
User -> Membership -> Workspace -> Graph -> graph-scoped entities
                                      |
                                      +-> public  = guest read-only
                                      +-> private = workspace members only
```

Заголовки:

- `Authorization: Bearer <JWT>` — пользовательская авторизация.
- `X-Workspace-Id` — выбор workspace; учитывается только для авторизованного/service клиента и проверяется membership.
- `X-Graph-Id` — активный граф и AI/RAG контекст.
- `X-Session-Id` — изолированная история Copilot; frontend создаёт стабильный browser session id.

## Offline AI

```bash
cd offline-ai
export OFFLINE_AI_KEY='replace-with-long-secret'
export OFFLINE_AI_HOST=127.0.0.1
export OFFLINE_AI_PORT=5005
python3 server.py
```

Проверка:

```bash
curl http://127.0.0.1:5005/health
curl -X POST http://127.0.0.1:5005/chat \
  -H 'Content-Type: application/json' \
  -H 'X-Offline-Key: replace-with-long-secret' \
  -d '{"message":"Как устроен публичный доступ?","sessionId":"demo"}'
```

Локальный AI не генерирует случайные char-RNN продолжения. Он возвращает детерминированный ответ, `confidence`, retrieval-статистику и источники из `Data/`/graph-context. Корпус перечитывается через `POST /reload`.

## Knowledge Package

Обычный зарегистрированный пользователь нажимает **«Загрузить JSON»** в верхней части рабочей панели. Никакой дополнительный ключ не нужен. Импорт всегда создаёт новый `private`-граф в его собственном workspace, проверяет структуру, размер, ссылки edges, опасные конструкции и нецензурное содержимое.

Admin Console сохраняет расширенный режим import/merge/replace. Коллизии `node.id`/`edge.id` с другими графами remap-ятся, а endpoints не разрешают создавать cross-domain edge.

Минимальный пакет:

```json
{
  "name": "My Domain",
  "slug": "my-domain",
  "description": "Domain knowledge package",
  "visibility": "private",
  "nodes": [
    {"id":"root","label":"Root","layer":"Knowledge","nodeKind":"domain"}
  ],
  "edges": []
}
```

## Проверки

Полный воспроизводимый аудит на временной базе:

```bash
./scripts/audit.sh
```

Подробности и перечень проверяемых сценариев: `AUDIT.md`. Подтверждаемая история текущего архива и границы Git provenance: `PROVENANCE.md`.

```bash
# Backend source syntax
cd backend && npm run check

# Frontend typecheck
cd frontend && npm run check

# Offline AI syntax
python3 -m py_compile offline-ai/server.py offline-ai/rnn_model.py

# API smoke (при запущенном backend)
python3 test/smoke.py
```

## Production

Смотрите `DEPLOY.md`. Ключевые правила: reverse proxy с HTTPS, same-origin `/api`, секреты только в environment, `NODE_ENV=production`, отдельный writable volume для SQLite, backup БД и binding Offline AI к loopback/private network.

## Структура

```text
frontend/       React/Vite UI, dashboard, graph visualization, admin console
backend/        Express API, SQLite, auth, graph/RAG/Copilot/admin engines
offline-ai/     zero-dependency local retrieval assistant
Data/           локальная база знаний Offline AI
docs/           дополнительные материалы проекта
test/           smoke/API checks
info.pdf        полный технический и продуктовый паспорт проекта
```

## Версия

`3.0.0` — redesigned frontend/admin, public read-only domains, workspace isolation, graph-aware backend and Hybrid Offline AI.
