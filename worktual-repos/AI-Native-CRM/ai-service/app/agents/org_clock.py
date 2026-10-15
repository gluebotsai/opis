"""Organization-local clock for coworker prompts.

The tenant location is ``accounts.organizations.country`` (and billing address
when a country has more than one zone). CRM does not add a timezone column.
"""

from __future__ import annotations

import logging
import re
import time
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

log = logging.getLogger("ai-service.org-clock")

_CACHE_TTL_S = 600.0
_location_cache: dict[str, tuple[float, str | None, str | None]] = {}

# Normalized country name or ISO code → IANA zone.
_COUNTRY_ZONES: dict[str, str] = {
    "india": "Asia/Kolkata",
    "in": "Asia/Kolkata",
    "united states": "America/New_York",
    "united states of america": "America/New_York",
    "usa": "America/New_York",
    "us": "America/New_York",
    "canada": "America/Toronto",
    "ca": "America/Toronto",
    "united kingdom": "Europe/London",
    "uk": "Europe/London",
    "great britain": "Europe/London",
    "gb": "Europe/London",
    "england": "Europe/London",
    "united arab emirates": "Asia/Dubai",
    "uae": "Asia/Dubai",
    "ae": "Asia/Dubai",
    "singapore": "Asia/Singapore",
    "sg": "Asia/Singapore",
    "australia": "Australia/Sydney",
    "au": "Australia/Sydney",
    "germany": "Europe/Berlin",
    "de": "Europe/Berlin",
    "france": "Europe/Paris",
    "fr": "Europe/Paris",
    "netherlands": "Europe/Amsterdam",
    "nl": "Europe/Amsterdam",
    "ireland": "Europe/Dublin",
    "ie": "Europe/Dublin",
    "spain": "Europe/Madrid",
    "es": "Europe/Madrid",
    "italy": "Europe/Rome",
    "it": "Europe/Rome",
    "sweden": "Europe/Stockholm",
    "se": "Europe/Stockholm",
    "norway": "Europe/Oslo",
    "no": "Europe/Oslo",
    "denmark": "Europe/Copenhagen",
    "dk": "Europe/Copenhagen",
    "finland": "Europe/Helsinki",
    "fi": "Europe/Helsinki",
    "switzerland": "Europe/Zurich",
    "ch": "Europe/Zurich",
    "austria": "Europe/Vienna",
    "at": "Europe/Vienna",
    "belgium": "Europe/Brussels",
    "be": "Europe/Brussels",
    "portugal": "Europe/Lisbon",
    "pt": "Europe/Lisbon",
    "poland": "Europe/Warsaw",
    "pl": "Europe/Warsaw",
    "japan": "Asia/Tokyo",
    "jp": "Asia/Tokyo",
    "china": "Asia/Shanghai",
    "cn": "Asia/Shanghai",
    "hong kong": "Asia/Hong_Kong",
    "hk": "Asia/Hong_Kong",
    "south korea": "Asia/Seoul",
    "korea": "Asia/Seoul",
    "kr": "Asia/Seoul",
    "indonesia": "Asia/Jakarta",
    "id": "Asia/Jakarta",
    "malaysia": "Asia/Kuala_Lumpur",
    "my": "Asia/Kuala_Lumpur",
    "thailand": "Asia/Bangkok",
    "th": "Asia/Bangkok",
    "vietnam": "Asia/Ho_Chi_Minh",
    "vn": "Asia/Ho_Chi_Minh",
    "philippines": "Asia/Manila",
    "ph": "Asia/Manila",
    "pakistan": "Asia/Karachi",
    "pk": "Asia/Karachi",
    "bangladesh": "Asia/Dhaka",
    "bd": "Asia/Dhaka",
    "sri lanka": "Asia/Colombo",
    "lk": "Asia/Colombo",
    "nepal": "Asia/Kathmandu",
    "np": "Asia/Kathmandu",
    "saudi arabia": "Asia/Riyadh",
    "sa": "Asia/Riyadh",
    "qatar": "Asia/Qatar",
    "qa": "Asia/Qatar",
    "kuwait": "Asia/Kuwait",
    "kw": "Asia/Kuwait",
    "bahrain": "Asia/Bahrain",
    "bh": "Asia/Bahrain",
    "oman": "Asia/Muscat",
    "om": "Asia/Muscat",
    "israel": "Asia/Jerusalem",
    "il": "Asia/Jerusalem",
    "south africa": "Africa/Johannesburg",
    "za": "Africa/Johannesburg",
    "nigeria": "Africa/Lagos",
    "ng": "Africa/Lagos",
    "kenya": "Africa/Nairobi",
    "ke": "Africa/Nairobi",
    "egypt": "Africa/Cairo",
    "eg": "Africa/Cairo",
    "brazil": "America/Sao_Paulo",
    "br": "America/Sao_Paulo",
    "mexico": "America/Mexico_City",
    "mx": "America/Mexico_City",
    "new zealand": "Pacific/Auckland",
    "nz": "Pacific/Auckland",
    "russia": "Europe/Moscow",
    "ru": "Europe/Moscow",
}

# Countries where a city or region in the billing address picks a better zone.
_MULTI_ZONE = frozenset(
    {
        "united states",
        "united states of america",
        "usa",
        "us",
        "canada",
        "ca",
        "australia",
        "au",
        "brazil",
        "br",
        "mexico",
        "mx",
        "indonesia",
        "id",
        "russia",
        "ru",
    }
)

# Longer needles first so "san francisco" wins over a shorter token.
_PLACE_ZONES: tuple[tuple[str, str], ...] = (
    ("san francisco", "America/Los_Angeles"),
    ("los angeles", "America/Los_Angeles"),
    ("seattle", "America/Los_Angeles"),
    ("portland", "America/Los_Angeles"),
    ("california", "America/Los_Angeles"),
    ("pacific time", "America/Los_Angeles"),
    ("new york", "America/New_York"),
    ("boston", "America/New_York"),
    ("miami", "America/New_York"),
    ("atlanta", "America/New_York"),
    ("washington", "America/New_York"),
    ("eastern time", "America/New_York"),
    ("chicago", "America/Chicago"),
    ("dallas", "America/Chicago"),
    ("houston", "America/Chicago"),
    ("austin", "America/Chicago"),
    ("texas", "America/Chicago"),
    ("central time", "America/Chicago"),
    ("denver", "America/Denver"),
    ("phoenix", "America/Phoenix"),
    ("mountain time", "America/Denver"),
    ("toronto", "America/Toronto"),
    ("ontario", "America/Toronto"),
    ("montreal", "America/Toronto"),
    ("vancouver", "America/Vancouver"),
    ("sydney", "Australia/Sydney"),
    ("melbourne", "Australia/Melbourne"),
    ("brisbane", "Australia/Brisbane"),
    ("perth", "Australia/Perth"),
    ("sao paulo", "America/Sao_Paulo"),
    ("rio de janeiro", "America/Sao_Paulo"),
    ("mexico city", "America/Mexico_City"),
    ("jakarta", "Asia/Jakarta"),
    ("bali", "Asia/Makassar"),
    ("moscow", "Europe/Moscow"),
)


def _norm(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()


def valid_zone(name: str | None) -> str | None:
    raw = (name or "").strip()
    if not raw or "/" not in raw:
        return None
    try:
        ZoneInfo(raw)
    except ZoneInfoNotFoundError:
        return None
    return raw


def zone_for_location(
    country: str | None,
    billing_address: str | None = None,
    explicit_zone: str | None = None,
) -> str:
    """IANA zone for the organization. Explicit IANA wins, then place, then country."""
    explicit = valid_zone(explicit_zone)
    if explicit:
        return explicit
    country_key = _norm(country)
    mapped = _COUNTRY_ZONES.get(country_key)
    if mapped and country_key not in _MULTI_ZONE:
        return mapped
    blob = _norm(f"{billing_address or ''} {country or ''}")
    if blob and (not country_key or country_key in _MULTI_ZONE):
        for needle, zone in _PLACE_ZONES:
            if needle in blob:
                return zone
    if mapped:
        return mapped
    if not country_key and blob:
        padded = f" {blob} "
        for name, zone in sorted(_COUNTRY_ZONES.items(), key=lambda item: -len(item[0])):
            if len(name) < 4:
                continue
            if f" {name} " in padded:
                return zone
    return "UTC"


def format_local_now(zone_name: str, when: datetime | None = None) -> str:
    """Human clock in the organization zone. Date order and 12/24h follow the zone."""
    zone = valid_zone(zone_name) or "UTC"
    tz = ZoneInfo(zone)
    now = when.astimezone(tz) if when is not None else datetime.now(tz)
    if now.tzinfo is None:
        now = now.replace(tzinfo=tz)
    month_first = zone.startswith("America/") or zone.startswith("US/")
    twelve_hour = not (
        zone.startswith("Europe/")
        or zone.startswith("Africa/")
        or zone == "UTC"
    )
    weekday = now.strftime("%A")
    month = now.strftime("%B")
    if month_first:
        date = f"{month} {now.day}, {now.year}"
    else:
        date = f"{now.day} {month} {now.year}"
    if twelve_hour:
        hour = now.strftime("%I").lstrip("0") or "12"
        clock = f"{hour}:{now.minute:02d} {now.strftime('%p')}"
    else:
        clock = f"{now.hour:02d}:{now.minute:02d}"
    abbrev = now.tzname() or zone
    return f"{weekday}, {date}, {clock} {abbrev} ({zone})"


def resolve_org_zone(ctx: dict[str, Any] | None) -> tuple[str, str]:
    """Return (iana_zone, country label) from coworker context."""
    data = ctx or {}
    explicit = valid_zone(str(data.get("timeZone") or data.get("timezone") or ""))
    country = str(data.get("organizationCountry") or "").strip()
    billing = str(data.get("organizationBillingAddress") or "").strip()
    zone = zone_for_location(country, billing, explicit)
    return zone, country


def local_now_line(ctx: dict[str, Any] | None) -> str:
    zone, country = resolve_org_zone(ctx)
    stamp = format_local_now(zone)
    place = f" in {country}" if country else ""
    return (
        f"- now={stamp}. Organization local date and time{place}. "
        "Use this clock for today, tomorrow, close dates, and any relative time. "
        "Write dates in this same local style unless a tool requires YYYY-MM-DD."
    )


async def load_organization_location(
    organization_id: str,
) -> tuple[str | None, str | None]:
    """Read country and billing address for the tenant. Cached briefly per process."""
    org = (organization_id or "").strip()
    if not org:
        return None, None
    cached = _location_cache.get(org)
    now = time.monotonic()
    if cached and now - cached[0] < _CACHE_TTL_S:
        return cached[1], cached[2]
    country, billing = await _fetch_location(org)
    _location_cache[org] = (now, country, billing)
    return country, billing


async def attach_organization_clock(ctx: dict[str, Any]) -> None:
    """Put the tenant country on context so the prompt clock can format locally."""
    if valid_zone(str(ctx.get("timeZone") or ctx.get("timezone") or "")):
        return
    if str(ctx.get("organizationCountry") or "").strip():
        return
    org = str(ctx.get("organizationId") or "").strip()
    if not org:
        return
    country, billing = await load_organization_location(org)
    if country:
        ctx["organizationCountry"] = country
    if billing:
        ctx["organizationBillingAddress"] = billing


async def _fetch_location(organization_id: str) -> tuple[str | None, str | None]:
    from app.config import get_settings

    settings = get_settings()
    dsn = (settings.account_database_url or settings.database_url or "").strip()
    if not dsn:
        return None, None
    try:
        import asyncpg

        from app.mcp.db import _normalize_dsn

        clean, _search = _normalize_dsn(dsn)
        conn = await asyncpg.connect(clean)
        try:
            row: Any = await conn.fetchrow(
                """
                SELECT country, billing_address
                FROM accounts.organizations
                WHERE id::text = $1
                LIMIT 1
                """,
                organization_id,
            )
            if not row:
                row = await conn.fetchrow(
                    """
                    SELECT country, billing_address
                    FROM public.organizations
                    WHERE id::text = $1
                    LIMIT 1
                    """,
                    organization_id,
                )
        finally:
            await conn.close()
    except Exception as exc:  # noqa: BLE001
        log.warning("organization location lookup failed for %s: %s", organization_id, exc)
        return None, None
    if not row:
        return None, None
    country = str(row["country"] or "").strip() or None
    billing = str(row["billing_address"] or "").strip() or None
    return country, billing
