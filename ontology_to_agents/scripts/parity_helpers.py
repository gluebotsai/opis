"""Shared helpers for MF vs SQL fallback parity gates."""

from __future__ import annotations

from dataclasses import replace

from semantic.capabilities import get_metric_capabilities
from semantic.entitlements import load_tenant_entitlements
from semantic.sql.job import ExecutorJob


def channel_scope_for_metric(
    metric_id: str,
    organization_id: int,
    product: str,
) -> tuple[list[str], str | None]:
    cap = get_metric_capabilities(metric_id, product=product)
    if not cap.get("channel_scoped"):
        return [], None
    channels = load_tenant_entitlements(organization_id).channels_for_product(product)
    return list(channels), "channel"


def apply_channel_scope(job: ExecutorJob, metric_id: str, product: str) -> ExecutorJob:
    channels, col = channel_scope_for_metric(
        metric_id, job.organization_id, product
    )
    if not channels:
        return job
    return replace(job, entitled_channels=channels, channel_column=col)
