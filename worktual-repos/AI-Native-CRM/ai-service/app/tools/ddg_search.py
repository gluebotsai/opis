from __future__ import annotations

import re
from urllib.parse import unquote, urlparse

from app.config import get_settings
from app.tools.page_fetch import safe_fetch_text


async def search_duckduckgo(query: str) -> list[dict[str, str]]:
    settings = get_settings()
    url = f"https://html.duckduckgo.com/html/?q={httpx_quote(query)}"
    html = await safe_fetch_text(url)
    if not html:
        return []

    results: list[dict[str, str]] = []
    pattern = re.compile(
        r'<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>(.*?)</a>',
        re.I | re.S,
    )
    for match in pattern.finditer(html):
        href = match.group(1)
        title = re.sub(r"<[^>]+>", "", match.group(2)).strip()
        uddg = re.search(r"[?&]uddg=([^&]+)", href)
        if uddg:
            try:
                href = unquote(uddg.group(1))
            except Exception:
                pass
        if not href.startswith("http"):
            continue
        results.append({"title": title, "url": href})
        if len(results) >= settings.max_search_results:
            break
    return results


def httpx_quote(value: str) -> str:
    from urllib.parse import quote

    return quote(value)


def rank_domain(candidate: str, company_name: str | None) -> int:
    """Score a hostname as the company's official site.

    Unrelated .com hits must not outrank a missing name match — that is how
    Zendesk enrichment used to persist zoho.com.
    """
    host = candidate.lower().removeprefix("www.")
    score = 10
    name = re.sub(r"[^a-z0-9]+", "", (company_name or "").lower())
    slug = host.split(".")[0] if host else ""
    if name and slug and (
        name in slug
        or slug in name
        or (len(name) >= 4 and name[:6] in slug)
    ):
        score += 70
    if re.search(r"\.(com|io|co|ai|net|org)$", host):
        score += 10
    if re.search(
        r"linkedin\.com|facebook\.com|twitter\.com|crunchbase\.com|wikipedia\.org",
        host,
    ):
        score -= 50
    return score


def hostname_of(url: str) -> str | None:
    try:
        host = urlparse(url).hostname or ""
        return host.lower().removeprefix("www.") or None
    except Exception:
        return None
