#!/usr/bin/env python3
"""Graph Platform Offline AI v3 — zero-dependency local HTTP service.

The service intentionally uses Python's standard library only. It exposes the same
JSON contract as the previous Flask wrapper, but can run in an isolated/offline
environment without installing third-party packages.
"""
from __future__ import annotations

import hmac
import json
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from rnn_model import get_model


def load_env_file() -> None:
    env_path = Path(os.environ.get("GP_ENV_FILE", Path(__file__).with_name(".env")))
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key or key in os.environ:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"\"", "'"}:
            value = value[1:-1]
        else:
            value = value.split(" #", 1)[0].rstrip()
        os.environ[key] = value.replace("\\n", "\n")


from pathlib import Path
load_env_file()

API_KEY = os.environ.get("OFFLINE_AI_KEY", "offline-dev-key")
HOST = os.environ.get("OFFLINE_AI_HOST", "127.0.0.1")
PORT = int(os.environ.get("OFFLINE_AI_PORT", "5005"))
MAX_BODY_BYTES = int(os.environ.get("OFFLINE_AI_MAX_BODY_BYTES", str(256 * 1024)))
ALLOWED_ORIGINS = {x.strip() for x in os.environ.get("OFFLINE_AI_CORS_ORIGINS", "").split(",") if x.strip()}


class OfflineAIHandler(BaseHTTPRequestHandler):
    server_version = "GraphOfflineAI/3.0"
    sys_version = ""

    def log_message(self, fmt: str, *args) -> None:
        if os.environ.get("OFFLINE_AI_QUIET", "0") != "1":
            super().log_message(fmt, *args)

    def _origin_headers(self) -> dict[str, str]:
        headers = {
            "Content-Type": "application/json; charset=utf-8",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-store",
        }
        origin = self.headers.get("Origin", "")
        if origin and (not ALLOWED_ORIGINS or origin in ALLOWED_ORIGINS):
            headers.update({
                "Access-Control-Allow-Origin": origin,
                "Vary": "Origin",
                "Access-Control-Allow-Headers": "Content-Type, X-Offline-Key",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            })
        return headers

    def _send_json(self, payload: dict, status: int = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(int(status))
        for key, value in self._origin_headers().items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        parsed = urlparse(self.path)
        query_key = parse_qs(parsed.query).get("key", [""])[0]
        supplied = self.headers.get("X-Offline-Key", "") or query_key
        return bool(API_KEY) and hmac.compare_digest(str(supplied), str(API_KEY))

    def _read_json(self) -> dict:
        raw_len = self.headers.get("Content-Length", "0")
        try:
            length = int(raw_len)
        except ValueError as exc:
            raise ValueError("invalid content length") from exc
        if length <= 0:
            return {}
        if length > MAX_BODY_BYTES:
            raise OverflowError("request body too large")
        raw = self.rfile.read(length)
        try:
            value = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("invalid JSON") from exc
        return value if isinstance(value, dict) else {}

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        for key, value in self._origin_headers().items():
            self.send_header(key, value)
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path != "/health":
            return self._send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)
        model = get_model()
        self._send_json({
            "ok": True,
            "model": model.model_name,
            "corpus_chars": len(model.corpus),
            "paragraphs": len(model.paragraphs),
            "vocab": model.vocab_size,
            "privacy": "local-only",
            "runtime": "python-stdlib",
        })

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path not in {"/chat", "/reload", "/retrain"}:
            return self._send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)
        if not self._authorized():
            return self._send_json({"error": "unauthorized"}, HTTPStatus.UNAUTHORIZED)

        if path in {"/reload", "/retrain"}:
            return self._send_json({"ok": True, "stats": get_model().reload()})

        try:
            data = self._read_json()
        except OverflowError as exc:
            return self._send_json({"error": str(exc)}, HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
        except ValueError as exc:
            return self._send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

        message = str(data.get("message") or data.get("question") or "").strip()
        if not message:
            return self._send_json({"error": "message required"}, HTTPStatus.BAD_REQUEST)
        if len(message) > 8000:
            return self._send_json({"error": "message too long"}, HTTPStatus.BAD_REQUEST)

        context = str(data.get("context") or "")[:60000]
        session_id = str(data.get("sessionId") or "default")[:120]
        history = data.get("history") if isinstance(data.get("history"), list) else None
        result = get_model().answer(message, context=context, session_id=session_id, history=history)
        self._send_json(result)


def main() -> None:
    model = get_model()
    print(f"Offline AI {model.model_name} on http://{HOST}:{PORT}")
    print(f"Corpus: {len(model.passages)} passages / {len(model.corpus)} chars")
    server = ThreadingHTTPServer((HOST, PORT), OfflineAIHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
