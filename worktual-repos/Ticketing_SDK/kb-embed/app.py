"""Standalone KB embed service: extract PDF text, format one article, upsert Meilisearch."""

from __future__ import annotations

import logging
import os
import re
import threading
from typing import Optional

import meilisearch
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from embeddings import embed_texts, pick_top_index, rerank_texts
from extract_text import ExtractError, extract_file_text
from formatter import MODULE
from structure import format_structured_article

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger("kb-embed")

MEILI_URL = os.getenv("MEILI_URL", "http://127.0.0.1:7700")
MEILI_KEY = os.getenv("MEILI_KEY", "")
KB_EMBED_TOKEN = os.getenv("KB_EMBED_TOKEN", "").strip()
EMBEDDER_NAME = "my_local_embedder"
EMBED_DIMS = int(os.getenv("EMBED_DIMS", "1024"))
SEARCH_RETRIEVE_LIMIT = 10

app = FastAPI(title="Ticketing KB embed")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_meili_client: Optional[meilisearch.Client] = None
_configured_indexes: set[str] = set()
_index_lock = threading.Lock()


class IngestArticleRequest(BaseModel):
    organization_id: str
    article_id: str
    title: str
    content: str


class DeleteDocumentRequest(BaseModel):
    organization_id: str
    article_id: str


class SearchRequest(BaseModel):
    organization_id: str
    query: str
    limit: int | None = None


def require_service_token(authorization: Optional[str] = Header(default=None)) -> None:
    if not KB_EMBED_TOKEN:
        return
    if authorization != f"Bearer {KB_EMBED_TOKEN}":
        raise HTTPException(status_code=401, detail="Unauthorized")


def _safe_id(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9\-_]", "_", value)[:511]


def _index_uid(organization_id: str) -> str:
    org = str(organization_id or "").strip().lower()
    if not org:
        raise HTTPException(status_code=400, detail="organization_id is required")
    return _safe_id(f"{org}_{MODULE}")


def get_meili_client() -> meilisearch.Client:
    global _meili_client
    if _meili_client is None:
        _meili_client = meilisearch.Client(MEILI_URL, MEILI_KEY or None)
    return _meili_client


def wait_task(task_uid: int, label: str = "task", timeout: int = 3_600_000) -> None:
    result = get_meili_client().wait_for_task(task_uid, timeout_in_ms=timeout)
    if result.status == "failed":
        raise RuntimeError(f"[{label}] Meilisearch task failed: {result.error}")


def _configure_index(index, uid: str) -> None:
    task = index.update_filterable_attributes(
        ["article_id", "organization_id", "module"]
    )
    wait_task(task.task_uid, label=f"{uid}_filterable")
    task = index.update_searchable_attributes(["text", "title", "symptoms", "steps"])
    wait_task(task.task_uid, label=f"{uid}_searchable")
    task = index.update_settings(
        {
            "embedders": {
                EMBEDDER_NAME: {"source": "userProvided", "dimensions": EMBED_DIMS}
            },
            "pagination": {"maxTotalHits": 10_000},
        }
    )
    wait_task(task.task_uid, label=f"{uid}_settings")


def get_or_create_index(organization_id: str):
    uid = _index_uid(organization_id)
    client = get_meili_client()
    if uid not in _configured_indexes:
        with _index_lock:
            if uid not in _configured_indexes:
                try:
                    client.get_index(uid)
                except Exception:
                    task = client.create_index(uid, {"primaryKey": "id"})
                    wait_task(task.task_uid, label=f"create_index_{uid}")
                index = client.index(uid)
                _configure_index(index, uid)
                _configured_indexes.add(uid)
    return client.index(uid)


def delete_article_docs(organization_id: str, article_id: str) -> None:
    index = get_or_create_index(organization_id)
    meili_filter = f'article_id = "{article_id}"'
    try:
        task = index.delete_documents_by_filter(meili_filter)
    except Exception:
        task = index.delete_documents(filter=meili_filter)
    wait_task(task.task_uid, label=f"delete_{article_id}")


def _hit_blob(row: dict) -> str:
    parts = [str(row.get("title") or "").strip()]
    symptoms = row.get("symptoms")
    if isinstance(symptoms, list):
        parts.extend(str(s).strip() for s in symptoms if str(s).strip())
    steps = row.get("steps")
    if isinstance(steps, list):
        parts.extend(str(s).strip() for s in steps if str(s).strip())
    text = str(row.get("text") or "").strip()
    if text:
        parts.append(text)
    return ". ".join(p for p in parts if p)


def compact_search_hit(row: dict, score: float) -> dict[str, object]:
    symptoms = row.get("symptoms") if isinstance(row.get("symptoms"), list) else []
    steps = row.get("steps") if isinstance(row.get("steps"), list) else []
    return {
        "article_id": str(row.get("article_id") or row.get("id") or "").strip(),
        "title": str(row.get("title") or "").strip(),
        "symptoms": [str(s).strip() for s in symptoms if str(s).strip()],
        "steps": [str(s).strip() for s in steps if str(s).strip()],
        "text": str(row.get("text") or "").strip(),
        "score": round(float(score), 4),
    }


def pick_reranked_hit(query: str, rows: list[dict]) -> dict[str, object] | None:
    if not rows:
        return None
    blobs = [_hit_blob(row) for row in rows]
    idx = 0
    score = float(rows[0].get("_rankingScore") or rows[0].get("score") or 1.0)
    try:
        ranked = rerank_texts(query, blobs)
        picked = pick_top_index(ranked)
        if picked is not None and 0 <= picked < len(rows):
            idx = picked
            score = ranked[0][1] if ranked else score
    except Exception as exc:
        logger.warning("rerank unavailable, using top Meili hit: %s", exc)
    if idx < 0 or idx >= len(rows):
        return None
    return compact_search_hit(rows[idx], score)


def search_meili_hits(organization_id: str, query: str) -> list[dict]:
    index = get_or_create_index(organization_id)
    try:
        vectors = embed_texts([query])
        params: dict[str, object] = {
            "limit": SEARCH_RETRIEVE_LIMIT,
            "hybrid": {"semanticRatio": 0.7, "embedder": EMBEDDER_NAME},
            "vector": vectors[0],
        }
        result = index.search(query, params)
    except Exception as exc:
        logger.warning("hybrid search failed, keyword fallback: %s", exc)
        result = index.search(query, {"limit": SEARCH_RETRIEVE_LIMIT})
    hits = result.get("hits") if isinstance(result, dict) else getattr(result, "hits", None)
    if not isinstance(hits, list):
        return []
    return [h for h in hits if isinstance(h, dict)]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/extract-text")
async def extract_text(
    file: UploadFile = File(...),
    _: None = Depends(require_service_token),
) -> dict[str, str]:
    name = str(file.filename or "")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    try:
        content = extract_file_text(data, name)
    except ExtractError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("extract failed")
        raise HTTPException(status_code=500, detail="Failed to extract file text") from exc
    return {"content": content}


@app.post("/ingest-article")
def ingest_article(
    data: IngestArticleRequest,
    _: None = Depends(require_service_token),
) -> dict[str, object]:
    article_id = str(data.article_id or "").strip()
    organization_id = str(data.organization_id or "").strip()
    title = str(data.title or "").strip()
    content = str(data.content or "").strip()
    if not organization_id or not article_id or not title or not content:
        raise HTTPException(
            status_code=400,
            detail="organization_id, article_id, title, and content are required",
        )
    doc = format_structured_article(
        organization_id=organization_id,
        article_id=article_id,
        title=title,
        content=content,
    )
    try:
        delete_article_docs(organization_id, article_id)
        vectors = embed_texts([str(doc["text"])])
        stored = {k: v for k, v in doc.items() if k != "structure_path"}
        stored["_vectors"] = {EMBEDDER_NAME: vectors[0]}
        index = get_or_create_index(organization_id)
        task = index.add_documents([stored], primary_key="id")
        wait_task(task.task_uid, label=f"ingest_{article_id}")
    except meilisearch.errors.MeilisearchCommunicationError as exc:
        logger.exception("Meilisearch unreachable")
        raise HTTPException(status_code=503, detail="Cannot reach Meilisearch") from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("ingest-article failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {
        "status": "success",
        "article_id": article_id,
        "id": doc["id"],
        "steps": doc["steps"],
        "symptoms": doc["symptoms"],
        "structure_path": doc.get("structure_path"),
    }


@app.post("/delete-document")
def delete_document(
    data: DeleteDocumentRequest,
    _: None = Depends(require_service_token),
) -> dict[str, str]:
    article_id = str(data.article_id or "").strip()
    organization_id = str(data.organization_id or "").strip()
    if not organization_id or not article_id:
        raise HTTPException(
            status_code=400, detail="organization_id and article_id are required"
        )
    try:
        delete_article_docs(organization_id, article_id)
    except meilisearch.errors.MeilisearchCommunicationError as exc:
        raise HTTPException(status_code=503, detail="Cannot reach Meilisearch") from exc
    except Exception as exc:
        logger.exception("delete-document failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"status": "success", "article_id": article_id}


@app.post("/search")
def search_articles(
    data: SearchRequest,
    _: None = Depends(require_service_token),
) -> dict[str, object]:
    organization_id = str(data.organization_id or "").strip()
    query = str(data.query or "").strip()
    if not organization_id:
        raise HTTPException(status_code=400, detail="organization_id is required")
    if not query:
        raise HTTPException(status_code=400, detail="query is required")
    try:
        rows = search_meili_hits(organization_id, query)
    except meilisearch.errors.MeilisearchCommunicationError as exc:
        logger.exception("Meilisearch unreachable")
        raise HTTPException(
            status_code=503,
            detail="Cannot reach Meilisearch",
        ) from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("search failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    if not rows:
        return {"hit": None, "reason": "no_match"}
    hit = pick_reranked_hit(query, rows)
    if not hit or not hit.get("article_id") and not hit.get("title"):
        return {"hit": None, "reason": "no_match"}
    return {"hit": hit}
