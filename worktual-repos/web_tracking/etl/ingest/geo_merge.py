"""Merge browser GPS location from SDK profiles into server _geo payload."""

from __future__ import annotations

from typing import Any

from ingest.city_normalize import normalize_city_name, resolve_display_city
from ingest.reverse_geocode import reverse_geocode_coords


def merge_client_location(body: dict[str, Any], settings: Any = None) -> dict[str, Any]:
    """Prefer GPS coordinates when the visitor granted browser location permission."""
    profiles = body.get("profiles")
    if not isinstance(profiles, dict):
        return body.get("_geo") or {}

    location = profiles.get("location")
    if not isinstance(location, dict):
        return body.get("_geo") or {}

    if location.get("permission") != "granted":
        return body.get("_geo") or {}

    lat = location.get("latitude")
    lon = location.get("longitude")
    if lat is None or lon is None:
        return body.get("_geo") or {}

    geo = dict(body.get("_geo") or {})
    ip_snapshot = {
        key: value
        for key, value in geo.items()
        if key not in {"gps", "location_source", "accuracy", "altitude", "altitudeAccuracy"}
    }
    if ip_snapshot:
        geo["ip_geo"] = ip_snapshot

    geo.update(
        {
            "latitude": lat,
            "longitude": lon,
            "accuracy": location.get("accuracy"),
            "altitude": location.get("altitude"),
            "altitudeAccuracy": location.get("altitudeAccuracy"),
            "location_source": "gps",
            "gps": {
                "latitude": lat,
                "longitude": lon,
                "accuracy": location.get("accuracy"),
                "altitude": location.get("altitude"),
                "capturedAt": location.get("capturedAt"),
            },
        }
    )

    gps_place = reverse_geocode_coords(lat, lon, settings)
    if gps_place:
        geo.update(gps_place)
        geo["location_source"] = "gps"

    ip_city = ip_snapshot.get("city") if ip_snapshot else None
    resolved_city = resolve_display_city(
        primary=geo.get("city"),
        locality=geo.get("locality"),
        state_district=geo.get("state_district"),
        ip_city=ip_city,
    )
    if resolved_city:
        geo["city"] = resolved_city
    elif ip_city:
        geo["city"] = normalize_city_name(ip_city) or ip_city

    body["_geo"] = geo
    return geo
