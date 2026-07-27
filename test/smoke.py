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

    dentist = next((graph for graph in public if graph.get("slug") == "dentist-choice"), None)
    assert dentist and dentist["name"] == "Выбор стоматолога"
    _, dentist_graph = request("GET", "/public/domains/dentist-choice/graph?tab=tobe")
    assert len(dentist_graph["nodes"]) == 22 and len(dentist_graph["edges"]) == 26
    ok("built-in Dentist Choice graph (22 nodes, 26 relations)")

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

    _, import_policy = request("GET", "/graphs/import-policy", headers=create_headers)
    assert import_policy["enabled"] is True and import_policy["visibility"] == "private" and import_policy["moderation"] is True
    ok("member JSON import policy")

    member_package = {
        "graph": {"name": "Member JSON Graph", "description": "Imported from an ordinary registered account", "visibility": "public"},
        "nodes": [
            {"id": "json-a", "label": "JSON Source", "layer": "Knowledge", "data": {"position": {"x": 120, "y": 80}}},
            {"id": "json-b", "label": "JSON Result", "layer": "Project", "data": {"position": {"x": 420, "y": 80}}},
        ],
        "edges": [{"id": "json-edge", "source": "json-a", "target": "json-b", "label": "imports"}],
    }
    _, member_import = request("POST", "/graphs/import", {
        "package": member_package,
        "sourceFileName": "member-graph.json",
        "workspaceId": "ws-default",
    }, headers=create_headers, expected=(201,))
    imported_gid = member_import["graph"]["id"]
    assert member_import["graph"]["workspaceId"] == own_ws
    assert member_import["graph"]["visibility"] == "private"
    assert member_import["nodes"] == 2 and member_import["edges"] == 1 and member_import["moderation"] == "passed"
    imported_headers = {**create_headers, "X-Graph-Id": imported_gid}
    _, imported_nodes = request("GET", "/graph/nodes?tab=tobe", headers=imported_headers)
    _, imported_edges = request("GET", "/graph/edges?tab=tobe", headers=imported_headers)
    assert len(imported_nodes) == 2 and len(imported_edges) == 1
    assert any(node["data"]["position"] == {"x": 120, "y": 80} for node in imported_nodes)
    ok("ordinary account imports private JSON graph with layout")

    blocked_package = {
        "graph": {"name": "Blocked content"},
        "nodes": [{"id": "bad", "label": "блядь"}],
        "edges": [],
    }
    request("POST", "/graphs/import", {"package": blocked_package}, headers=create_headers, expected=(422,))
    ok("JSON profanity moderation blocks package")

    broken_package = {
        "graph": {"name": "Broken relation"},
        "nodes": [{"id": "only", "label": "Only node"}],
        "edges": [{"source": "only", "target": "missing"}],
    }
    request("POST", "/graphs/import", {"package": broken_package}, headers=create_headers, expected=(400,))
    ok("JSON structural validation blocks missing relation target")

    request("POST", "/graph/nodes", {"label": "guest-forbidden"}, headers={"X-Graph-Id": gid}, expected=(401,))
    ok("guest node mutation blocked")

    _, first = request("POST", "/graph/nodes", {
        "label": "Smoke API Gateway",
        "kind": "Service",
        "layer": "Implementation",
        "nodeKind": "service",
        "description": "Created by reproducible editor smoke test",
        "tab": "tobe",
        "position": {"x": 125.5, "y": 240.25},
    }, headers=graph_headers, expected=(201,))
    first_id = first["id"]
    assert first["data"]["position"] == {"x": 125.5, "y": 240.25}
    ok("create node with stored layout")

    _, updated = request("PATCH", f"/graph/nodes/{first_id}", {
        "label": "Smoke API Gateway v2",
        "description": "Updated directly in the graph editor",
        "position": {"x": 480, "y": 315},
    }, headers=graph_headers)
    assert updated["label"].endswith("v2") and updated["data"]["position"] == {"x": 480, "y": 315}
    _, persisted_nodes = request("GET", "/graph/nodes?tab=tobe", headers=graph_headers)
    persisted = next(node for node in persisted_nodes if node["id"] == first_id)
    assert persisted["data"]["position"] == {"x": 480, "y": 315}
    ok("edit node and persist drag layout")

    _, second = request("POST", "/graph/nodes", {
        "label": "Smoke Knowledge Base",
        "kind": "Repository",
        "layer": "Knowledge",
        "nodeKind": "domain",
        "tab": "tobe",
        "position": {"x": 760, "y": 315},
    }, headers=graph_headers, expected=(201,))
    second_id = second["id"]
    ok("create second node")

    _, edge = request("POST", "/graph/edges", {
        "source": first_id,
        "target": second_id,
        "label": "reads",
        "tab": "tobe",
    }, headers=graph_headers, expected=(201,))
    edge_id = edge["id"]
    assert edge["source"] == first_id and edge["target"] == second_id
    ok("create relation between graph nodes")

    request("POST", "/graph/edges", {
        "source": first_id,
        "target": "core",
        "label": "forbidden cross-graph relation",
        "tab": "tobe",
    }, headers=graph_headers, expected=(400,))
    ok("cross-graph relation blocked")

    _, updated_edge = request("PATCH", f"/graph/edges/{edge_id}", {"label": "queries"}, headers=graph_headers)
    assert updated_edge["label"] == "queries"
    _, persisted_edges = request("GET", "/graph/edges?tab=tobe", headers=graph_headers)
    assert any(item["id"] == edge_id and item["label"] == "queries" for item in persisted_edges)
    ok("edit and read relation")

    other_email = f"smoke-other-{stamp}@example.test"
    _, other_auth = request("POST", "/auth/register", {"email": other_email, "password": password, "name": "Other User"}, expected=(201,))
    other_headers = {"Authorization": f"Bearer {other_auth['token']}", "X-Graph-Id": gid}
    request("GET", "/graph/nodes", headers=other_headers, expected=(403,))
    request("PATCH", f"/graph/nodes/{first_id}", {"label": "intrusion"}, headers=other_headers, expected=(403,))
    ok("cross-workspace private graph isolation")

    request("GET", "/graph/nodes", headers={"Authorization": f"Bearer {other_auth['token']}", "X-Graph-Id": imported_gid}, expected=(403,))
    ok("imported member graph remains private to its workspace")

    _, machines = request("GET", "/fsm/machines", headers=graph_headers)
    assert any(machine["type"] == "Task" for machine in machines)
    _, transition = request("POST", "/fsm/Task/transition", {"from": "open", "event": "START"}, headers=graph_headers)
    assert transition == {"ok": True, "from": "open", "to": "in_progress", "event": "START"}
    ok("FSM machine and transition")

    _, ontology = request("GET", "/ontology", headers=graph_headers)
    assert ontology["principle"].startswith("Default First")
    _, extended = request("POST", "/ontology/extend", {
        "id": "smoke-extension",
        "nodeTypes": [{"id": "smoke-type", "label": "Smoke Type", "layer": "Knowledge"}],
    }, headers=graph_headers)
    assert any(item["id"] == "smoke-type" for item in extended["nodeTypes"])
    ok("default ontology and graph-scoped extension")

    rag_text = "The smoke gateway queries the graph knowledge base and returns source-aware answers for platform verification."
    _, ingested = request("POST", "/rag/ingest", {
        "title": "Smoke editor evidence",
        "content": rag_text,
        "nodeIds": [first_id, second_id],
    }, headers=graph_headers, expected=(201,))
    assert ingested["chunks"] >= 1
    _, hits = request("GET", "/rag/search?q=source-aware%20gateway", headers=graph_headers)
    assert hits and first_id in hits[0]["nodeIds"]
    ok("RAG ingest and graph-scoped retrieval")

    request("POST", "/reviews", {"text": "Smoke review for the edited graph"}, headers=graph_headers, expected=(201,))
    _, reviews = request("GET", "/reviews", headers=graph_headers)
    assert any(item["text"] == "Smoke review for the edited graph" for item in reviews)
    ok("graph review create and read")

    _, template = request("POST", f"/workspaces/{own_ws}/templates", {
        "name": "Smoke reproducible template",
        "description": "Snapshot created by smoke test",
    }, headers=graph_headers, expected=(201,))
    template_id = template["id"]
    _, template_data = request("GET", f"/templates/{template_id}", headers=graph_headers)
    template_node = next(node for node in template_data["snapshot"]["nodes"] if node["id"] == first_id)
    assert template_node["data"]["position"] == {"x": 480, "y": 315}
    ok("template snapshot preserves graph and layout")

    _, copilot = request("POST", "/copilot/chat", {
        "message": "What does the Smoke API Gateway query?",
        "selectedNodeIds": [first_id],
        "tab": "tobe",
    }, headers={**graph_headers, "X-Session-Id": f"smoke-{stamp}"})
    assert copilot["answer"] and copilot["offline"] is True and first_id in copilot["sources"]["nodes"]
    ok("Copilot receives selected graph and RAG context")

    request("DELETE", f"/graph/edges/{edge_id}", headers=graph_headers)
    _, remaining_edges = request("GET", "/graph/edges?tab=tobe", headers=graph_headers)
    assert not any(item["id"] == edge_id for item in remaining_edges)
    ok("delete relation")

    request("DELETE", f"/graph/nodes/{second_id}", headers=graph_headers)
    request("DELETE", f"/graph/nodes/{first_id}", headers=graph_headers)
    _, remaining_nodes = request("GET", "/graph/nodes?tab=tobe", headers=graph_headers)
    assert not any(item["id"] in {first_id, second_id} for item in remaining_nodes)
    ok("delete nodes with relation cleanup")

    request("DELETE", f"/templates/{template_id}", headers=graph_headers)
    ok("cleanup template")

    request("DELETE", f"/graphs/{imported_gid}", headers=create_headers, expected=(200,))
    ok("cleanup imported member graph")

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
