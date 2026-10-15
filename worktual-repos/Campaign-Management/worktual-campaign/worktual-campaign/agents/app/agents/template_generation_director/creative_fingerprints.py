"""Persist and compare channel creative fingerprints for anti-repetition."""

from __future__ import annotations

from typing import Any


def extract_fingerprint(
    *,
    channel: str,
    fields: dict[str, Any] | None,
    design_plan: dict[str, Any] | None = None,
) -> dict[str, Any]:
    ch = str(channel or "").strip().lower()
    data = fields if isinstance(fields, dict) else {}
    plan = design_plan if isinstance(design_plan, dict) else {}
    fp: dict[str, Any] = {"channel": ch}

    if ch == "email":
        sections = data.get("sections") if isinstance(data.get("sections"), list) else []
        seq = [
            str(row.get("type") or "").strip().lower()
            for row in sections
            if isinstance(row, dict) and str(row.get("type") or "").strip()
        ]
        if not seq and isinstance(plan.get("sections"), list):
            seq = [str(v).strip().lower() for v in plan["sections"] if str(v).strip()]
        fp.update(
            {
                "pattern_id": str(
                    data.get("pattern_id") or plan.get("pattern_id") or ""
                ).strip().lower(),
                "theme_id": str(
                    data.get("theme_id") or plan.get("theme_id") or ""
                ).strip().lower(),
                "section_sequence": seq,
                "content_rhythm": str(
                    plan.get("content_rhythm") or data.get("content_rhythm") or ""
                ).strip(),
                "cta_position": _cta_position(seq),
                "image_role": str(plan.get("image_role") or "").strip(),
            }
        )
        return fp

    if ch == "whatsapp":
        fp.update(
            {
                "preset_id": str(
                    plan.get("preset_id") or data.get("preset_id") or ""
                ).strip().lower(),
                "header_format": str(data.get("header_format") or "TEXT").upper(),
            }
        )
        return fp

    fp["archetype"] = str(plan.get("archetype") or data.get("archetype") or "").strip().lower()
    return fp


def _cta_position(section_sequence: list[str]) -> str:
    if "cta" not in section_sequence:
        return "none"
    return f"index_{section_sequence.index('cta')}"


def merge_prior_templates(
    session_prior: list[dict[str, Any]] | None,
    org_recent: list[dict[str, Any]] | None,
    *,
    limit: int = 24,
) -> list[dict[str, Any]]:
    """Combine session cards + org DB history for fingerprint avoidance."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()

    def _add(row: dict[str, Any]) -> None:
        tid = str(row.get("template_id") or row.get("id") or "").strip()
        key = tid or f"{row.get('channel')}:{id(row)}"
        if key in seen:
            return
        seen.add(key)
        out.append(row)

    for row in reversed(org_recent or []):
        if isinstance(row, dict):
            _add(row)
    for row in reversed(session_prior or []):
        if isinstance(row, dict):
            _add(row)
    return out[-limit:]


def load_recent_fingerprints(
    prior_templates: list[dict[str, Any]] | None,
    *,
    channel: str | None = None,
    limit: int = 12,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    ch_filter = str(channel or "").strip().lower()
    for row in reversed(prior_templates or []):
        if not isinstance(row, dict):
            continue
        ch = str(row.get("channel") or "").strip().lower()
        if ch_filter and ch != ch_filter:
            continue
        fields = row.get("fields") if isinstance(row.get("fields"), dict) else {}
        stored = fields.get("creative_fingerprint")
        if isinstance(stored, dict) and stored.get("channel"):
            out.append(dict(stored))
            continue
        fp = extract_fingerprint(channel=ch, fields=fields, design_plan=None)
        if fp.get("pattern_id") or fp.get("preset_id") or fp.get("section_sequence"):
            out.append(fp)
        if len(out) >= limit:
            break
    return out


def prior_pattern_ids_from_fingerprints(fingerprints: list[dict[str, Any]]) -> set[str]:
    ids: set[str] = set()
    for fp in fingerprints:
        for key in ("pattern_id", "preset_id", "archetype"):
            val = str(fp.get(key) or "").strip().lower()
            if val:
                ids.add(val)
    return ids


def fingerprint_signature(fp: dict[str, Any]) -> str:
    ch = str(fp.get("channel") or "").strip().lower()
    if ch == "email":
        parts = [
            fp.get("pattern_id") or "",
            fp.get("theme_id") or "",
            "|".join(fp.get("section_sequence") or []),
            fp.get("content_rhythm") or "",
            fp.get("cta_position") or "",
        ]
        return ":".join(str(p) for p in parts)
    if ch == "whatsapp":
        return f"{fp.get('preset_id') or ''}:{fp.get('header_format') or ''}"
    return str(fp.get("archetype") or "")


def is_too_similar(new_fp: dict[str, Any], recent: list[dict[str, Any]]) -> bool:
    sig = fingerprint_signature(new_fp)
    if not sig.strip(":"):
        return False
    for old in recent:
        if fingerprint_signature(old) == sig:
            return True
    return False


__all__ = [
    "extract_fingerprint",
    "fingerprint_signature",
    "is_too_similar",
    "load_recent_fingerprints",
    "merge_prior_templates",
    "prior_pattern_ids_from_fingerprints",
]
