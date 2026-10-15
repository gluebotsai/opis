"""Shared helpers for MF vs SQL fallback parity gates."""

from __future__ import annotations

from semantic.sql.job import ExecutorJob


def channel_scope_for_metric(
    metric_id: str,
    organization_id: int,
    product: str,
) -> tuple[list[str], str | None]:
    return [], None


def apply_channel_scope(job: ExecutorJob, metric_id: str, product: str) -> ExecutorJob:
    return job
