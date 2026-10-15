"""Push notification tap destination (not Campaign Management).

Send worker in TS mirrors this: template CTA → campaign_url → Accounts
default_click_url. Never env app URL / rebuild-campaign UI.
"""

from __future__ import annotations

from urllib.parse import urlparse

CAMPAIGN_APP_HOSTS = frozenset({"rebuild-campaign.worktual.com"})


def _hostname(raw: str) -> str:
    try:
        host = (urlparse(raw).hostname or "").lower().strip()
    except ValueError:
        return ""
    if host.startswith("www."):
        return host[4:]
    return host


def _http_dest(raw: str | None) -> str | None:
    url = str(raw or "").strip()
    if not url or len(url) > 4096:
        return None
    if not url.lower().startswith(("http://", "https://")):
        return None
    if any(ch in url for ch in (" ", "\t", "<", ">")):
        return None
    return url


def is_campaign_app_landing(raw: str | None, app_url: str) -> bool:
    dest = _http_dest(raw)
    if not dest:
        return False
    dest_host = _hostname(dest)
    if not dest_host:
        return False
    if dest_host in CAMPAIGN_APP_HOSTS:
        return True
    app_host = _hostname(str(app_url or "").strip())
    return bool(app_host and dest_host == app_host)


def resolve_push_click_dest(
    *,
    cta_url: str | None = None,
    campaign_url: str | None = None,
    default_click_url: str | None = None,
    app_url: str,
) -> str | None:
    for candidate in (cta_url, campaign_url, default_click_url):
        dest = _http_dest(candidate)
        if not dest:
            continue
        if is_campaign_app_landing(dest, app_url):
            continue
        return dest
    return None
