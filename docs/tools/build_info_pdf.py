#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    KeepTogether, HRFlowable, ListFlowable, ListItem, Preformatted
)

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "info.pdf"
FONT = "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf"
FONT_MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"

pdfmetrics.registerFont(TTFont("Noto", FONT))
pdfmetrics.registerFont(TTFont("NotoB", FONT_BOLD))
pdfmetrics.registerFont(TTFont("Mono", FONT_MONO))

INK = colors.HexColor("#13213A")
MUTED = colors.HexColor("#5B6B82")
BLUE = colors.HexColor("#365CF5")
CYAN = colors.HexColor("#08A9C9")
PALE = colors.HexColor("#EFF4FF")
PALE2 = colors.HexColor("#F4FBFD")
LINE = colors.HexColor("#D9E2F0")
DARK = colors.HexColor("#0D1830")
GOOD = colors.HexColor("#146C43")
WARN = colors.HexColor("#8A5A00")

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="BodyN", fontName="Noto", fontSize=9.2, leading=14, textColor=INK, spaceAfter=7))
styles.add(ParagraphStyle(name="SmallN", fontName="Noto", fontSize=7.9, leading=11.5, textColor=MUTED, spaceAfter=4))
styles.add(ParagraphStyle(name="H1N", fontName="NotoB", fontSize=22, leading=27, textColor=DARK, spaceBefore=4, spaceAfter=12))
styles.add(ParagraphStyle(name="H2N", fontName="NotoB", fontSize=14.5, leading=19, textColor=BLUE, spaceBefore=10, spaceAfter=7))
styles.add(ParagraphStyle(name="H3N", fontName="NotoB", fontSize=10.6, leading=14, textColor=DARK, spaceBefore=6, spaceAfter=4))
styles.add(ParagraphStyle(name="CoverTitle", fontName="NotoB", fontSize=31, leading=36, textColor=colors.white, alignment=TA_LEFT))
styles.add(ParagraphStyle(name="CoverSub", fontName="Noto", fontSize=12.5, leading=18, textColor=colors.HexColor("#D7E0FF")))
styles.add(ParagraphStyle(name="Kicker", fontName="NotoB", fontSize=8.5, leading=11, textColor=CYAN, spaceAfter=7))
styles.add(ParagraphStyle(name="Table", fontName="Noto", fontSize=7.4, leading=10, textColor=INK))
styles.add(ParagraphStyle(name="TableB", fontName="NotoB", fontSize=7.6, leading=10, textColor=DARK))
styles.add(ParagraphStyle(name="Callout", fontName="Noto", fontSize=8.7, leading=13, textColor=INK))
styles.add(ParagraphStyle(name="Mono", fontName="Mono", fontSize=6.8, leading=9.4, textColor=INK))


def esc(text: str) -> str:
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def P(text: str, style="BodyN"):
    return Paragraph(text, styles[style])


def H1(text: str):
    return [P(text, "H1N"), HRFlowable(width="100%", thickness=0.7, color=LINE, spaceAfter=9)]


def H2(text: str):
    return P(text, "H2N")


def H3(text: str):
    return P(text, "H3N")


def bullets(items, level=0):
    return ListFlowable(
        [ListItem(P(item, "BodyN"), leftIndent=8) for item in items],
        bulletType="bullet", start="circle", leftIndent=15 + level * 8, bulletFontName="Noto",
        bulletFontSize=6, bulletColor=BLUE, spaceAfter=6,
    )


def table(rows, widths, header=True, font=7.3):
    cooked = []
    for r, row in enumerate(rows):
        cooked.append([Paragraph(esc(v), ParagraphStyle(
            name=f"t{r}", parent=styles["TableB"] if (header and r == 0) else styles["Table"],
            fontSize=font, leading=font + 3
        )) for v in row])
    t = Table(cooked, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT")
    cmds = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.35, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    if header:
        cmds += [("BACKGROUND", (0, 0), (-1, 0), PALE), ("TEXTCOLOR", (0, 0), (-1, 0), DARK)]
    for r in range(1 if header else 0, len(rows)):
        if r % 2 == 0:
            cmds.append(("BACKGROUND", (0, r), (-1, r), colors.HexColor("#FAFCFF")))
    t.setStyle(TableStyle(cmds))
    return t


def callout(title, text, color=PALE):
    inner = Table([[P(title, "TableB")], [P(text, "Callout")]], colWidths=[166*mm])
    inner.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), color),
        ("BOX", (0, 0), (-1, -1), 0.7, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return inner


def code(text):
    t = Table([[Preformatted(text, styles["Mono"])]], colWidths=[166*mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F6F8FC")),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return t


def header_footer(canvas, doc):
    if doc.page == 1:
        return
    canvas.saveState()
    canvas.setFont("Noto", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(22*mm, 12*mm, "Graph Platform v3 | Product & Technical Handbook")
    canvas.drawRightString(188*mm, 12*mm, f"{doc.page}")
    canvas.setStrokeColor(LINE)
    canvas.line(22*mm, 16*mm, 188*mm, 16*mm)
    canvas.restoreState()


def cover(canvas, doc):
    canvas.saveState()
    w, h = A4
    canvas.setFillColor(DARK)
    canvas.rect(0, 0, w, h, fill=1, stroke=0)
    canvas.setFillColor(colors.HexColor("#182957"))
    canvas.circle(185*mm, 267*mm, 63*mm, fill=1, stroke=0)
    canvas.setFillColor(colors.HexColor("#14375C"))
    canvas.circle(15*mm, 22*mm, 72*mm, fill=1, stroke=0)
    canvas.setFillColor(CYAN)
    canvas.rect(22*mm, 248*mm, 32*mm, 2.1*mm, fill=1, stroke=0)
    canvas.setFont("NotoB", 9)
    canvas.setFillColor(colors.HexColor("#73E0F2"))
    canvas.drawString(22*mm, 257*mm, "GRAPH PLATFORM 3.1.0")
    canvas.setFont("NotoB", 32)
    canvas.setFillColor(colors.white)
    canvas.drawString(22*mm, 217*mm, "Graph Platform v3")
    canvas.setFont("Noto", 15)
    canvas.setFillColor(colors.HexColor("#D7E0FF"))
    canvas.drawString(22*mm, 201*mm, "Product & Technical Handbook")
    canvas.setFont("Noto", 10.5)
    canvas.setFillColor(colors.HexColor("#B9C7EA"))
    lines = [
        "Knowledge graphs. Workflows. RAG. Local AI.",
        "Public read-only domains + protected workspaces.",
        "Redesigned frontend and Admin Console.",
    ]
    y = 178*mm
    for line in lines:
        canvas.drawString(22*mm, y, line); y -= 8*mm
    canvas.setFont("NotoB", 9.5)
    canvas.setFillColor(colors.white)
    canvas.drawString(22*mm, 72*mm, "Документ описывает архитектуру, UX, API, модель доступа,")
    canvas.setFont("Noto", 9.5)
    canvas.drawString(22*mm, 65*mm, "offline AI, данные, сценарии, эксплуатацию и ограничения проекта.")
    canvas.setFillColor(colors.HexColor("#AAB9E4"))
    canvas.setFont("Noto", 8)
    canvas.drawString(22*mm, 35*mm, "Generated from the improved project source | July 2026")
    canvas.restoreState()


def add_section(story, title, intro=None):
    story.extend(H1(title))
    if intro:
        story.append(P(intro))


def build():
    doc = SimpleDocTemplate(
        str(OUT), pagesize=A4, rightMargin=22*mm, leftMargin=22*mm,
        topMargin=22*mm, bottomMargin=22*mm, title="Graph Platform v3 - info",
        author="Graph Platform", subject="Product and technical handbook"
    )
    story = [Spacer(1, 245*mm), PageBreak()]

    add_section(story, "0. Паспорт версии")
    story.append(callout("Graph Platform v3 в одной фразе", "Self-hosted knowledge operating system, где доменные знания, связи, участники, процессы, документы и AI-контекст живут в одном графе, а опубликованные домены можно безопасно читать без регистрации."))
    story.append(Spacer(1, 6))
    story.append(table([
        ["Параметр", "Значение"],
        ["Версия", "3.1.0"],
        ["Frontend", "React 18 + Vite + TypeScript + @xyflow/react + Zustand"],
        ["Backend", "Node.js / Express 4, better-sqlite3, JWT, bcryptjs"],
        ["Offline AI", "Python standard library, Hybrid Offline AI v3"],
        ["Хранилище", "SQLite WAL; graph/workspace scoped schema из 20 таблиц"],
        ["Базовые домены", "Bank и Law, public read-only"],
        ["Внешний LLM", "Опциональный OpenAI-compatible gateway: DeepSeek/OpenAI и совместимые провайдеры"],
        ["Deployment", "Same-origin frontend + /api reverse proxy; Offline AI в private/loopback сети"],
    ], [40*mm, 126*mm]))
    story.append(H2("Что изменилось относительно demo-состояния"))
    story.append(bullets([
        "Frontend перепозиционирован из технического демо в продуктовый dashboard: hero/value proposition, каталог доменов, control center, явный health/status, сильнее визуальная иерархия и AI-подача.",
        "Admin Panel превращён в Admin Console с Overview, Domains, Knowledge Package, Users, AI Ops и System.",
        "Public/private стали частью модели графа: guest читает опубликованные домены, но любые изменения требуют прав.",
        "Регистрация больше не даёт права записи в общий demo-workspace: создаётся персональный workspace.",
        "Backend сведён к одной SQLite connection layer; graph_id проходит через данные, RAG, reviews, bindings и AI history.",
        "Offline AI больше не дописывает случайный char-RNN текст: используется локальный retrieval, graph-context, memory, confidence и sources.",
        "Knowledge Package импорт стал collision-safe: чужие node/edge IDs remap-ятся вместо перезаписи другого домена.",
        "Workspace Library дополнена недостающими endpoints для Actors, templates и независимого clone проекта.",
    ]))

    story.append(PageBreak())
    add_section(story, "1. Продуктовая концепция")
    story.append(P("Платформа отвечает на проблему разрыва между документацией, бизнес-процессами, архитектурой, ролями и AI. Вместо набора несвязанных страниц она представляет организационное знание как живой graph. Node может быть доменом, процессом, системой, артефактом, нормативным объектом или другой сущностью; Edge фиксирует смысловую связь; Actor и Role Bindings показывают ответственность; Work Items связывают знание с исполнением."))
    story.append(H2("Ключевая продуктовая петля"))
    story.append(code("""1. Publish domain -> public knowledge surface\n2. Explore graph -> select node/layer/tab/role\n3. Ask Copilot -> graph + work items + RAG become context\n4. Work in private workspace -> projects, actors, reviews, templates\n5. Govern in Admin Console -> visibility, users, imports, AI history\n6. Export / evolve Knowledge Package -> graph becomes reusable asset"""))
    story.append(H2("Три состояния графа"))
    story.append(table([
        ["Tab", "Смысл", "Типичный вопрос"],
        ["As is", "Фиксация текущей реальности: системы, роли, знания и разрывы", "Что существует сейчас и где проблема?"],
        ["Process", "Путь трансформации, пилоты, перенос знаний, переходные этапы", "Как перейти от текущего к целевому?"],
        ["To be", "Целевая knowledge operating model", "Как должна работать система после изменений?"],
    ], [28*mm, 84*mm, 54*mm]))
    story.append(H2("Почему frontend - важная часть продукта"))
    story.append(P("Главный экран теперь не заставляет пользователя угадывать структуру. Сначала он видит ценность платформы и доступные домены, затем выбирает граф и получает единый control center. Это делает продукт продаваемым не только инженеру, но и владельцу домена, архитектору, юристу, аналитику или руководителю."))

    story.append(PageBreak())
    add_section(story, "2. Архитектура системы")
    story.append(code("""                    +-------------------------------+\n                    | OpenAI-compatible LLM (optional) |\n                    +---------------+---------------+\n                                    ^\n                                    | fallback/primary gateway\n+-------------------+      +--------+--------------------------+\n| React / Vite UI   | ---> | Express API v3                   |\n| Dashboard / Admin | /api | auth, graphs, workspaces, RAG,   |\n+-------------------+      | FSM, ontology, reviews, Copilot  |\n                           +-----+--------------------+---------+\n                                 |                    |\n                       SQLite WAL|                    | HTTP private\n                                 v                    v\n                           +-----------+       +------------------+\n                           | graph.db  |       | Offline AI :5005 |\n                           | 20 tables |       | local-only       |\n                           +-----------+       +------------------+\n"""))
    story.append(H2("Runtime boundary"))
    story.append(bullets([
        "Browser никогда не получает `OFFLINE_AI_KEY`; Copilot вызывается через Backend.",
        "Backend является policy boundary: определяет public/private, membership, role, graph scope и mutation rights.",
        "Offline AI получает уже собранный Backend контекст, поэтому локальный fallback видит тот же активный graph/RAG context, а не только текст вопроса.",
        "SQLite работает через единственный singleton connection, WAL, foreign_keys и busy_timeout; soft migrations поддерживают старые demo базы.",
    ]))
    story.append(H2("Структура репозитория"))
    story.append(code("""frontend/                 React/Vite product UI\n  src/App.tsx             dashboard, routing, graph control center\n  src/components/         FlowCanvas, ChatSidePanel, AdminPage, Library...\nbackend/                  Express API + SQLite\n  src/routes/             auth, public, graphs, graph, rag, copilot, admin...\n  src/db/                 schema, migrations, seed\n  src/engines/            ontology, FSM, LLM gateway\noffline-ai/               zero-dependency local AI HTTP service\nData/                     offline knowledge corpus\ntest/                     zero-dependency API smoke test\ndocs/                     supporting project reports\ninfo.pdf                  this handbook"""))

    story.append(PageBreak())
    add_section(story, "3. Frontend v3 - продаваемый product surface")
    story.append(H2("Главный dashboard"))
    story.append(bullets([
        "Hero объясняет продукт через outcome: знания, процессы и AI в одном живом графе.",
        "Domain catalog визуально разделяет опубликованные области знаний; public-графы доступны до логина.",
        "Graph control center объединяет выбор домена, tabs As is/Process/To be, layers и role projection.",
        "Graph stage остаётся центральным visual object, но окружён ясным продуктовым контекстом, а не набором технических controls.",
        "Health/status, profile/admin navigation и workspace state видны и восстанавливаются после reload.",
        "Frontend создаёт `gp_session` и отправляет `X-Session-Id`, чтобы Copilot history не смешивалась между browser sessions.",
    ]))
    story.append(H2("Graph visualization"))
    story.append(P("`FlowCanvas` использует @xyflow/react. UI поддерживает выделение узлов, inspector, path finder, layer filtering и presentation mode. Backend отдаёт graph-scoped nodes/edges, поэтому визуализация не должна случайно смешивать два домена при выбранном `X-Graph-Id`."))
    story.append(H2("AI UX"))
    story.append(P("`ChatSidePanel` показывает не только текст ответа, но и model/confidence metadata, suggestions и более чистый conversational layout. Внешний LLM не является обязательным: при его отсутствии UI продолжает работать через локальный hybrid engine."))
    story.append(H2("Login и profile"))
    story.append(P("Login screen больше не публикует встроенный admin пароль как часть UI. После reload token проверяется через `/api/auth/me`, затем восстанавливаются user/workspace states. Public catalog остаётся полезным даже без аккаунта, поэтому login - это переход к приватным mutation/workspace возможностям, а не gate перед всей системой."))
    story.append(H2("Runtime config"))
    story.append(code("""window.__GP_CONFIG__ = {\n  API_URL: \"\",             // same-origin /api recommended\n  OFFLINE_AI_URL: \"http://127.0.0.1:5005\",\n  APP_TITLE: \"Graph Platform\"\n};"""))

    story.append(PageBreak())
    add_section(story, "4. Admin Console")
    story.append(P("Admin Console проектировалась как операционная поверхность платформы, а не как набор CRUD-кнопок."))
    story.append(table([
        ["Раздел", "Что даёт"],
        ["Overview", "System summary: users, workspaces, graphs, nodes, edges, documents, questions, public graphs, recent AI activity, rate-limit state."],
        ["Domains", "Create graph, visibility public/private, export/delete, быстрый контроль каталога."],
        ["Knowledge", "Import Knowledge Package; auto-create graph; replace/scoped import; collision-safe remap."],
        ["Users", "Список пользователей, смена global role member/admin, удаление с защитой от self-delete."],
        ["AI Ops", "История вопросов/ответов и model metadata для анализа использования Copilot."],
        ["System", "Health/version/LLM/public-domain mode и operational status."],
    ], [34*mm, 132*mm]))
    story.append(H2("Import integrity"))
    story.append(bullets([
        "Если `graphId` отсутствует, backend создаёт новый graph и slug.",
        "Node IDs, уже занятые в другом graph, получают новый UUID; edges автоматически используют remapped endpoints.",
        "Edge IDs тоже remap-ятся при collision.",
        "Edge отклоняется, если source/target не принадлежат целевому graph.",
        "Replace работает scoped к выбранному graph/workspace, а не как глобальное стирание данных.",
    ]))

    story.append(PageBreak())
    add_section(story, "5. Public/private access model")
    story.append(callout("Главное правило", "Публикация домена открывает только чтение знаний. Права на изменение никогда не выводятся из `visibility=public`; для mutation backend проверяет authenticated workspace access."))
    story.append(Spacer(1, 6))
    story.append(table([
        ["Субъект", "Public read", "Private read", "Workspace write", "Admin ops"],
        ["Guest", "Да", "Нет", "Нет", "Нет"],
        ["Member", "Да", "Только membership", "Только membership", "Нет"],
        ["Global admin", "Да", "Да", "Да", "Да"],
        ["Service API key", "Да", "Да", "Да", "Да"],
    ], [35*mm, 29*mm, 34*mm, 34*mm, 34*mm]))
    story.append(H2("Unauthenticated domain endpoints"))
    story.append(code("""GET /api/public/domains\nGET /api/public/domains/:slug\nGET /api/public/domains/:slug/graph?tab=tobe\nGET /api/graphs                     # guest sees public graphs only\nPOST /api/copilot/chat              # guest may ask within a public graph"""))
    story.append(H2("Почему не открыт write"))
    story.append(P("Публичный knowledge catalog часто нужен для витрины, документации, customer portal или публичного Copilot. Но публикация не должна давать возможность менять ontology, импортировать JSON, добавлять RAG, создавать edges или управлять users. Поэтому read path и mutation path намеренно разделены."))
    story.append(H2("Signup isolation"))
    story.append(P("Self-registration по умолчанию создаёт `ws-<uuid>` с Default First ontology и membership role `admin` внутри собственного workspace, при этом global user role остаётся `member`. Автоматическое вступление в `ws-default` отключено. При необходимости shared onboarding разрешается только через явный `PUBLIC_REGISTRATION_WORKSPACE_ID`."))

    story.append(PageBreak())
    add_section(story, "6. Backend API v3")
    api_rows = [
        ["Surface", "Endpoints", "Access"],
        ["Health", "GET /api/health", "Public"],
        ["Public domains", "GET /api/public/domains; /:slug; /:slug/graph", "Public read-only"],
        ["Auth", "POST /api/auth/register; /login; GET /auth/me", "Register/login public; me JWT"],
        ["Graphs", "GET/POST /api/graphs; PATCH/DELETE /api/graphs/:id", "GET mixed policy; mutations protected"],
        ["Graph data", "GET /api/graph/nodes; /graph/edges; /actors; /work-items; /interest-scope/:actorId", "Public selected graph or workspace member"],
        ["FSM", "GET machines/transitions; POST transition", "Read policy + protected transition"],
        ["Ontology", "GET /api/ontology; POST /ontology/extend", "Public selected graph read; extend protected"],
        ["RAG", "GET documents/search; POST ingest", "JWT + workspace/graph checks"],
        ["Copilot", "POST /api/copilot/chat; GET /copilot/history", "Public graph chat; history protected"],
        ["Reviews", "GET/POST /api/reviews", "Public graph read; write protected"],
        ["Bindings", "GET/POST/DELETE /api/role-bindings", "Public selected graph read; write protected"],
        ["Workspace", "GET/POST /workspaces; actors; projects; templates", "JWT membership"],
        ["Admin", "/api/admin/*", "JWT admin/service"],
        ["Ratings", "GET/POST /api/ratings", "Default product feed public; other workspace protected"],
    ]
    story.append(table(api_rows, [28*mm, 96*mm, 42*mm], font=6.7))
    story.append(H2("Request context headers"))
    story.append(table([
        ["Header", "Назначение"],
        ["Authorization", "Bearer JWT пользователя"],
        ["X-API-Key", "Service access для server-to-server операций"],
        ["X-Workspace-Id", "Выбор workspace; guest header игнорируется, membership проверяется"],
        ["X-Graph-Id", "Активный domain graph для data/RAG/Copilot scope"],
        ["X-Session-Id", "Диалоговая изоляция Copilot"],
    ], [44*mm, 122*mm]))

    story.append(PageBreak())
    add_section(story, "7. Data model")
    story.append(P("Schema содержит 20 таблиц. Основная идея - workspace задаёт tenant boundary, graph задаёт domain boundary, а рабочие сущности при возможности несут `graph_id`."))
    story.append(table([
        ["Группа", "Таблицы", "Роль"],
        ["Tenant/Auth", "workspaces, users, memberships", "Identity и workspace membership"],
        ["Domain", "graphs, ontology", "Публичность, metadata, domain ontology"],
        ["Knowledge", "nodes, edges", "Семантический граф"],
        ["Delivery", "portfolios, projects, work_items, sprints, pipes", "Исполнение и трансформация"],
        ["People", "actors, role_bindings", "Участники и контекстные роли"],
        ["Governance", "reviews, ratings", "Обратная связь и review flow"],
        ["RAG", "documents, chunks", "Документы и retrieval chunks"],
        ["AI", "questions", "История ответа, graph/session context и RAG refs"],
        ["Reuse", "templates", "Замороженные project snapshots"],
    ], [31*mm, 64*mm, 71*mm]))
    story.append(H2("Ключевые invariants"))
    story.append(bullets([
        "Graph belongs to one workspace.",
        "Public visibility разрешает read, но не меняет membership.",
        "Graph-scoped edge должен ссылаться на nodes этого graph.",
        "RAG document/chunk сохраняет workspace_id + graph_id.",
        "Question сохраняет workspace_id + graph_id + session_id, поэтому диалог можно изолировать и анализировать.",
        "Template snapshot копирует данные независимо: node IDs remap-ятся при создании нового проекта.",
    ]))
    story.append(H2("SQLite runtime"))
    story.append(P("`database.js` создаёт одну connection, включает WAL, foreign_keys и busy_timeout. На startup применяется schema и безопасные additive migrations. Для старых demo данных есть ограниченный backfill известных Bank/Law IDs; произвольные customer rows не угадываются и не переносятся между доменами автоматически."))

    story.append(PageBreak())
    add_section(story, "8. Graph Copilot и Offline AI")
    story.append(H2("LLM gateway") )
    story.append(P("`engines/llm.js` сначала использует OpenAI-compatible provider, если задан ключ. В контекст входят выбранный graph, nodes, edges, work items и top RAG chunks. Если внешний provider отсутствует или недоступен, тот же context отправляется в локальный Offline AI. Если и локальный HTTP service недоступен, Backend имеет последний deterministic local fallback."))
    story.append(H2("Offline pipeline") )
    story.append(code("""question\n  -> tokenize + Russian light stemming\n  -> synonym expansion + short-dialog memory\n  -> BM25 over Data/*.txt/*.md\n  -> character trigram fuzzy scoring\n  -> graph-context scoring\n  -> merge + sentence reranking + dedup\n  -> intent answer + grounded extractive synthesis\n  -> confidence + sources + retrieval stats"""))
    story.append(H2("Что делает AI умнее старой версии"))
    story.append(bullets([
        "Контекст выбранного graph поступает в offline fallback так же, как во внешний LLM.",
        "BM25 учитывает частоту терминов и редкость слов, а не только простое совпадение TF-IDF строк.",
        "Char trigrams помогают при неточных формулировках, а light stemming - при русских падежах/окончаниях.",
        "Synonym groups связывают graph/domain/actor/RAG/FSM/security/legal термины.",
        "Session memory используется для коротких follow-up вопросов; анонимные clients без session ID не получают общую историю.",
        "Ответ содержит sources/confidence и не должен придумывать факт, если локальный corpus/context недостаточен.",
        "Случайная char-level RNN генерация удалена как источник недостоверного текста.",
    ]))
    story.append(H2("Privacy") )
    story.append(P("Offline AI запускается на `127.0.0.1:5005` по умолчанию, использует `X-Offline-Key` и не требует внешних Python libraries. Он может полностью работать без интернета. При использовании внешнего LLM context покидает локальную машину согласно политике выбранного провайдера - это отдельное deployment решение."))
    story.append(H2("Корпус") )
    story.append(P("`Data/` содержит архитектуру, слои, actors, work items, review/execution, reporting, security/RBAC, RAG, ontology, transformation, admin, public access v3 и legal domain. Runtime `/reload` перечитывает corpus без переобучения нейросети."))

    story.append(PageBreak())
    add_section(story, "9. Workspace Library и reusable delivery")
    story.append(P("Workspace Library связывает knowledge model с реальной работой. Проект может иметь actors через role bindings, быть заморожен в template и затем клонирован как независимый новый project."))
    story.append(H2("Template flow"))
    story.append(code("""Project\n  -> snapshot selected project's nodes + internal edges + work items + ontology\n  -> Template v1\n  -> POST /api/projects { templateId }\n  -> create new Project\n  -> remap every node id\n  -> recreate only internal edges with new endpoints\n  -> recreate work items with remapped relatedNodeIds"""))
    story.append(P("Candidate actors для `unassigned_to=<projectId>` дополнительно фильтруются по graph проекта, поэтому actor другого domain не предлагается случайно. Backend всё равно повторно валидирует graph/workspace при записи binding."))

    story.append(PageBreak())
    add_section(story, "10. Security model")
    story.append(table([
        ["Контроль", "Реализация"],
        ["Password storage", "bcryptjs; cost 12 production, 10 development"],
        ["JWT", "HS256, configurable expiry (default 24h), production secret required"],
        ["Service auth", "X-API-Key; production value required"],
        ["Tenant isolation", "memberships + workspace validation"],
        ["Domain isolation", "graph visibility + graph.workspace_id + graph-scoped queries"],
        ["Public surface", "read-only published domains"],
        ["Mutation", "authRequired + membership/admin checks"],
        ["Input limits", "Express JSON size, chat validation, offline body/message limits"],
        ["Rate limiting", "endpoint-aware in-memory rate limiter"],
        ["Headers", "security headers, no powered-by, no-store where appropriate"],
        ["Offline AI", "loopback default + service key + max body"],
    ], [46*mm, 120*mm]))
    story.append(H2("Production requirements"))
    story.append(bullets([
        "Use HTTPS at reverse proxy. README demo HTTP URLs are for local development only.",
        "Set strong JWT_SECRET, API_KEY, OFFLINE_AI_KEY and ADMIN_INITIAL_PASSWORD before first production bootstrap.",
        "Restrict CORS to trusted origins and set TRUST_PROXY correctly behind a proxy.",
        "Do not expose port 5005 publicly; keep Offline AI on loopback/private network.",
        "Back up SQLite correctly with WAL awareness and verify restore procedures.",
        "For high write concurrency or multi-node deployment, migrate repository layer to PostgreSQL; HoneyORM file is an archived concept, not an active production adapter.",
    ]))
    story.append(callout("Security boundary", "Нельзя считать frontend проверку прав security-механизмом. Все критические решения выполняются Backend: visibility, workspace membership, graph ownership, admin role и cross-domain integrity.", PALE2))

    story.append(PageBreak())
    add_section(story, "11. Knowledge Package format")
    story.append(P("Knowledge Package нужен для обмена domain model с AI/другими системами, резервного переноса или создания нового домена из JSON."))
    story.append(code("""{\n  \"name\": \"My Domain\",\n  \"slug\": \"my-domain\",\n  \"description\": \"...\",\n  \"visibility\": \"private\",\n  \"ontology\": { ... },\n  \"nodes\": [\n    {\"id\":\"root\",\"label\":\"Root\",\"layer\":\"Knowledge\",\"nodeKind\":\"domain\"}\n  ],\n  \"edges\": [\n    {\"id\":\"e1\",\"source\":\"root\",\"target\":\"child\",\"label\":\"CONTAINS\"}\n  ]\n}"""))
    story.append(P("Import endpoint проверяет workspace, graph ownership, duplicate IDs внутри пакета и endpoints edges. Collision с ID другого graph не уничтожает чужие данные: создаётся новый UUID и mapping применяется к edge endpoints."))

    story.append(PageBreak())
    add_section(story, "12. Запуск и эксплуатация")
    story.append(H2("Development"))
    story.append(code("""# Backend\ncd backend\ncp .env.example .env\nnpm ci\nnpm run dev\n\n# Offline AI\ncd offline-ai\npython3 server.py\n\n# Frontend\ncd frontend\nnpm ci\nnpm run dev -- --host 0.0.0.0"""))
    story.append(H2("Seed") )
    story.append(P("На пустой development DB создаются Bank и Law, demo workspace и локальный admin `admin@graph.local`. Development bootstrap password - `Admin1234!`. В production seed требует `ADMIN_INITIAL_PASSWORD`, поэтому этот demo пароль не становится production default."))
    story.append(H2("Environment") )
    story.append(table([
        ["Переменная", "Назначение"],
        ["PORT", "Backend port, default 3001"],
        ["NODE_ENV", "development / production"],
        ["JWT_SECRET", "JWT signing secret; mandatory production"],
        ["JWT_EXPIRY", "Token lifetime"],
        ["API_KEY", "Service API key; mandatory production"],
        ["ADMIN_INITIAL_PASSWORD", "Initial admin bootstrap on empty production DB"],
        ["PUBLIC_REGISTRATION_WORKSPACE_ID", "Optional explicit shared signup workspace"],
        ["CORS_ORIGINS", "Allowed browser origins"],
        ["TRUST_PROXY", "Reverse proxy behavior"],
        ["SQLITE_PATH", "Custom graph.db path"],
        ["OPENAI_API_KEY / DEEPSEEK_API_KEY", "Optional external LLM"],
        ["OPENAI_BASE_URL / MODEL", "OpenAI-compatible provider config"],
        ["OFFLINE_AI_URL / KEY", "Local AI service URL and secret"],
    ], [63*mm, 103*mm], font=6.7))
    story.append(KeepTogether([
        H2("Recommended production topology"),
        code("""Internet
  -> HTTPS reverse proxy
       -> static frontend/dist
       -> /api -> Backend :3001
                    -> SQLite volume
                    -> Offline AI 127.0.0.1:5005
                    -> External LLM only when policy allows""")
    ]))

    add_section(story, "13. Проверки, выполненные при доработке")
    story.append(table([
        ["Проверка", "Результат"],
        ["Backend JavaScript syntax", "Все active backend/src/*.js проходят `node --check`."],
        ["Frontend TypeScript", "`tsc --noEmit` проходит после redesign и session patch."],
        ["Offline AI syntax", "`python3 -m py_compile` проходит."],
        ["Offline HTTP", "Health=200; bad key=401; chat возвращает hybrid model, confidence, sources."],
        ["Guest catalog", "Bank/Law и другие public graphs читаются без token."],
        ["Guest mutation", "POST graph отклоняется 401."],
        ["Signup isolation", "Новый user получает personal workspace, public graphs canEdit=false."],
        ["Cross-workspace write", "Попытка patch Bank новым member отклоняется 403."],
        ["RAG", "Ingest/search сохраняют active graph_id."],
        ["Template clone", "Snapshot клонирует nodes/edges независимо с remap IDs."],
        ["Import collisions", "Node/edge collisions remap; исходный Bank node не перезаписывается."],
        ["Cross-domain edge", "Admin edge между узлами разных graphs отклоняется 400."],
        ["Copilot E2E", "Backend -> Offline AI получает Bank graph/RAG context и session ID."],
        ["API smoke", "Standard-library test/smoke.py проходит полный основной сценарий."],
    ], [48*mm, 118*mm], font=6.8))
    story.append(H2("Build environment caveat") )
    story.append(P("Production Vite build в текущем sandbox не был повторно завершён не из-за TypeScript/source error, а из-за платформенного `node_modules` исходного ZIP: в нём отсутствует Linux optional package `@rollup/rollup-linux-x64-gnu`. Попытка clean dependency install упиралась во временно недоступный package registry. TypeScript check проходит. На нормальной Linux/CI машине после `npm ci` Vite должен получить корректный Rollup binary; это следует подтвердить в вашем CI перед релизом."))

    story.append(PageBreak())
    add_section(story, "14. Ограничения и roadmap")
    story.append(P("V3 значительно взрослее исходного проекта, но несколько границ важно понимать честно."))
    story.append(table([
        ["Сейчас", "Что делать при росте"],
        ["SQLite single-node", "Для multi-node/high-write нагрузки перейти на PostgreSQL repository adapter."],
        ["In-memory rate limiter", "В cluster deployment вынести counters в Redis/gateway/WAF."],
        ["Offline AI retrieval/extractive", "Для сложного generative reasoning использовать локальную LLM или OpenAI-compatible provider с policy controls."],
        ["Global admin role", "В enterprise варианте разделить platform admin и tenant admin permissions."],
        ["Knowledge Package JSON", "Добавить formal JSON Schema/version migration/signing для межсистемного обмена."],
        ["Operational telemetry", "Добавить structured logs, metrics, traces, alerting, audit log."],
        ["SQLite migrations", "Перевести soft additive migrations в versioned migration runner перед крупной схемой."],
    ], [65*mm, 101*mm]))
    story.append(H2("Roadmap приоритет") )
    story.append(bullets([
        "P1: CI pipeline: clean npm ci, typecheck, Vite build, backend smoke, security tests.",
        "P1: formal audit log для admin/mutations и export/import events.",
        "P1: PostgreSQL adapter + versioned migrations для production scale-out.",
        "P2: richer local embeddings/LLM, если deployment допускает локальную модель большего размера.",
        "P2: tenant admin roles, invitations, password reset/email verification.",
        "P2: signed/versioned Knowledge Package schema и validation report в Admin Console.",
    ]))
    story.append(callout("Итог", "Graph Platform v3 уже имеет цельную продуктовую модель: public knowledge surface, private workspaces, graph-aware backend, reusable projects/templates, Admin Console и локальный AI. Следующий уровень зрелости - CI, auditability, PostgreSQL/Redis scale-out и enterprise identity lifecycle."))

    story.append(PageBreak())
    add_section(story, "15. Краткая карта файлов")
    story.append(table([
        ["Файл/директория", "Зачем нужен"],
        ["frontend/src/App.tsx", "Главный product dashboard, app state, API headers, page/hash navigation."],
        ["frontend/src/components/AdminPage.tsx", "Admin Console."],
        ["frontend/src/components/ChatSidePanel.tsx", "Graph Copilot UX."],
        ["frontend/src/components/FlowCanvas.tsx", "Graph visualization."],
        ["backend/src/index.js", "Express composition/root routes/health."],
        ["backend/src/utils/helper.js", "Unified DB, workspace/graph access helpers, chunk/token utilities."],
        ["backend/src/db/database.js", "SQLite singleton, schema, WAL, migrations."],
        ["backend/src/db/schema.sql", "20-table relational schema."],
        ["backend/src/routes/public.js", "Unauthenticated published-domain API."],
        ["backend/src/routes/graphs.js", "Graph catalog/CRUD and visibility."],
        ["backend/src/routes/graph.js", "Nodes/edges/actors/work-items/interest scope."],
        ["backend/src/routes/auth.js", "Login/register/me and isolated signup."],
        ["backend/src/routes/admin.js", "Admin summary/users/import/graph editing."],
        ["backend/src/routes/workspaces.js", "Workspace, projects, actor candidates, templates/cloning."],
        ["backend/src/routes/rag.js", "Graph-aware document ingest/search."],
        ["backend/src/routes/copilot.js", "Context builder, RAG, history/session, LLM/offline response."],
        ["backend/src/engines/llm.js", "External LLM + Offline AI gateway."],
        ["offline-ai/rnn_model.py", "Hybrid local retrieval/synthesis engine; legacy filename retained."],
        ["offline-ai/server.py", "Zero-dependency private HTTP service."],
        ["Data/", "Local knowledge corpus."],
        ["test/smoke.py", "No-dependency API smoke test."],
        ["DEPLOY.md", "Production topology and deployment guidance."],
    ], [62*mm, 104*mm], font=6.7))
    story.append(Spacer(1, 10))
    story.append(P("Конец документа. Источником истины для конкретного поведения остаётся код текущей версии 3.1.0 и `backend/src/db/schema.sql`.", "SmallN"))

    doc.build(story, onFirstPage=cover, onLaterPages=header_footer)
    print(OUT)


if __name__ == "__main__":
    build()
