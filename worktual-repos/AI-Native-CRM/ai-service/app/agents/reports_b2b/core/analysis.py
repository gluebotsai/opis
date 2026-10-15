# origin: ticketing_v2/core/analysis.py
from typing import Dict, Any, List, Optional

def compute_period_delta(current_val: float, previous_val: float) -> Dict[str, Any]:
    """Computes absolute difference and percentage change between two period metrics."""
    delta = current_val - previous_val
    pct_change = (delta / previous_val * 100.0) if previous_val != 0 else (100.0 if current_val > 0 else 0.0)
    return {
        "current": round(current_val, 2),
        "previous": round(previous_val, 2),
        "absolute_delta": round(delta, 2),
        "pct_change": round(pct_change, 2),
        "direction": "up" if delta > 0 else ("down" if delta < 0 else "flat")
    }

def compute_share_of_total(segments: List[Dict[str, Any]], value_col: str) -> List[Dict[str, Any]]:
    """Calculates each segment's percentage share of the total sum."""
    total = sum(s.get(value_col, 0) for s in segments)
    enriched = []
    for s in segments:
        item = dict(s)
        val = s.get(value_col, 0)
        item["share_pct"] = round((val / total * 100.0), 2) if total > 0 else 0.0
        enriched.append(item)
    return enriched

def compute_rate_vs_volume(
    current_volume: int,
    previous_volume: int,
    current_rate: float,
    previous_rate: float
) -> Dict[str, Any]:
    """
    Decomposes changes in total metric into volume impact vs conversion rate impact.
    """
    volume_delta = current_volume - previous_volume
    rate_delta = current_rate - previous_rate
    
    return {
        "volume_impact": volume_delta,
        "rate_impact_pct": round(rate_delta, 2),
        "primary_driver": "volume" if abs(volume_delta) > abs(rate_delta * 10) else "rate"
    }
