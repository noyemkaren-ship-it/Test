"""Graph Platform Offline Intelligence v3.

A deterministic, fully local assistant optimized for a small/medium knowledge corpus.
It combines BM25 lexical retrieval, fuzzy character n-gram matching, synonym expansion,
conversation memory, graph-context reranking and extractive answer synthesis.

The legacy file name is kept for backwards compatibility; the assistant no longer uses
char-RNN text generation as the primary answer source because random generation reduced
answer quality and trustworthiness.
"""
from __future__ import annotations

import math
import os
import re
import threading
from collections import Counter, defaultdict, deque
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

DATA_DIR = Path(os.environ.get("GP_DATA_DIR", Path(__file__).resolve().parents[1] / "Data"))

WORD_RE = re.compile(r"[a-zA-Zа-яА-ЯёЁ0-9_\-]+", re.UNICODE)
SENTENCE_RE = re.compile(r"(?<=[.!?])\s+|\n+")

SYNONYM_GROUPS = [
    {"граф", "graph", "knowledge", "знания", "онтология", "ontology", "семантика"},
    {"домен", "domain", "область", "направление"},
    {"interest", "scope", "интерес", "контекст", "projection", "проекция"},
    {"control", "контроль", "governance", "кс", "delta", "валидация"},
    {"pipe", "pipeline", "flow", "поток", "процесс", "workflow"},
    {"actor", "актор", "роль", "role", "участник", "participant"},
    {"owner", "владелец", "заказчик", "ответственный", "responsible"},
    {"rag", "retrieval", "поиск", "документ", "chunk", "индексация"},
    {"fsm", "state", "статус", "переход", "lifecycle", "жизненный"},
    {"workspace", "tenant", "тенант", "пространство", "среда"},
    {"admin", "админ", "панель", "dashboard", "управление"},
    {"security", "безопасность", "auth", "jwt", "token", "доступ"},
    {"api", "endpoint", "rest", "интерфейс"},
    {"legal", "юридический", "юрист", "law", "case", "дело", "суд"},
    {"public", "публичный", "анонимный", "guest", "гость", "без", "авторизации"},
]

SYNONYMS: Dict[str, set[str]] = {}
for group in SYNONYM_GROUPS:
    for token in group:
        SYNONYMS[token] = set(group)

STOPWORDS = {
    "и", "в", "во", "на", "по", "с", "со", "к", "из", "для", "что", "как", "это", "а", "но", "или",
    "the", "a", "an", "to", "of", "in", "on", "for", "and", "or", "is", "are", "how", "what",
    "мне", "про", "об", "обо", "же", "ли", "бы", "у", "не", "да", "при", "от"
}

INTENTS = {
    "greeting": ("привет", "здравствуй", "добрый день", "hello", "hi"),
    "identity": ("кто ты", "ты кто", "представься", "who are you"),
    "architecture": ("архитектура", "как устроен", "как работает платформа", "architecture"),
    "domains": ("домен", "домены", "domain", "domains"),
    "security": ("безопас", "авторизац", "jwt", "access", "security", "доступ", "public", "публич"),
    "admin": ("админ", "admin", "панель управления"),
    "legal": ("юрид", "legal", "law", "судеб", "доказательств", "legislation"),
}

INTENT_ANSWERS = {
    "greeting": "Привет! Я локальный Graph Copilot. Работаю полностью офлайн и могу отвечать по графу, RAG-корпусу, архитектуре, доменам, ролям, FSM и админке.",
    "identity": "Я локальный Graph Copilot v3: гибридный retrieval-ассистент без отправки данных наружу. Я ранжирую знания из Data/, контекст текущего графа и недавний диалог, а затем собираю проверяемый ответ с источниками.",
    "domains": "Домен в Graph Platform — самостоятельный опубликованный или приватный граф знаний со своей онтологией, узлами, связями и AI-контекстом.",
    "security": "Публичное чтение и административные изменения разделены: опубликованные домены можно читать без входа, а запись, управление пользователями, импорт и приватные workspace требуют авторизации и прав.",
    "admin": "Админ-панель предназначена для управления доменами, видимостью, импортом Knowledge Package, пользователями и историей AI-запросов. Все изменяющие операции защищены.",
    "legal": "Юридический домен связывает дело, участников, суд, события, факты, документы, доказательства, требования, аргументы, нормы, судебную практику, стратегию, риски и сроки в одном проверяемом графе.",
}


RU_SUFFIXES = (
    "иями", "ями", "ами", "ого", "ему", "ому", "ыми", "ими", "иях", "ах", "ях",
    "ый", "ий", "ая", "ое", "ые", "ую", "юю", "ом", "ем", "ов", "ев", "ам", "ям",
    "а", "я", "ы", "и", "е", "у", "ю"
)


def light_stem(token: str) -> str:
    """Small deterministic stemmer for Russian case/adjective forms used in the local corpus."""
    t = token.lower()
    if not re.search(r"[а-яё]", t):
        if len(t) > 5 and t.endswith("s"):
            return t[:-1]
        return t
    for suffix in RU_SUFFIXES:
        if len(t) - len(suffix) >= 4 and t.endswith(suffix):
            return t[:-len(suffix)]
    return t


def tokenize(text: str) -> List[str]:
    tokens: List[str] = []
    for raw in WORD_RE.findall(text or ""):
        token = raw.lower()
        if len(token) <= 1 or token in STOPWORDS:
            continue
        tokens.append(token)
        stem = light_stem(token)
        if stem != token and stem not in STOPWORDS:
            tokens.append(stem)
    return tokens


def char_ngrams(text: str, n: int = 3) -> set[str]:
    normalized = re.sub(r"\s+", " ", (text or "").lower().strip())
    if len(normalized) < n:
        return {normalized} if normalized else set()
    return {normalized[i:i+n] for i in range(len(normalized) - n + 1)}


def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / max(1, len(a | b))


def compact(text: str, limit: int = 420) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


@dataclass
class Passage:
    id: str
    source: str
    text: str
    tokens: List[str]
    token_counts: Counter
    length: int
    trigrams: set[str]


class HybridOfflineAssistant:
    model_name = "offline-hybrid-rag-v3"

    def __init__(self) -> None:
        self.passages: List[Passage] = []
        self.corpus = ""
        self.paragraphs: List[str] = []
        self.doc_freq: Counter = Counter()
        self.avg_len = 1.0
        self.vocab_size = 0
        self.sessions: Dict[str, deque[Tuple[str, str]]] = defaultdict(lambda: deque(maxlen=6))
        self._lock = threading.RLock()
        self.reload()

    def _split_text(self, source: str, text: str) -> Iterable[Tuple[str, str]]:
        blocks = [b.strip() for b in re.split(r"\n\s*\n+", text) if len(b.strip()) > 20]
        for idx, block in enumerate(blocks):
            if len(block) <= 900:
                yield f"{source}:{idx}", block
                continue
            sentences = [s.strip() for s in SENTENCE_RE.split(block) if s.strip()]
            chunk: List[str] = []
            size = 0
            part = 0
            for sentence in sentences:
                if chunk and size + len(sentence) > 850:
                    yield f"{source}:{idx}.{part}", " ".join(chunk)
                    part += 1
                    chunk, size = [], 0
                chunk.append(sentence)
                size += len(sentence) + 1
            if chunk:
                yield f"{source}:{idx}.{part}", " ".join(chunk)

    def reload(self) -> Dict:
        with self._lock:
            self.passages = []
            self.doc_freq = Counter()
            texts: List[str] = []
            if DATA_DIR.exists():
                paths = sorted([*DATA_DIR.glob("*.txt"), *DATA_DIR.glob("*.md")])
            else:
                paths = []
            for path in paths:
                raw = path.read_text(encoding="utf-8", errors="ignore").strip()
                if not raw:
                    continue
                texts.append(raw)
                for pid, block in self._split_text(path.name, raw):
                    toks = tokenize(block)
                    if not toks:
                        continue
                    passage = Passage(
                        id=pid,
                        source=path.name,
                        text=block,
                        tokens=toks,
                        token_counts=Counter(toks),
                        length=len(toks),
                        trigrams=char_ngrams(block),
                    )
                    self.passages.append(passage)
                    self.doc_freq.update(set(toks))
            self.corpus = "\n\n".join(texts)
            self.paragraphs = [p.text for p in self.passages]
            self.avg_len = sum(p.length for p in self.passages) / max(1, len(self.passages))
            self.vocab_size = len(self.doc_freq)
            return {
                "loaded": True,
                "corpus_chars": len(self.corpus),
                "paragraphs": len(self.passages),
                "vocab": self.vocab_size,
                "engine": self.model_name,
            }

    def load_or_train(self, steps: int = 0) -> Dict:  # compatibility with old API
        del steps
        return self.reload()

    def _expand(self, query: str, memory: Sequence[Tuple[str, str]] = ()) -> List[str]:
        base = tokenize(query)
        expanded = list(base)
        for token in base:
            expanded.extend(SYNONYMS.get(token, ()))
        # Pronoun/continuation questions benefit from recent user context.
        lower = query.lower()
        if len(base) < 5 or any(x in lower for x in ("это", "он", "она", "они", "там", "подробнее", "а как", "почему")):
            for previous_q, _ in list(memory)[-2:]:
                expanded.extend(tokenize(previous_q)[:10])
        return list(dict.fromkeys(t for t in expanded if t not in STOPWORDS))

    def _idf(self, term: str) -> float:
        n = len(self.passages)
        df = self.doc_freq.get(term, 0)
        return math.log(1 + (n - df + 0.5) / (df + 0.5)) if n else 0.0

    def _bm25(self, passage: Passage, terms: Sequence[str]) -> float:
        k1, b = 1.45, 0.72
        score = 0.0
        for term in terms:
            tf = passage.token_counts.get(term, 0)
            if not tf:
                continue
            denom = tf + k1 * (1 - b + b * passage.length / max(self.avg_len, 1))
            score += self._idf(term) * (tf * (k1 + 1) / denom)
        return score

    def _score_text(self, text: str, terms: Sequence[str], query_trigrams: set[str]) -> float:
        tokens = tokenize(text)
        if not tokens:
            return 0.0
        counts = Counter(tokens)
        exact = sum(1.0 + math.log1p(counts[t]) for t in terms if counts.get(t))
        coverage = len(set(terms) & set(tokens)) / max(1, len(set(terms)))
        fuzzy = jaccard(query_trigrams, char_ngrams(text))
        return exact + 2.8 * coverage + 1.6 * fuzzy

    def retrieve(self, query: str, k: int = 6, memory: Sequence[Tuple[str, str]] = ()) -> List[Dict]:
        terms = self._expand(query, memory)
        qgrams = char_ngrams(query)
        scored = []
        for passage in self.passages:
            bm = self._bm25(passage, terms)
            coverage = len(set(terms) & set(passage.tokens)) / max(1, len(set(terms)))
            fuzzy = jaccard(qgrams, passage.trigrams)
            phrase = 1.2 if query.lower().strip() and query.lower().strip() in passage.text.lower() else 0.0
            score = bm + 3.0 * coverage + 1.8 * fuzzy + phrase
            if score > 0.18:
                scored.append((score, passage))
        scored.sort(key=lambda item: item[0], reverse=True)
        if not scored:
            return []
        top = scored[:k]
        max_score = max(v for v, _ in top) or 1.0
        return [
            {
                "id": p.id,
                "source": p.source,
                "text": p.text,
                "score": round(score, 4),
                "confidence": round(min(1.0, score / max_score), 3),
            }
            for score, p in top
        ]

    def _context_hits(self, query: str, context: str, k: int = 5) -> List[Dict]:
        if not context.strip():
            return []
        terms = self._expand(query)
        qgrams = char_ngrams(query)
        pieces = [p.strip(" -•\t") for p in context.splitlines() if len(p.strip()) > 12]
        scored = [(self._score_text(piece, terms, qgrams), piece) for piece in pieces]
        scored = [(s, p) for s, p in scored if s > 0.15]
        scored.sort(reverse=True, key=lambda x: x[0])
        return [
            {"id": f"graph:{i}", "source": "graph-context", "text": piece, "score": round(score, 4)}
            for i, (score, piece) in enumerate(scored[:k])
        ]

    def _detect_intent(self, query: str) -> Optional[str]:
        q = query.lower()
        # Security/admin are intentionally checked before the broad architecture intent.
        # This keeps questions such as “как устроен публичный доступ” from being
        # misclassified just because they contain “как устроен”.
        priority = ("greeting", "identity", "security", "admin", "legal", "domains", "architecture")
        for intent in priority:
            if any(pattern in q for pattern in INTENTS[intent]):
                return intent
        return None

    def _best_sentences(self, query: str, hits: Sequence[Dict], limit: int = 4) -> List[str]:
        terms = self._expand(query)
        qgrams = char_ngrams(query)
        candidates: List[Tuple[float, str]] = []
        for rank, hit in enumerate(hits):
            text = hit["text"]
            sentences = [s.strip(" •-\t") for s in SENTENCE_RE.split(text) if len(s.strip()) > 25]
            if not sentences:
                sentences = [text]
            for sentence in sentences:
                score = self._score_text(sentence, terms, qgrams) + max(0, 1.2 - rank * 0.14)
                candidates.append((score, sentence))
        candidates.sort(key=lambda x: x[0], reverse=True)
        chosen: List[str] = []
        chosen_grams: List[set[str]] = []
        for score, sentence in candidates:
            if score <= 0:
                continue
            grams = char_ngrams(sentence)
            if any(jaccard(grams, old) > 0.72 for old in chosen_grams):
                continue
            chosen.append(compact(sentence, 360))
            chosen_grams.append(grams)
            if len(chosen) >= limit:
                break
        return chosen

    def _followup(self, intent: Optional[str], hits: Sequence[Dict]) -> str:
        if intent == "domains":
            return "Можно спросить про конкретный домен, его узлы или отличие public/private доступа."
        if intent == "security":
            return "Можно отдельно разобрать JWT, публичные read-only endpoints или права админа."
        if intent == "legal":
            return "Можно спросить про Legal Case, доказательства, требования, нормы, риски или судебную практику."
        if hits:
            return "Могу раскрыть любой из найденных пунктов подробнее или связать его с текущими узлами графа."
        return "Попробуйте назвать домен, сущность, роль, процесс или узел графа точнее."

    def answer(self, question: str, context: str = "", session_id: str = "default", history: Optional[List[Dict]] = None) -> Dict:
        q = (question or "").strip()
        if not q:
            return {"answer": "Нужен вопрос.", "model": self.model_name, "confidence": 0.0, "sources": []}

        with self._lock:
            memory = list(self.sessions[session_id])
        if history:
            for item in history[-4:]:
                if item.get("role") == "user" and item.get("content"):
                    memory.append((str(item["content"]), ""))

        corpus_hits = self.retrieve(q, k=6, memory=memory)
        context_hits = self._context_hits(q, context, k=5)
        merged = context_hits + corpus_hits
        intent = self._detect_intent(q)
        facts = self._best_sentences(q, merged, limit=4)

        sections: List[str] = []
        if intent in INTENT_ANSWERS:
            sections.append(INTENT_ANSWERS[intent])
        if facts:
            heading = "По текущему графу и базе знаний:" if context_hits else "По локальной базе знаний:"
            sections.append(heading + "\n" + "\n".join(f"• {fact}" for fact in facts))
        if not sections:
            sections.append(
                "В локальном индексе недостаточно данных для уверенного ответа. Я не буду придумывать факты. "
                "Уточните сущность или добавьте материал в Data/ либо RAG текущего графа."
            )

        top_scores = [h.get("score", 0.0) for h in merged[:4]]
        raw_confidence = (sum(top_scores) / max(1, len(top_scores))) if top_scores else (1.5 if intent else 0.0)
        confidence = max(0.08 if intent else 0.0, min(0.98, 1 - math.exp(-raw_confidence / 4.0)))
        answer = "\n\n".join(sections) + "\n\n" + self._followup(intent, merged)

        with self._lock:
            self.sessions[session_id].append((q, compact(answer, 500)))

        sources = [
            {"id": h["id"], "source": h["source"], "excerpt": compact(h["text"], 220), "score": h.get("score")}
            for h in merged[:6]
        ]
        return {
            "answer": answer,
            "model": self.model_name,
            "usedExternal": False,
            "fallback": True,
            "confidence": round(confidence, 3),
            "sources": sources,
            "intent": intent,
            "retrieval": {"graphHits": len(context_hits), "corpusHits": len(corpus_hits)},
        }


AdvancedRNN = HybridOfflineAssistant
CharRNN = HybridOfflineAssistant  # legacy import compatibility
_model: Optional[HybridOfflineAssistant] = None


def get_model() -> HybridOfflineAssistant:
    global _model
    if _model is None:
        _model = HybridOfflineAssistant()
    return _model
