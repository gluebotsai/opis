"""Server-side GeoIP enrichment. Uses optional geoip2 database or HTTP fallback."""

from __future__ import annotations

import ipaddress
import json
import urllib.error
import urllib.request
from typing import Any, Optional

from ingest.city_normalize import normalize_city_name


def _is_public_ip(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
        return not (
            addr.is_private
            or addr.is_loopback
            or addr.is_link_local
            or addr.is_reserved
        )
    except ValueError:
        return False


def _lookup_http(ip: str) -> dict[str, Any]:
    """Free ip-api.com lookup (non-commercial; rate-limited; HTTP only on free tier)."""
    url = (
        f"http://ip-api.com/json/{ip}"
        "?fields=status,country,countryCode,region,regionName,city,lat,lon,timezone"
    )
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            data = json.loads(resp.read().decode())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return {}

    if data.get("status") != "success":
        return {}

    return {
        "country": data.get("countryCode"),
        "countryName": data.get("country"),
        "region": data.get("region"),
        "regionName": data.get("regionName"),
        "city": data.get("city"),
        "latitude": data.get("lat"),
        "longitude": data.get("lon"),
        "timezone": data.get("timezone"),
    }


def enrich_geo(source_ip: Optional[str], settings: Any = None) -> dict[str, Any]:
    if not source_ip:
        return {}

    geo: dict[str, Any] = {"ip": source_ip}

    if not _is_public_ip(source_ip):
        return geo

    db_path = getattr(settings, "geoip_db_path", None) if settings else None
    if db_path:
        try:
            import geoip2.database

            with geoip2.database.Reader(db_path) as reader:
                rec = reader.city(source_ip)
                geo.update(
                    {
                        "country": rec.country.iso_code,
                        "countryName": rec.country.name,
                        "region": rec.subdivisions.most_specific.iso_code if rec.subdivisions else None,
                        "regionName": rec.subdivisions.most_specific.name if rec.subdivisions else None,
                        "city": rec.city.name,
                        "postal": rec.postal.code,
                        "latitude": rec.location.latitude,
                        "longitude": rec.location.longitude,
                        "timezone": rec.location.time_zone,
                    }
                )
                return geo
        except Exception:
            pass

    http_enabled = getattr(settings, "geoip_http_fallback", True) if settings else True
    if http_enabled:
        geo.update(_lookup_http(source_ip))

    city = geo.get("city")
    if city:
        normalized = normalize_city_name(city)
        if normalized:
            geo["city"] = normalized

    return geo


def ensure_geo_enriched(geo: dict[str, Any] | None, settings: Any = None) -> dict[str, Any]:
    """Fill missing country/city/region when only IP is present (e.g. failed lookup at ingest)."""
    if not geo:
        return {}
    out = dict(geo)
    ip = out.get("ip")
    if not ip:
        return out
    if out.get("country") and out.get("city"):
        return out
    if not _is_public_ip(str(ip)):
        return out
    looked_up = enrich_geo(str(ip), settings)
    for key, value in looked_up.items():
        if value is not None and (key not in out or not out.get(key)):
            out[key] = value
    return out
