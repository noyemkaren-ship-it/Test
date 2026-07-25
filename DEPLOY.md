# Graph Platform v3 — production deploy

Ниже базовая схема production-развёртывания: Nginx/HTTPS -> frontend + `/api` proxy -> Backend; Offline AI доступен Backend по loopback/private network.

## 1. Секреты backend

```bash
cd backend
cp .env.example .env
```

Обязательно измените в production:

```dotenv
NODE_ENV=production
JWT_SECRET=<long-random-secret>
API_KEY=<long-random-service-key>
ADMIN_INITIAL_PASSWORD=<strong-first-bootstrap-password>
OFFLINE_AI_KEY=<another-long-random-secret>
OFFLINE_AI_URL=http://127.0.0.1:5005
CORS_ORIGINS=https://example.com
TRUST_PROXY=1
SQLITE_PATH=/var/lib/graph-platform/graph.db
```

`ADMIN_INITIAL_PASSWORD` нужен только если база пустая и создаётся initial admin. Не храните production `.env` в Git.

## 2. Backend

```bash
cd backend
npm ci --omit=dev
NODE_ENV=production npm start
```

Backend слушает `PORT` (по умолчанию `3001`). Для SQLite создайте writable volume и backup-политику.

## 3. Offline AI

Third-party Python packages не нужны.

```bash
cd offline-ai
export OFFLINE_AI_HOST=127.0.0.1
export OFFLINE_AI_PORT=5005
export OFFLINE_AI_KEY='<same-secret-as-backend>'
python3 server.py
```

Не публикуйте Offline AI напрямую в интернет. Backend передаёт ему graph/RAG context через защищённый service endpoint.

## 4. Frontend

```bash
cd frontend
npm ci
npm run build
```

`frontend/public/config.js`:

```js
window.__GP_CONFIG__ = {
  API_URL: "",
  OFFLINE_AI_URL: "http://127.0.0.1:5005",
  APP_TITLE: "Graph Platform"
};
```

При `API_URL: ""` browser обращается к same-origin `/api`.

## 5. Nginx + HTTPS

```nginx
server {
    listen 443 ssl http2;
    server_name example.com;

    root /var/www/graph-platform/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

TLS-сертификат настройте через вашу инфраструктуру/ACME. Для production не оставляйте приложение только на HTTP.

## 6. systemd (пример)

Backend:

```ini
[Unit]
Description=Graph Platform Backend
After=network.target

[Service]
WorkingDirectory=/opt/graph-platform/backend
EnvironmentFile=/opt/graph-platform/backend/.env
ExecStart=/usr/bin/node src/index.js
Restart=always
User=graphplatform

[Install]
WantedBy=multi-user.target
```

Offline AI создаётся аналогично с `ExecStart=/usr/bin/python3 /opt/graph-platform/offline-ai/server.py` и тем же `OFFLINE_AI_KEY`.

## 7. Проверки после деплоя

```bash
curl https://example.com/api/health
curl https://example.com/api/public/domains
curl http://127.0.0.1:5005/health
```

Guest должен читать public catalog и получать `401/403` на защищённых mutation endpoints.

## 8. Backup

При WAL используйте корректный SQLite backup mechanism/maintenance window, а не случайное копирование только `graph.db` во время активной записи. Храните backup вне сервера и регулярно проверяйте восстановление.
