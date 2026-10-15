"""Inline text embedding service.

Loads sentence-transformers/all-MiniLM-L6-v2 via ONNX Runtime (CPU).
The model is loaded ONCE at startup and shared across all threads.
Batch inference amortizes overhead — one call per Writer flush.
"""
from __future__ import annotations

import logging
import os
from typing import Sequence

log = logging.getLogger(__name__)

_SINGLETON: "EmbeddingService | None" = None


class EmbeddingService:
    """Thin wrapper around sentence_transformers for ONNX-accelerated inference."""

    def __init__(self, model_name: str = "sentence-transformers/all-MiniLM-L6-v2"):
        from sentence_transformers import SentenceTransformer

        cache_dir = os.getenv("EMBEDDING_CACHE_DIR", None)
        log.info("Loading embedding model: %s", model_name)
        try:
            self.model = SentenceTransformer(
                model_name,
                cache_folder=cache_dir,
                backend="onnx",
            )
        except Exception as exc:
            log.warning("Could not initialize SentenceTransformer with backend='onnx' (%s). Falling back to default backend.", exc)
            self.model = SentenceTransformer(
                model_name,
                cache_folder=cache_dir,
            )
        if hasattr(self.model, "get_embedding_dimension"):
            self.dimension = self.model.get_embedding_dimension()
        else:
            self.dimension = self.model.get_sentence_embedding_dimension()
        log.info("Embedding model loaded: dim=%d", self.dimension)

    def encode_batch(self, texts: Sequence[str]) -> list[list[float]]:
        """Vectorize a batch of texts. Returns list of float lists."""
        if not texts:
            return []
        embeddings = self.model.encode(
            list(texts),
            batch_size=min(len(texts), 256),
            show_progress_bar=False,
            normalize_embeddings=True,
        )
        return [vec.tolist() for vec in embeddings]

    def encode_one(self, text: str) -> list[float]:
        """Vectorize a single text string."""
        return self.encode_batch([text])[0]


def get_embedder() -> EmbeddingService:
    """Return the singleton embedder, lazily initialized on first call."""
    global _SINGLETON
    if _SINGLETON is None:
        model = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
        _SINGLETON = EmbeddingService(model)
    return _SINGLETON
