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

    required_ecosystems = {"greenmarket", "taxi", "platform-core", "fsm-engine", "voice", "map", "graph-platform-self"}
    assert required_ecosystems.issubset({graph.get("slug") for graph in public})
    ok("internal validation ecosystems and self-hosting graph")

    _, self_host = request("GET", "/self-host/status")
    assert isinstance(self_host["automatic"], bool) and self_host["sources"] > 0 and self_host["error"] is None
    ok(f"self-hosting repository sync ({self_host['sources']} sources)")

    _, openapi = request("GET", "/openapi.yaml")
    assert "openapi: 3.1.0" in openapi and "/issues:" in openapi and "/conversations:" in openapi
    ok("OpenAPI specification is served")

    dentist = next((graph for graph in public if graph.get("slug") == "dentist-choice"), None)
    assert dentist and dentist["name"] == "Выбор стоматолога"
    _, dentist_graph = request("GET", "/public/domains/dentist-choice/graph?tab=tobe")
    assert len(dentist_graph["nodes"]) == 22 and len(dentist_graph["edges"]) == 26
    ok("built-in Dentist Choice graph (22 nodes, 26 relations)")

    bank = next(graph for graph in public if graph.get("slug") == "bank")
    _, seeded_reviews = request("GET", "/reviews", headers={"X-Graph-Id": bank["id"]})
    assert seeded_reviews and all(item["scopes"] and item["status"] in {"approved", "pending"} for item in seeded_reviews)
    ok("seeded reviews have normalized ReviewScope and status")

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
    assert created["projectId"]
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

    _, node_types = request("GET", "/node-types", headers=graph_headers)
    _, edge_types = request("GET", "/edge-types", headers=graph_headers)
    assert any(item["id"] == "smoke-type" for item in node_types) and any(item["id"] == "depends" for item in edge_types)
    request("POST", "/edge-types", {"id": "validates", "label": "validates"}, headers=graph_headers, expected=(201,))
    ok("NodeType and EdgeType are materialized entities")

    _, service_actor = request("POST", "/actors", {
        "name": "Smoke CI Service", "type": "Service", "roles": ["Исполнитель"]
    }, headers=graph_headers, expected=(201,))
    assert service_actor["type"] == "Service"
    ok("Actor CRUD supports Human, AIAgent, Service and ExternalSystem model")

    request("POST", "/role-bindings", {"actorId": service_actor["id"], "objectId": first_id, "role": "Заказчик"}, headers=graph_headers, expected=(201,))
    request("POST", "/role-bindings", {"actorId": service_actor["id"], "objectId": first_id, "role": "Owner"}, headers=graph_headers, expected=(409,))
    _, actor_scope = request("GET", f"/interest-scope/{service_actor['id']}", headers=graph_headers)
    assert first_id in actor_scope["nodeIds"] and actor_scope["roleBindingIds"]
    ok("Customer and Owner separation is enforced; Interest Scope is computed from role bindings")

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

    _, issue = request("POST", "/issues", {
        "projectId": created["projectId"], "type": "KnowledgeDefect", "title": "Missing source lineage",
        "description": "The verification graph must preserve source lineage", "severity": "high"
    }, headers=graph_headers, expected=(201,))
    issue_id = issue["id"]
    _, work_item = request("POST", "/work-items", {
        "projectId": created["projectId"], "issueId": issue_id, "type": "KnowledgeDefect",
        "title": "Restore source lineage", "status": "open", "layer": "Project",
        "relatedNodeIds": [first_id, second_id], "estimatedHours": 13.5,
        "requiredSpecialists": ["Data Engineer", "Reviewer"], "budget": 125000,
        "deadline": "2026-08-15", "criticalPath": True, "riskLevel": "high"
    }, headers=graph_headers, expected=(201,))
    work_item_id = work_item["id"]
    assert work_item["issueId"] == issue_id and work_item["estimatedHours"] == 13.5
    assert work_item["budget"] == 125000 and work_item["criticalPath"] is True
    _, work_transitions = request("GET", f"/work-items/{work_item_id}/transitions", headers=graph_headers)
    assert work_transitions["allowed"] == ["TRIAGE"]
    _, transitioned_work = request("POST", f"/work-items/{work_item_id}/transition", {"event": "TRIAGE"}, headers=graph_headers)
    assert transitioned_work["from"] == "open" and transitioned_work["to"] == "triaged"
    ok("Issue to WorkItem hierarchy, metrics and persisted FSM transition")

    _, change = request("POST", "/changes", {
        "projectId": created["projectId"], "title": "Gateway lineage change",
        "description": "Connect implementation to test and SQL evidence", "estimatedHours": 21,
        "budget": 180000, "deadline": "2026-08-20", "riskLevel": "medium",
        "metrics": {"coverageTarget": 100},
        "artifacts": [
            {"nodeId": first_id, "perspective": "sql"},
            {"nodeId": second_id, "perspective": "test"}
        ]
    }, headers=graph_headers, expected=(201,))
    assert {artifact["perspective"] for artifact in change["artifacts"]} == {"sql", "test"}
    ok("Change links SQL/test perspectives and stores executor metrics")

    _, program = request("POST", "/programs", {"name": "Smoke Program"}, headers=graph_headers, expected=(201,))
    program_id = program["id"]
    _, sprint = request("POST", "/sprints", {
        "projectId": created["projectId"], "name": "Smoke Sprint", "start": "2026-08-01", "end": "2026-08-14"
    }, headers=graph_headers, expected=(201,))
    _, pipe = request("POST", "/pipes", {
        "projectId": created["projectId"], "name": "Delivery Pipe", "stages": ["Backlog", "Build", "Review", "Done"]
    }, headers=graph_headers, expected=(201,))
    _, release = request("POST", "/releases", {
        "projectId": created["projectId"], "name": "Smoke Release", "targetDate": "2026-08-20"
    }, headers=graph_headers, expected=(201,))
    request("POST", f"/sprints/{sprint['id']}/pipes", {"pipeId": pipe["id"]}, headers=graph_headers, expected=(201,))
    request("POST", f"/sprints/{sprint['id']}/work-items", {"workItemId": work_item_id}, headers=graph_headers, expected=(201,))
    request("POST", f"/pipes/{pipe['id']}/work-items", {"workItemId": work_item_id}, headers=graph_headers, expected=(201,))
    request("POST", f"/issues/{issue_id}/pipes", {"pipeId": pipe["id"]}, headers=graph_headers, expected=(201,))
    _, execution_graph = request("GET", "/execution-graph", headers=graph_headers)
    assert any(item["sprint_id"] == sprint["id"] and item["pipe_id"] == pipe["id"] for item in execution_graph["sprintPipes"])
    assert any(item["id"] == release["id"] for item in execution_graph["releases"])
    ok("Portfolio/Program/Project/Pipe/Release graph and independent Sprint-Pipe M:N links")

    _, metrics = request("GET", "/transformation-metrics", headers=graph_headers)
    assert metrics["resources"]["estimatedHours"] >= 13.5 and metrics["resources"]["budget"] >= 125000
    assert {item["layer"] for item in metrics["layers"]}.issuperset({"Implementation", "Knowledge"})
    ok("Transformation metrics aggregate four-layer resource and financial data")

    _, transformation = request("POST", "/transformation-sets", {
        "projectId": created["projectId"], "name": "Smoke coordinated transformation"
    }, headers=graph_headers, expected=(201,))
    assert len(transformation["graphs"]) == 4
    assert {item["layer"] for item in transformation["graphs"]} == {"Knowledge", "Implementation", "Project", "Resource"}
    implementation_graph = next(item for item in transformation["graphs"] if item["layer"] == "Implementation")
    knowledge_graph = next(item for item in transformation["graphs"] if item["layer"] == "Knowledge")
    request("POST", f"/transformation-graphs/{implementation_graph['id']}/nodes", {"nodeId": first_id}, headers=graph_headers, expected=(201,))
    request("POST", f"/transformation-graphs/{knowledge_graph['id']}/nodes", {"nodeId": second_id}, headers=graph_headers, expected=(201,))
    request("POST", f"/transformation-sets/{transformation['id']}/alignments", {
        "sourceGraphId": implementation_graph["id"], "sourceNodeId": first_id,
        "targetGraphId": knowledge_graph["id"], "targetNodeId": second_id, "relation": "implements"
    }, headers=graph_headers, expected=(201,))
    _, transformation_detail = request("GET", f"/transformation-sets/{transformation['id']}", headers=graph_headers)
    assert transformation_detail["invariant"] == {
        "requiredLayers": ["Knowledge", "Implementation", "Project", "Resource"], "graphCount": 4, "complete": True
    }
    assert len({item["id"] for item in transformation_detail["graphs"]}) == 4 and len(transformation_detail["alignments"]) == 1
    ok("Transformation Set contains four standalone coordinated graphs with cross-graph alignment")

    _, second_project = request("POST", "/projects", {"name": "Shared Consumer Project"}, headers=create_headers, expected=(201,))
    _, shared_resource = request("POST", "/workspace-resources", {
        "name": "Shared domain contract", "type": "contract", "payload": {"version": 1}, "sourceGraphId": gid
    }, headers=create_headers, expected=(201,))
    for project_id in (created["projectId"], second_project["id"]):
        request("POST", f"/workspace-resources/{shared_resource['id']}/projects/{project_id}", {"usageRole": "consumer"}, headers=create_headers, expected=(201,))
        request("POST", f"/projects/{project_id}/shared-nodes/{first_id}", {"usageRole": "reference"}, headers=create_headers, expected=(201,))
        _, shared = request("GET", f"/projects/{project_id}/shared-resources", headers=create_headers)
        assert any(item["id"] == shared_resource["id"] for item in shared["resources"])
        assert any(item["id"] == first_id for item in shared["nodes"])
    ok("one workspace resource and one graph node are reused by two projects through M:N links")

    _, epic = request("POST", "/epics", {"projectId": created["projectId"], "graphId": gid, "name": "Smoke Epic"}, headers=graph_headers, expected=(201,))
    _, feature = request("POST", "/features", {"epicId": epic["id"], "graphId": gid, "name": "Smoke Feature"}, headers=graph_headers, expected=(201,))
    _, artifact = request("POST", "/artifacts", {"featureId": feature["id"], "graphId": gid, "nodeId": first_id, "name": "Smoke Artifact"}, headers=graph_headers, expected=(201,))
    _, artifact_version = request("POST", "/artifact-versions", {"artifactId": artifact["id"], "version": "v2"}, headers=graph_headers, expected=(201,))
    _, fragment = request("POST", "/fragments", {"versionId": artifact_version["id"], "nodeId": second_id, "label": "Smoke Fragment"}, headers=graph_headers, expected=(201,))

    _, review = request("POST", "/reviews", {
        "text": "Smoke review for the edited graph",
        "executorId": service_actor["id"],
        "scope": {
            "projectId": created["projectId"], "epicId": epic["id"], "featureId": feature["id"],
            "artifactId": artifact["id"], "versionId": artifact_version["id"], "fragmentId": fragment["id"],
            "objectId": second_id, "version": "v2"
        }
    }, headers=graph_headers, expected=(201,))
    review_id = review["id"]
    review_scope = review["scopes"][0]
    assert [review_scope[key] for key in ("projectId", "epicId", "featureId", "artifactId", "versionId", "fragmentId")] == [
        created["projectId"], epic["id"], feature["id"], artifact["id"], artifact_version["id"], fragment["id"]
    ]
    request("POST", f"/reviews/{review_id}/votes", {"actorId": service_actor["id"], "vote": "approve", "comment": "Verified"}, headers=graph_headers, expected=(201,))
    _, started_review = request("POST", f"/reviews/{review_id}/transition", {"event": "start"}, headers=graph_headers)
    assert started_review["to"] == "in_review"
    _, approved_review = request("POST", f"/reviews/{review_id}/transition", {"event": "approve"}, headers=graph_headers)
    assert approved_review["to"] == "approved"
    _, review_history = request("GET", f"/reviews/{review_id}/history", headers=graph_headers)
    assert {item["event"] for item in review_history}.issuperset({"created", "vote", "start", "approve"})
    _, reviews = request("GET", "/reviews", headers=graph_headers)
    assert any(item["id"] == review_id and item["status"] == "approved" for item in reviews)
    ok("full Project→Epic→Feature→Artifact→Version→Fragment ReviewScope, voting, FSM and history")

    _, roles = request("GET", "/rbac/roles", headers=create_headers)
    assert {item["name"] for item in roles} == {"viewer", "reviewer", "editor", "workspace_admin"}
    viewer_role = next(item for item in roles if item["name"] == "viewer")
    _, effective = request("GET", f"/rbac/effective?graph_id={gid}", headers=create_headers)
    assert {"graph.read", "graph.write", "review.vote", "rbac.manage", "audit.read"}.issubset(set(effective["permissions"]))
    request("POST", "/rbac/memberships", {"userId": other_auth["user"]["id"], "membershipRole": "member"}, headers=create_headers, expected=(201,))
    request("POST", "/rbac/assignments", {
        "userId": other_auth["user"]["id"], "roleId": viewer_role["id"], "scopeType": "workspace", "scopeId": own_ws
    }, headers=create_headers, expected=(201,))
    viewer_headers = {"Authorization": f"Bearer {other_auth['token']}", "X-Workspace-Id": own_ws, "X-Graph-Id": gid}
    _, viewer_nodes = request("GET", "/graph/nodes", headers=viewer_headers)
    assert any(item["id"] == first_id for item in viewer_nodes)
    request("PATCH", f"/graph/nodes/{first_id}", {"label": "viewer cannot edit"}, headers=viewer_headers, expected=(403,))
    _, acl = request("POST", "/rbac/acl", {
        "objectType": "graph", "objectId": gid, "subjectType": "user", "subjectId": auth["user"]["id"],
        "permission": "graph.write", "effect": "deny"
    }, headers=create_headers, expected=(201,))
    request("PATCH", f"/graph/nodes/{first_id}", {"label": "ACL must block this"}, headers=graph_headers, expected=(403,))
    request("DELETE", f"/rbac/acl/{acl['id']}", headers=create_headers)
    _, after_acl = request("PATCH", f"/graph/nodes/{first_id}", {"label": "Smoke API Gateway v3"}, headers=graph_headers)
    assert after_acl["label"].endswith("v3")
    _, audit_log = request("GET", "/rbac/audit-log", headers=create_headers)
    assert any(item["action"] == "rbac.acl.write" and item["decision"] == "allow" for item in audit_log)
    ok("inherited RBAC matrix, viewer read-only role, object-level deny priority and security audit log")

    _, ai_capabilities = request("GET", "/ai/capabilities")
    assert ai_capabilities["offlineAi"]["classification"] == "optional architecture extension"
    assert ai_capabilities["offlineAi"]["enabled"] is False and ai_capabilities["offlineAi"]["sendsDataExternally"] is False
    ok("Offline AI is explicitly optional, disabled by default and documented by ADR")

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
    assert copilot["conversationId"] and copilot["answerId"] and copilot["usage"]["latencyMs"] >= 0
    _, conversation = request("GET", f"/conversations/{copilot['conversationId']}", headers=graph_headers)
    assert any(item["id"] == copilot["questionId"] for item in conversation["questions"])
    assert any(item["id"] == copilot["answerId"] for item in conversation["answers"])
    assert conversation["reasoning"] and conversation["reasoning"][0]["evidence"]["nodeIds"]
    request("PATCH", f"/answers/{copilot['answerId']}/feedback", {"feedback": "source-aware"}, headers=graph_headers)
    _, decision = request("POST", f"/conversations/{copilot['conversationId']}/decisions", {
        "answerId": copilot["answerId"], "title": "Use graph-aware retrieval", "rationale": "Verified source context"
    }, headers=graph_headers, expected=(201,))
    assert decision["status"] == "proposed"
    ok("Copilot persists Conversation, Question, Answer, Reasoning, Decision and usage feedback")

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

    request("DELETE", f"/programs/{program_id}", headers=create_headers)
    ok("cleanup standalone program")

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
