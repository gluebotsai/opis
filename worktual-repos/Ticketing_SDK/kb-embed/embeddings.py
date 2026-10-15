"""Local dense embedder + cross-encoder rerank (same family as Meilisearch ingest)."""

from __future__ import annotations

import logging
import os
from typing import List, Sequence

logger = logging.getLogger("kb-embed")

_DENSE_MODEL = os.getenv("DENSE_MODEL", "mixedbread-ai/mxbai-embed-large-v1")
_RERANK_MODEL = os.getenv("RERANK_MODEL", "cross-encoder/ms-marco-MiniLM-L-6-v2")
_model = None
_reranker = None


def embed_texts(texts: List[str]) -> List[List[float]]:
    model = _get_model()
    import torch

    with torch.inference_mode():
        vectors = model.encode(texts, show_progress_bar=False, batch_size=16)
    return vectors.tolist()


def rerank_texts(query: str, texts: Sequence[str]) -> List[tuple[int, float]]:
    """Return (index, score) pairs sorted by cross-encoder score descending."""
    docs = [str(t or "") for t in texts]
    if not docs:
        return []
    if len(docs) == 1:
        return [(0, 1.0)]
    model = _get_reranker()
    pairs = [(str(query or ""), doc) for doc in docs]
    scores = model.predict(pairs, show_progress_bar=False)
    ranked = sorted(
        ((i, float(scores[i])) for i in range(len(docs))),
        key=lambda item: item[1],
        reverse=True,
    )
    return ranked


def pick_top_index(ranked: Sequence[tuple[int, float]]) -> int | None:
    if not ranked:
        return None
    return int(ranked[0][0])


def _get_model():
    global _model
    if _model is not None:
        return _model
    import torch
    from sentence_transformers import SentenceTransformer

    device = "cuda" if torch.cuda.is_available() else "cpu"
    _model = SentenceTransformer(_DENSE_MODEL, device=device, trust_remote_code=True)
    logger.info("Dense embedder loaded model=%s device=%s", _DENSE_MODEL, device)
    return _model


def _get_reranker():
    global _reranker
    if _reranker is not None:
        return _reranker
    from sentence_transformers import CrossEncoder

    _reranker = CrossEncoder(_RERANK_MODEL)
    logger.info("Reranker loaded model=%s", _RERANK_MODEL)
    return _reranker
