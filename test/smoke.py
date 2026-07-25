#!/usr/bin/env python3
"""Graph Platform v3 API smoke test. Uses Python standard library only."""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("GP_BASE_URL", "http://127.0.0.1:3001").rstrip("/") + "/api"


def request(method: str, path: str, body=None, headers=None, expected=(200,)):
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            status = resp.status
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        status = exc.code
        raw = exc.read().decode("utf-8", errors="replace")
    if status not in expected:
        raise AssertionError(f"{method} {path}: expected {expected}, got {status}: {raw[:300]}")
    try:
        return status, json.loads(raw) if raw else None
    except json.JSONDecodeError:
        return status, raw


def ok(name: str):
    print(f"[OK] {name}")


def main() -> int:
    _, health = request("GET", "/health")
    assert health["ok"] is True and str(health["version"]).startswith("3.")
    ok("health v3")

    _, public = request("GET", "/public/domains")
    assert isinstance(public, list) and public
    ok(f"public catalog without auth ({len(public)} domains)")

    _, graphs = request("GET", "/graphs")
    assert all((g.get("visibility") or "public") == "public" for g in graphs)
    ok("guest /graphs exposes public only")

    request("POST", "/graphs", {"name": "guest-forbidden"}, expected=(401,))
    ok("guest mutation blocked")

    stamp = int(time.time() * 1000)
    email = f"smoke-{stamp}@example.test"
    password = "Smoke-Test-123!"
    _, auth = request("POST", "/auth/register", {"email": email, "password": password, "name": "Smoke User"}, expected=(201,))
    token = auth["token"]
    headers = {"Authorization": f"Bearer {token}"}
    ok("signup")

    _, me = request("GET", "/auth/me", headers=headers)
    assert me["user"]["email"] == email
    ok("auth/me")

    _, workspaces = request("GET", "/workspaces", headers=headers)
    assert len(workspaces) == 1
    own_ws = workspaces[0]["id"]
    assert own_ws != "ws-default"
    ok("personal workspace isolation")

    _, authed_graphs = request("GET", "/graphs", headers=headers)
    assert any((g.get("visibility") or "public") == "public" for g in authed_graphs)
    ok("authenticated user still sees public catalog")

    create_headers = {**headers, "X-Workspace-Id": own_ws}
    _, created = request("POST", "/graphs", {"name": f"Smoke Domain {stamp}", "visibility": "private"}, headers=create_headers, expected=(201,))
    gid = created["id"]
    ok("create private domain in own workspace")

    graph_headers = {**create_headers, "X-Graph-Id": gid}
    _, nodes = request("GET", "/graph/nodes", headers=graph_headers)
    assert isinstance(nodes, list)
    ok("read own graph")

    request("DELETE", f"/graphs/{gid}", headers=create_headers, expected=(200,))
    ok("cleanup own graph")

    print("\nGraph Platform v3 smoke test passed.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"[FAIL] {exc}", file=sys.stderr)
        raise SystemExit(1)
