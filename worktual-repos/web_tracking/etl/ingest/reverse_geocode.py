"""Reverse geocode GPS coordinates to city / region / country (server-side)."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from ingest.city_normalize import normalize_city_name, resolve_display_city


def _setting(settings: Any, name: str, default: Any) -> Any:
    if settings is None:
        return default
    return getattr(settings, name, default)


def _address_str(address: dict[str, Any], key: str) -> str | None:
    value = address.get(key)
    if not value:
        return None
    return str(value).strip() or None


def _pick_locality(address: dict[str, Any]) -> str | None:
    for key in (
        "suburb",
        "neighbourhood",
        "neighborhood",
        "quarter",
        "hamlet",
        "village",
    ):
        value = _address_str(address, key)
        if value:
            return value
    return None


def _pick_admin_candidate(address: dict[str, Any]) -> str | None:
    """Prefer metro / district admin names over raw municipality or suburb."""
    for key in (
        "city_district",
        "city",
        "town",
        "state_district",
        "municipality",
        "county",
    ):
        value = _address_str(address, key)
        if value:
            return value
    return None


def _pick_region(address: dict[str, Any]) -> tuple[str | None, str | None]:
    region_name = address.get("state") or address.get("region") or address.get("state_district")
    region_code = address.get("ISO3166-2-lvl4")
    if region_code and "-" in region_code:
        region_code = region_code.split("-", 1)[1]
    return (
        str(region_code) if region_code else None,
        str(region_name) if region_name else None,
    )


def parse_nominatim_response(data: dict[str, Any]) -> dict[str, Any]:
    """Normalize a Nominatim reverse-geocode JSON body."""
    address = data.get("address")
    if not isinstance(address, dict):
        return {}

    country_code = address.get("country_code")
    region, region_name = _pick_region(address)
    locality = _pick_locality(address)
    admin_candidate = _pick_admin_candidate(address)
    state_district = _address_str(address, "state_district")

    city = resolve_display_city(
        primary=admin_candidate,
        locality=locality,
        state_district=state_district,
    )
    if not city and admin_candidate:
        city = normalize_city_name(admin_candidate)

    out: dict[str, Any] = {}
    if country_code:
        out["country"] = str(country_code).upper()
    country_name = address.get("country")
    if country_name:
        out["countryName"] = str(country_name)
    if region:
        out["region"] = region
    if region_name:
        out["regionName"] = region_name
    if state_district:
        out["state_district"] = state_district
    if locality:
        out["locality"] = locality
    if city:
        out["city"] = city

    return out


def _cache_key(lat: float, lon: float) -> tuple[float, float]:
    return (round(lat, 3), round(lon, 3))


_CACHE: dict[tuple[float, float], dict[str, Any]] = {}


def reverse_geocode_coords(
    latitude: float,
    longitude: float,
    settings: Any = None,
) -> dict[str, Any]:
    """
    Resolve city / region / country from GPS coordinates.
    Uses OpenStreetMap Nominatim by default (server-side only).
    """
    enabled = _setting(settings, "reverse_geocode_enabled", True)
    if not enabled:
        return {}

    try:
        lat = float(latitude)
        lon = float(longitude)
    except (TypeError, ValueError):
        return {}

    if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
        return {}

    key = _cache_key(lat, lon)
    if key in _CACHE:
        return dict(_CACHE[key])

    base_url = _setting(
        settings,
        "reverse_geocode_url",
        "https://nominatim.openstreetmap.org/reverse",
    )
    user_agent = _setting(
        settings,
        "reverse_geocode_user_agent",
        "WorktualWebTracking/1.0 (contact: support@worktual.com)",
    )
    timeout = float(_setting(settings, "reverse_geocode_timeout", 5))

    query = urllib.parse.urlencode(
        {
            "lat": lat,
            "lon": lon,
            "format": "json",
            "addressdetails": "1",
            "zoom": "10",
        }
    )
    url = f"{base_url}?{query}"
    request = urllib.request.Request(url, headers={"User-Agent": user_agent})

    try:
        with urllib.request.urlopen(request, timeout=timeout) as resp:
            data = json.loads(resp.read().decode())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError, ValueError):
        _CACHE[key] = {}
        return {}

    if not isinstance(data, dict):
        _CACHE[key] = {}
        return {}

    parsed = parse_nominatim_response(data)
    _CACHE[key] = parsed
    return dict(parsed)
