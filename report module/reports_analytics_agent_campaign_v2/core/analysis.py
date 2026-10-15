"""Deterministic arithmetic helpers for the Domain deep playbook.

Section 8 of REPORTING_V2_DESIGN.md:
  - period_delta:           current vs previous, delta, % change, direction
  - segment_share_of_change: each segment's contribution to the total change
  - rate_vs_volume:         decompose a rate change into volume and rate effects

These are ALWAYS called by Python, never by the LLM.
Every number in the Domain's synthesised answer must originate from these outputs.
"""

from __future__ import annotations

from typing import Any


def period_delta(
    current: float | int,
    previous: float | int,
    *,
    unit: str = "",
    precision: int = 2,
) -> dict[str, Any]:
    """Compute the absolute and relative change between two periods.

    Returns:
        current:      the current value
        previous:     the previous value
        delta:        current - previous (positive = increased)
        pct_change:   percentage change rounded to `precision` decimals (None if previous == 0)
        direction:    'up' | 'down' | 'flat'
        unit:         echoed back for display
    """
    cur = float(current)
    prv = float(previous)
    delta = round(cur - prv, precision)
    if prv == 0:
        pct_change = None
    else:
        pct_change = round((cur - prv) / abs(prv) * 100, precision)

    if delta > 0:
        direction = "up"
    elif delta < 0:
        direction = "down"
    else:
        direction = "flat"

    return {
        "current": round(cur, precision),
        "previous": round(prv, precision),
        "delta": delta,
        "pct_change": pct_change,
        "direction": direction,
        "unit": unit,
    }


def segment_share_of_change(
    segments: list[dict[str, Any]],
    *,
    current_key: str = "current",
    previous_key: str = "previous",
    name_key: str = "name",
    precision: int = 2,
) -> list[dict[str, Any]]:
    """For each segment, compute its contribution to the total change.

    Args:
        segments: list of dicts each having {name_key, current_key, previous_key}
        current_key:  column name for the current-period value
        previous_key: column name for the previous-period value
        name_key:     column name for the segment label
        precision:    decimal rounding

    Returns:
        List of dicts (sorted by |share_of_change| descending):
            name:              segment label
            current:           current period value
            previous:          previous period value
            segment_delta:     current - previous for this segment
            share_of_change:   segment_delta / total_delta * 100  (None if total_delta == 0)
            direction:         'up' | 'down' | 'flat'
    """
    # Compute segment deltas
    enriched: list[dict[str, Any]] = []
    for seg in segments:
        cur = float(seg.get(current_key) or 0)
        prv = float(seg.get(previous_key) or 0)
        seg_delta = cur - prv
        enriched.append({
            "name": seg.get(name_key, ""),
            "current": round(cur, precision),
            "previous": round(prv, precision),
            "segment_delta": round(seg_delta, precision),
            "_raw_delta": seg_delta,
        })

    total_delta = sum(s["_raw_delta"] for s in enriched)

    for s in enriched:
        seg_d = s.pop("_raw_delta")
        if total_delta == 0:
            s["share_of_change"] = None
        else:
            s["share_of_change"] = round(seg_d / abs(total_delta) * 100, precision)
        if seg_d > 0:
            s["direction"] = "up"
        elif seg_d < 0:
            s["direction"] = "down"
        else:
            s["direction"] = "flat"

    # Sort by absolute share descending (largest contributor first)
    enriched.sort(key=lambda s: abs(s["share_of_change"] or 0), reverse=True)
    return enriched


def rate_vs_volume(
    current_count: int | float,
    current_total: int | float,
    previous_count: int | float,
    previous_total: int | float,
    *,
    precision: int = 2,
) -> dict[str, Any]:
    """Decompose a rate change into a volume effect and a rate effect.

    Uses the standard mix/volume decomposition:
      rate_effect  = (current_rate - previous_rate) * previous_total
      volume_effect = previous_rate * (current_total - previous_total)

    The dominant driver is whichever absolute effect is larger.

    Returns:
        current_rate:    count / total for the current period  (None if total == 0)
        previous_rate:   count / total for the previous period (None if total == 0)
        rate_delta:      current_rate - previous_rate
        rate_effect:     how much of the absolute count change is due to rate change
        volume_effect:   how much of the absolute count change is due to volume change
        dominant:        'rate' | 'volume' | 'both' | 'flat'
    """
    cur_n = float(current_count)
    cur_t = float(current_total)
    prv_n = float(previous_count)
    prv_t = float(previous_total)

    cur_rate = (cur_n / cur_t) if cur_t else None
    prv_rate = (prv_n / prv_t) if prv_t else None

    if cur_rate is None or prv_rate is None:
        return {
            "current_rate": cur_rate,
            "previous_rate": prv_rate,
            "rate_delta": None,
            "rate_effect": None,
            "volume_effect": None,
            "dominant": "unknown",
        }

    rate_delta = cur_rate - prv_rate
    rate_effect = rate_delta * prv_t          # If only rate changed
    volume_effect = prv_rate * (cur_t - prv_t)  # If only volume changed

    abs_rate = abs(rate_effect)
    abs_vol = abs(volume_effect)
    if abs_rate == 0 and abs_vol == 0:
        dominant: str = "flat"
    elif abs_rate > abs_vol * 1.5:
        dominant = "rate"
    elif abs_vol > abs_rate * 1.5:
        dominant = "volume"
    else:
        dominant = "both"

    return {
        "current_rate": round(cur_rate, precision + 2),
        "previous_rate": round(prv_rate, precision + 2),
        "rate_delta": round(rate_delta, precision + 2),
        "rate_effect": round(rate_effect, precision),
        "volume_effect": round(volume_effect, precision),
        "dominant": dominant,
    }


def format_deep_analysis(
    *,
    primary: dict[str, Any] | None = None,
    segments: list[dict[str, Any]] | None = None,
    rate_decomp: dict[str, Any] | None = None,
    top_n: int = 5,
) -> str:
    """Format deep analysis results into a compact fact block for Domain synthesis.

    This is the text that goes into the fact block alongside the SQL/KG results
    so the Domain LLM can write the CEO briefing without doing arithmetic.

    Args:
        primary:     output of period_delta()
        segments:    output of segment_share_of_change()
        rate_decomp: output of rate_vs_volume()
        top_n:       how many segments to show

    Returns:
        Multi-line string with DEEP_ANALYSIS prefix.
    """
    lines = ["DEEP_ANALYSIS"]

    if primary:
        direction = primary.get("direction", "flat")
        pct = primary.get("pct_change")
        pct_str = f" ({pct:+.1f}%)" if pct is not None else ""
        unit = f" {primary['unit']}" if primary.get("unit") else ""
        lines.append(
            f"period_change: {primary['previous']}{unit} -> {primary['current']}{unit}"
            f" ({direction}{pct_str})"
        )

    if segments:
        lines.append(f"top_segments ({min(top_n, len(segments))} of {len(segments)}, by share of change):")
        for seg in segments[:top_n]:
            share = seg.get("share_of_change")
            share_str = f" [{share:+.1f}% of change]" if share is not None else ""
            lines.append(
                f"  {seg['name']}: {seg['previous']} -> {seg['current']}"
                f" (delta {seg['segment_delta']:+.1f}{share_str}, {seg['direction']})"
            )

    if rate_decomp and rate_decomp.get("dominant") != "unknown":
        dominant = rate_decomp.get("dominant", "both")
        cur_r = rate_decomp.get("current_rate")
        prv_r = rate_decomp.get("previous_rate")
        if cur_r is not None and prv_r is not None:
            lines.append(
                f"rate_vs_volume: dominant={dominant}"
                f" | rate {prv_r:.3f} -> {cur_r:.3f}"
                f" | rate_effect={rate_decomp.get('rate_effect', 0):+.1f}"
                f" | volume_effect={rate_decomp.get('volume_effect', 0):+.1f}"
            )

    return "\n".join(lines)
