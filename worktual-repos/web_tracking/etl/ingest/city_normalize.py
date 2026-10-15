"""Normalize reverse-geocode and IP labels into a stable metro / city name."""

from __future__ import annotations

import re
from typing import Any

# Exact match (lower case) → display city
_CITY_ALIASES: dict[str, str] = {
    "chennai corporation": "Chennai",
    "greater chennai corporation": "Chennai",
    "chennai": "Chennai",
    "bengaluru": "Bengaluru",
    "bangalore": "Bengaluru",
    "mumbai": "Mumbai",
    "bombay": "Mumbai",
    "delhi": "Delhi",
    "new delhi": "Delhi",
    "kolkata": "Kolkata",
    "calcutta": "Kolkata",
    "hyderabad": "Hyderabad",
    "pune": "Pune",
}

_CORPORATION_RE = re.compile(r"\bcorporation\b", re.I)
_DISTRICT_SUFFIX_RE = re.compile(r"\s+district\s*$", re.I)


def normalize_city_name(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    key = text.lower()
    if key in _CITY_ALIASES:
        return _CITY_ALIASES[key]
    if _CORPORATION_RE.search(text) and "chennai" in key:
        return "Chennai"
    if _DISTRICT_SUFFIX_RE.search(text):
        base = _DISTRICT_SUFFIX_RE.sub("", text).strip()
        if base:
            return normalize_city_name(base) or base
    return text


def admin_city_from_state_district(state_district: Any) -> str | None:
    if not state_district:
        return None
    text = str(state_district).strip()
    if not text:
        return None
    return normalize_city_name(text)


def resolve_display_city(
    *,
    primary: Any = None,
    locality: Any = None,
    state_district: Any = None,
    ip_city: Any = None,
) -> str | None:
    """
    Pick the best city label for analytics / visitor profile.
    Prefers normalized admin city; falls back to IP city when GPS label is a suburb only.
    """
    primary_norm = normalize_city_name(primary)
    locality_norm = normalize_city_name(locality)
    state_admin = admin_city_from_state_district(state_district)
    ip_norm = normalize_city_name(ip_city)

    if primary_norm and locality_norm and primary_norm == locality_norm:
        if state_admin:
            return state_admin
        if ip_norm and ip_norm.lower() != locality_norm.lower():
            return ip_norm
        return primary_norm

    metros = set(_CITY_ALIASES.values())

    if primary_norm:
        if ip_norm and primary_norm.lower() != ip_norm.lower() and ip_norm in metros:
            return ip_norm
        if locality_norm and primary_norm == locality_norm and state_admin:
            return state_admin
        if locality_norm and primary_norm == locality_norm and ip_norm:
            return ip_norm
        return primary_norm

    if state_admin:
        return state_admin
    if ip_norm:
        return ip_norm
    if locality_norm:
        return locality_norm
    return None
