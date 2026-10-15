"""Rebuild ontology slice when Context Layer fetch fails."""

from __future__ import annotations

from app.memory.store import memory_store
from app.services.context_layer import MetricDescriptor, OntologySlice, context_layer


def resolve_ontology_slice(
    *,
    session_id: str,
    organization_id: int,
    user_id: int,
    agent: str,
) -> tuple[OntologySlice | None, str]:
    """Return (slice, source) where source is live | process_cache | session_memory."""
    try:
        return context_layer.fetch_ontology_slice(
            organization_id=organization_id,
            user_id=user_id,
            agent=agent,
        ), "live"
    except Exception:
        cached = context_layer.cached_ontology_slice(
            organization_id=organization_id,
            user_id=user_id,
            agent=agent,
        )
        if cached and cached.metrics:
            return cached, "process_cache"

        snap = memory_store.ontology_slice_snapshot(session_id)
        if not snap:
            return None, "none"

        metrics = [
            MetricDescriptor(
                id=str(m.get("id") or ""),
                dims=tuple(str(d) for d in (m.get("dims") or []) if d),
            )
            for m in snap.get("metrics") or []
            if m.get("id")
        ]
        if not metrics:
            return None, "none"
        return OntologySlice(
            prompt=str(snap.get("prompt") or ""),
            metrics=metrics,
            version=snap.get("version"),
        ), "session_memory"
