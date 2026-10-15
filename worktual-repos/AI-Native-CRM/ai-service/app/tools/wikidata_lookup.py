from __future__ import annotations

import asyncio
import re
from typing import Any
from urllib.parse import quote, unquote

import httpx

from app.tools.bs4_extract import normalize_products_value
from app.tools.company_identity import (
    _name_tokens,
    acronym_matches_entity_text,
    company_name_matches_domain,
    is_short_company_acronym,
    normalize_company_city,
    wiki_firmographics_match_company,
)

BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)


def _normalize_host(raw: str) -> str:
    host = raw.strip().lower()
    host = re.sub(r"^https?://", "", host)
    host = re.sub(r"^www\.", "", host)
    return host.split("/")[0]


def parse_employee_number(raw: str) -> int | None:
    cleaned = re.sub(r"\{\{[^}]+\}\}", " ", raw)
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    m = re.search(r"([\d]{1,3}(?:,\d{3})+|\d+)\s*\+", cleaned)
    if m:
        n = int(m.group(1).replace(",", ""))
        return n if n > 0 else None
    m = re.search(r"([\d]{1,3}(?:,\d{3})+|\d{2,})", cleaned)
    if not m:
        return None
    n = int(m.group(1).replace(",", ""))
    return n if 0 < n < 50_000_000 else None


async def _get_json(
    url: str, timeout: float = 6.0, retries: int = 2
) -> dict[str, Any] | None:
    for attempt in range(retries + 1):
        try:
            async with httpx.AsyncClient(
                timeout=timeout,
                headers={"User-Agent": BROWSER_UA, "Accept": "application/json"},
                follow_redirects=True,
            ) as client:
                res = await client.get(url)
                if res.status_code == 429 and attempt < retries:
                    await asyncio.sleep(0.8 * (attempt + 1))
                    continue
                if res.status_code >= 400:
                    return None
                return res.json()
        except Exception:
            if attempt >= retries:
                return None
            await asyncio.sleep(0.4 * (attempt + 1))
    return None


def _score_candidate(
    label: str,
    description: str,
    company_name: str,
    company_domain: str | None,
    official_sites: list[str],
) -> int:
    score = 0
    label_l = (label or "").lower()
    desc = (description or "").lower()
    name = company_name.lower().strip()
    if label_l == name:
        score += 50
    elif name in label_l or label_l in name:
        score += 25
    if re.search(
        r"compan|manufacturer|corporation|enterprise|business|brand|firm|organization|automaker|software|bank",
        desc,
    ):
        score += 30
    if re.search(r"family name|given name|surname|disambiguation|human|footballer", desc):
        score -= 80
    # Official-site match boosts even for short tickers (HCL → hcltech.com).
    if company_domain:
        want = _normalize_host(company_domain)
        for site in official_sites:
            try:
                if want and _normalize_host(site) == want:
                    score += 60
                    break
            except Exception:
                pass
    return score


_BAD_LOGO_IMAGE_RE = re.compile(
    r"(campus|headquarters?|\bhq\b|building|aerial|skyline|office.?park|\bsez\b|"
    r"factory|plant\b|campus)",
    re.I,
)


def is_likely_brand_logo_image_url(url: str | None) -> bool:
    """False for Wikipedia page photos (HQ campus) used as summary thumbnails."""
    raw = (url or "").strip()
    if not raw.startswith("http"):
        return False
    return not bool(_BAD_LOGO_IMAGE_RE.search(raw))


def commons_filepath_url(filename: str) -> str:
    return (
        "https://commons.wikimedia.org/wiki/Special:FilePath/"
        + quote(filename.strip().replace(" ", "_"))
    )


def pick_best_logo_filename(
    filenames: list[str], company_name: str | None = None
) -> str | None:
    """Prefer current brand logos over former-name marks / campus photos."""
    _, meaningful = _name_tokens(company_name)
    ac = (
        re.sub(r"[^a-z]", "", (company_name or "").lower())
        if is_short_company_acronym(company_name)
        else ""
    )
    best: str | None = None
    best_score = -10_000
    for raw in filenames:
        name = (raw or "").strip()
        if not name:
            continue
        if _BAD_LOGO_IMAGE_RE.search(name):
            continue
        fl = name.lower().replace(" ", "_")
        score = 0
        if "logo" in fl:
            score += 50
        if fl.endswith(".svg"):
            score += 20
        if any(len(t) >= 4 and t in fl for t in meaningful):
            score += 40
        if ac and ac in fl.replace("_", "").replace("-", "").replace(".", ""):
            score += 35
        # Former brand marks (Facebook logo on Meta) score lower when name differs.
        if meaningful and not any(t in fl for t in meaningful if len(t) >= 4):
            if re.search(r"facebook|instagram|whatsapp|oculus", fl) and not re.search(
                r"meta", fl
            ):
                score -= 30
        if score > best_score:
            best_score = score
            best = name
    return best


def parse_wikipedia_infobox_logo(content: str | None) -> str | None:
    """Commons filename from `| logo = Foo.svg` (preferred over page image)."""
    if not content:
        return None
    m = re.search(
        r"\|\s*logo\s*=[ \t]*(.+?)(?:\n\s*\|\s*[A-Za-z_]|\n\}\})",
        content,
        re.I,
    )
    if not m:
        return None
    raw = m.group(1).strip()
    raw = re.sub(r"<ref[^>]*>.*?</ref>", " ", raw, flags=re.I | re.S)
    raw = re.sub(r"\{\{[^}]+\}\}", " ", raw)
    file_m = re.search(
        r"(?:File:|Image:)?\s*([A-Za-z0-9][^|\n\]]+\.(?:svg|png|jpg|jpeg|gif|webp))",
        raw,
        re.I,
    )
    if not file_m:
        return None
    fname = file_m.group(1).strip()
    if _BAD_LOGO_IMAGE_RE.search(fname):
        return None
    return fname


def _claim_strings(claims: dict[str, Any], prop: str) -> list[str]:
    out: list[str] = []
    for c in claims.get(prop) or []:
        dv = ((c.get("mainsnak") or {}).get("datavalue") or {})
        value = dv.get("value")
        if isinstance(value, str):
            out.append(value)
        elif isinstance(value, dict) and "amount" in value:
            out.append(str(value["amount"]).lstrip("+"))
    return out


def _claim_entity_ids(claims: dict[str, Any], prop: str) -> list[str]:
    out: list[str] = []
    for c in claims.get(prop) or []:
        dv = ((c.get("mainsnak") or {}).get("datavalue") or {})
        value = dv.get("value")
        if isinstance(value, dict) and value.get("id"):
            out.append(str(value["id"]))
        elif isinstance(value, str) and re.match(r"^Q\d+$", value):
            out.append(value)
    return out


def _claim_time_year(claim: dict[str, Any]) -> int | None:
    quals = claim.get("qualifiers") or {}
    for q in quals.get("P585") or []:
        dv = ((q.get("datavalue") or {}).get("value") or {})
        time = dv.get("time") if isinstance(dv, dict) else None
        if isinstance(time, str):
            m = re.search(r"\+(\d{4})", time)
            if m:
                year = int(m.group(1))
                if 1800 <= year <= 2100:
                    return year
    return None


def _claim_amount(claim: dict[str, Any]) -> str | None:
    dv = ((claim.get("mainsnak") or {}).get("datavalue") or {})
    value = dv.get("value")
    if isinstance(value, dict) and "amount" in value:
        return str(value["amount"]).lstrip("+")
    if isinstance(value, str):
        return value
    return None


def latest_employee_claim(claims: dict[str, Any]) -> tuple[int | None, int | None]:
    """Newest dated Wikidata P1128 headcount (not the first/oldest claim)."""
    best_n: int | None = None
    best_year: int | None = None
    best_rank = -1
    for i, claim in enumerate(claims.get("P1128") or []):
        n = parse_employee_number(_claim_amount(claim) or "")
        if not n:
            continue
        year = _claim_time_year(claim)
        rank = (10_000 if year else 0) + (year or 0) * 10 + i
        if rank >= best_rank:
            best_rank = rank
            best_n, best_year = n, year
    return best_n, best_year


def parse_wikipedia_infobox_employees(
    content: str | None,
) -> tuple[int | None, int | None]:
    """Wikipedia infobox headcount + year when present."""
    if not content:
        return None, None
    m = re.search(r"num[_ ]?employees\s*=\s*([^\n|]+)", content, re.I) or re.search(
        r"\|\s*employees\s*=\s*([^\n|]+)", content, re.I
    )
    if not m:
        return None, None
    raw = m.group(1)
    n = parse_employee_number(raw)
    year = None
    ym = re.search(r"\{\{\s*as of\s*\|\s*((?:19|20)\d{2})", raw, re.I) or re.search(
        r"(?:as of|fy|year)?\s*\(?((?:19|20)\d{2})", raw, re.I
    )
    if ym:
        year = int(ym.group(1))
    return n, year


def pick_employee_count(
    wd_n: int | None,
    wd_year: int | None,
    wiki_n: int | None,
    wiki_year: int | None,
) -> tuple[int | None, str]:
    """Wikipedia infobox is the public cited figure; Wikidata only if strictly newer."""
    if wiki_n and wd_n:
        if wiki_year and wd_year and wd_year > wiki_year:
            return wd_n, "wikidata"
        return wiki_n, "wikipedia"
    if wiki_n:
        return wiki_n, "wikipedia"
    if wd_n:
        return wd_n, "wikidata"
    return None, ""


def parse_wikipedia_infobox_headquarters(content: str | None) -> str | None:
    """HQ city/country from the infobox — not the word Headquarters."""
    if not content:
        return None
    city: str | None = None
    for key in ("hq_location_city", "headquarters", "hq_location", "hq", "location_city"):
        m = re.search(
            r"\|\s*" + re.escape(key) + r"\s*=\s*(.+?)(?:\n\s*\||\n\}\})",
            content,
            re.I | re.S,
        )
        if not m:
            continue
        normalized = normalize_company_city(m.group(1))
        if not normalized:
            continue
        if key == "hq_location_city":
            city = normalized
            break
        return normalized
    country = None
    m = re.search(
        r"\|\s*hq_location_country\s*=\s*(.+?)(?:\n\s*\||\n\}\})",
        content,
        re.I | re.S,
    )
    if m:
        country = normalize_company_city(m.group(1))
    if city and country and country.lower() not in city.lower():
        return f"{city}, {country}"
    return city


async def wikipedia_summary_bundle(title: str) -> dict[str, str]:
    """Wikipedia lead extract + page image (logo only when not a campus photo)."""
    data = await _get_json(
        "https://en.wikipedia.org/api/rest_v1/page/summary/"
        f"{quote(title.replace(' ', '_'))}"
    )
    out: dict[str, str] = {}
    if not isinstance(data, dict):
        return out
    extract = data.get("extract")
    if isinstance(extract, str):
        text = re.sub(r"\s+", " ", extract).strip()
        if 40 <= len(text) <= 1200:
            out["description"] = text[:800]
    img = data.get("originalimage") or data.get("thumbnail") or {}
    src = img.get("source") if isinstance(img, dict) else None
    if isinstance(src, str) and is_likely_brand_logo_image_url(src):
        out["logoUrl"] = src
    return out


async def wikipedia_summary_extract(title: str) -> str | None:
    """Short Wikipedia lead extract — what the company does."""
    return (await wikipedia_summary_bundle(title)).get("description")


async def _wikipedia_wikitext(title: str) -> str | None:
    url = (
        "https://en.wikipedia.org/w/api.php?action=query&prop=revisions"
        f"&rvprop=content&rvslots=main&titles={quote(title)}&format=json&formatversion=2"
    )
    data = await _get_json(url, timeout=14.0, retries=2)
    content = None
    try:
        content = data["query"]["pages"][0]["revisions"][0]["slots"]["main"]["content"]
    except Exception:
        content = None
    if not content:
        parsed = await _get_json(
            "https://en.wikipedia.org/w/api.php?action=parse&prop=wikitext&page="
            + quote(title)
            + "&format=json",
            timeout=14.0,
            retries=1,
        )
        try:
            content = ((parsed or {}).get("parse") or {}).get("wikitext") or {}
            if isinstance(content, dict):
                content = content.get("*")
        except Exception:
            content = None
    return str(content) if content else None


_NEWS_SITE_HOSTS = (
    "indiatimes.com",
    "bloomberg.com",
    "reuters.com",
    "forbes.com",
    "wsj.com",
    "nytimes.com",
    "thehindu.com",
    "wikipedia.org",
    "wikimedia.org",
    "google.com",
    "youtube.com",
    "q4cdn.com",
)


def parse_wikipedia_infobox_website(content: str | None) -> str | None:
    """Official site from a Wikipedia infobox (not citation URLs)."""
    if not content:
        return None
    m = re.search(
        r"\|\s*(?:website|homepage)\s*=[ \t]*(.+?)(?:\n\s*\|\s*[A-Za-z_]|\n\}\})",
        content,
        re.I,
    )
    if not m:
        return None
    raw = m.group(1)
    raw = re.sub(r"<ref[^>]*>.*?</ref>", " ", raw, flags=re.I | re.S)
    found = re.search(r"https?://[^\s\]\|\}]+", raw, re.I)
    if not found:
        found = re.search(
            r"(?:www\.)?[a-z0-9][a-z0-9.-]+\.[a-z]{2,}",
            raw,
            re.I,
        )
    if not found:
        return None
    host = _normalize_host(found.group(0))
    if not host:
        return None
    lower = host.lower()
    if any(lower == h or lower.endswith(f".{h}") for h in _NEWS_SITE_HOSTS):
        return None
    return host


def wikipedia_title_from_url(url: str | None) -> str | None:
    raw = (url or "").strip()
    if not raw:
        return None
    m = re.search(
        r"https?://(?:en\.)?wikipedia\.org/wiki/([^?#]+)",
        raw,
        re.I,
    )
    if not m:
        return None
    title = unquote(m.group(1).replace("_", " ")).strip()
    if not title or title.lower().startswith("special:"):
        return None
    return title


def parse_wikipedia_infobox_products(content: str | None) -> str | None:
    """Named products/services from a Wikipedia infobox — not invented."""
    if not content:
        return None
    found: list[str] = []
    for m in re.finditer(
        r"\|\s*(?:products?|services?|offerings?)\s*=[ \t]*(.*?)(?:\n\s*\|\s*[A-Za-z_]|\n\}\})",
        content,
        re.I,
    ):
        raw = (m.group(1) or "").strip()
        if not raw or raw.startswith("|"):
            continue
        raw = re.sub(r"<ref[^>]*>.*?</ref>", " ", raw, flags=re.I | re.S)
        raw = re.sub(r"\{\{[^}]+\}\}", " ", raw)
        raw = re.sub(r"\[\[([^|\]]+)\|([^\]]+)\]\]", r"\2", raw)
        raw = re.sub(r"\[\[([^\]]+)\]\]", r"\1", raw)
        raw = re.sub(r"<br\s*/?>", ";", raw, flags=re.I)
        raw = re.sub(r"<[^>]+>", " ", raw)
        cleaned = normalize_products_value(re.split(r"[,;•·\n]", raw))
        if cleaned:
            found.append(cleaned)
    return normalize_products_value("; ".join(found)) if found else None




_WIKI_SKIP_RE = re.compile(
    r"\b(disambiguation|may refer to|luxury car|automobile|car model|"
    r"sports car|vehicle manufactured|syndrome|disease|rocket stage|"
    r"video game|fandom)\b",
    re.I,
)


def _score_wikipedia_company_page(
    company_name: str, title: str, extract: str
) -> int:
    blob = f"{title} {extract}"
    if _WIKI_SKIP_RE.search(blob):
        return -100
    score = 0
    if re.search(
        r"\b(compan(?:y|ies)|corporation|multinational|enterprise|software|"
        r"information technology|it services|outsourcing|consulting)\b",
        blob,
        re.I,
    ):
        score += 40
    if acronym_matches_entity_text(company_name, blob):
        score += 55
    elif company_name.lower() in title.lower():
        score += 20
    if re.search(
        r"\b(information technology|it services|outsourcing|software|consulting)\b",
        blob,
        re.I,
    ):
        score += 25
    return score


async def _firmographics_from_wiki_title(title: str) -> dict[str, Any] | None:
    bundle = await wikipedia_summary_bundle(title)
    extract = str(bundle.get("description") or "").strip()
    wiki_text = await _wikipedia_wikitext(title)
    out: dict[str, Any] = {
        "wikiTitle": title,
        "sourceUrl": f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}",
    }
    if extract:
        out["description"] = extract[:800]
    # Infobox `| logo =` and Wikidata P154 beat Wikipedia summary thumbnails.
    logo_files: list[str] = []
    if wiki_text:
        infobox_logo = parse_wikipedia_infobox_logo(wiki_text)
        if infobox_logo:
            logo_files.append(infobox_logo)
        site = parse_wikipedia_infobox_website(wiki_text)
        if site:
            out["domain"] = site
        products = parse_wikipedia_infobox_products(wiki_text)
        if products:
            out["products"] = products
        emp, year = parse_wikipedia_infobox_employees(wiki_text)
        if emp:
            out["employeeCount"] = emp
        city = parse_wikipedia_infobox_headquarters(wiki_text)
        if city:
            out["city"] = city
    wd = await _wikidata_claims_from_enwiki_title(title)
    if wd:
        if wd.get("domain") and not out.get("domain"):
            out["domain"] = wd["domain"]
        logo_files.extend(wd.get("logoFiles") or [])
        if wd.get("linkedinUrl") and not out.get("linkedinUrl"):
            out["linkedinUrl"] = wd["linkedinUrl"]
    best_logo = pick_best_logo_filename(logo_files, title)
    if best_logo:
        out["logoUrl"] = commons_filepath_url(best_logo)
    elif bundle.get("logoUrl"):
        out["logoUrl"] = bundle["logoUrl"]
    if not any(k in out for k in ("description", "domain", "products", "employeeCount")):
        return None
    return out


async def _wikidata_claims_from_enwiki_title(title: str) -> dict[str, Any] | None:
    """Resolve P856 / P154 via the enwiki sitelink (works when search misses tickers)."""
    raw_title = (title or "").strip()
    if not raw_title:
        return None
    data = await _get_json(
        "https://www.wikidata.org/w/api.php?action=wbgetentities&sites=enwiki&titles="
        + quote(raw_title)
        + "&props=claims|labels&languages=en&format=json"
    )
    ents = (data or {}).get("entities") or {}
    for qid, ent in ents.items():
        if not isinstance(ent, dict) or str(qid).startswith("-"):
            continue
        claims = ent.get("claims") or {}
        out: dict[str, Any] = {}
        sites = _claim_strings(claims, "P856")
        if sites:
            out["domain"] = _normalize_host(sites[0])
        logos = _claim_strings(claims, "P154")
        if logos:
            out["logoFiles"] = logos
        li = _claim_strings(claims, "P4264")
        if li:
            out["linkedinUrl"] = (
                f"https://www.linkedin.com/company/{li[0].strip().strip('/')}"
            )
        return out or None
    return None


async def _wikipedia_search_titles(query: str, limit: int = 8) -> list[str]:
    """Wikipedia search API — more stable than scraping Google/DDG HTML."""
    data = await _get_json(
        "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch="
        + quote(query)
        + f"&srlimit={limit}&format=json"
    )
    titles: list[str] = []
    for hit in (data or {}).get("query", {}).get("search") or []:
        title = str(hit.get("title") or "").strip()
        if not title or title.endswith("(disambiguation)"):
            continue
        titles.append(title)
    return titles


async def resolve_company_via_web_search(
    company_name: str,
    seed_hits: list[dict[str, str]] | None = None,
) -> dict[str, Any] | None:
    """When the name is ambiguous (CTS), search like 'CTS wikipedia'.

    Wikipedia search API first (stable), DuckDuckGo HTML as a supplement.
    Wikipedia itself is the source — not Google scrape.
    """
    from app.tools.ddg_search import hostname_of, search_duckduckgo

    name = (company_name or "").strip()
    if not name:
        return None
    queries: list[str] = []
    if is_short_company_acronym(name):
        queries.extend(
            [
                f"{name} outsourcing",
                f"{name} IT services",
                f"{name} technology solutions",
            ]
        )
    queries.extend([f"{name} company", f"{name} wikipedia"])
    seen: set[str] = set()
    titles: list[str] = []
    for query in queries:
        for title in await _wikipedia_search_titles(query):
            if title.lower() in seen:
                continue
            seen.add(title.lower())
            titles.append(title)
            if len(titles) >= 8:
                break
        if len(titles) >= 8:
            break

    hits = list(seed_hits or [])
    if len(titles) < 4:
        try:
            hits.extend(await search_duckduckgo(f"{name} wikipedia"))
            if is_short_company_acronym(name):
                hits.extend(await search_duckduckgo(f"{name} company"))
        except Exception:
            hits = list(seed_hits or [])
    for hit in hits:
        host = hostname_of(hit.get("url") or "")
        if host not in {"en.wikipedia.org", "wikipedia.org"}:
            continue
        title = wikipedia_title_from_url(hit.get("url"))
        if not title or title.lower() in seen:
            continue
        if title.endswith("(disambiguation)"):
            continue
        seen.add(title.lower())
        titles.append(title)
        if len(titles) >= 16:
            break

    best: dict[str, Any] | None = None
    best_score = 0
    acronym = is_short_company_acronym(name)
    for title in titles:
        bundle = await wikipedia_summary_bundle(title)
        extract = str(bundle.get("description") or "").strip()
        if acronym:
            if len(extract) < 40:
                continue
            if not acronym_matches_entity_text(name, f"{title} {extract}"):
                continue
        score = _score_wikipedia_company_page(name, title, extract)
        if score > best_score:
            best_score = score
            best = {"title": title, "extract": extract, "bundle": bundle}
        if best_score >= 100:
            break
    min_score = 80 if acronym else 50
    if not best or best_score < min_score:
        return None
    out = await _firmographics_from_wiki_title(str(best["title"]))
    if not out:
        return None
    if not wiki_firmographics_match_company(name, out):
        # Description-only acronym expansion still usable for summary fields.
        if not (
            out.get("description")
            and acronym_matches_entity_text(
                name, f"{out.get('wikiTitle', '')} {out.get('description', '')}"
            )
        ):
            return None
    return out


async def lookup_wikidata_firmographics(
    company_name: str,
    company_domain: str | None = None,
    wiki_title: str | None = None,
) -> dict[str, Any] | None:
    name = (company_name or "").strip()
    if not name:
        return None
    search_terms = [name]
    if is_short_company_acronym(name):
        search_terms.extend(
            [
                f"{name} Technologies",
                f"{name}Tech",
                f"{name} company",
            ]
        )
    if wiki_title and wiki_title.strip() not in search_terms:
        search_terms.insert(0, wiki_title.strip())
    hits: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for term in search_terms:
        search = await _get_json(
            "https://www.wikidata.org/w/api.php?action=wbsearchentities"
            f"&search={quote(term)}&language=en&format=json&limit=5&type=item"
        )
        for hit in (search or {}).get("search") or []:
            hid = str(hit.get("id") or "")
            if not hid or hid in seen_ids:
                continue
            seen_ids.add(hid)
            hits.append(hit)
        if len(hits) >= 8:
            break
    if not hits and wiki_title:
        sitelink = await _wikidata_claims_from_enwiki_title(wiki_title)
        if sitelink:
            out: dict[str, Any] = {
                "sourceUrl": (
                    f"https://en.wikipedia.org/wiki/{wiki_title.replace(' ', '_')}"
                ),
                "wikiTitle": wiki_title,
            }
            if sitelink.get("domain"):
                out["domain"] = sitelink["domain"]
            best_logo = pick_best_logo_filename(
                sitelink.get("logoFiles") or [], name
            )
            if best_logo:
                out["logoUrl"] = commons_filepath_url(best_logo)
            if sitelink.get("linkedinUrl"):
                out["linkedinUrl"] = sitelink["linkedinUrl"]
            bundle = await wikipedia_summary_bundle(wiki_title)
            if bundle.get("description"):
                out["description"] = bundle["description"]
            if out.get("domain") or out.get("logoUrl") or out.get("description"):
                if wiki_firmographics_match_company(name, out):
                    return out
    if not hits:
        return None
    ids = "|".join(h["id"] for h in hits[:8])
    entities = await _get_json(
        "https://www.wikidata.org/w/api.php?action=wbgetentities"
        f"&ids={ids}&props=labels|descriptions|claims|sitelinks&languages=en&format=json"
    )
    ents = (entities or {}).get("entities") or {}
    best_id = None
    best_score = 0
    best_claims: dict[str, Any] | None = None
    best_wiki = None
    best_description = ""
    for hit in hits:
        ent = ents.get(hit["id"]) or {}
        claims = ent.get("claims") or {}
        sites = _claim_strings(claims, "P856")
        wiki_desc = (
            ((ent.get("descriptions") or {}).get("en") or {}).get("value")
            or hit.get("description")
            or ""
        )
        score = _score_candidate(
            ((ent.get("labels") or {}).get("en") or {}).get("value")
            or hit.get("label")
            or "",
            wiki_desc,
            name,
            company_domain,
            sites,
        )
        enwiki = ((ent.get("sitelinks") or {}).get("enwiki") or {}).get("title")
        want_wiki = (wiki_title or "").strip().lower()
        if want_wiki and str(enwiki or "").strip().lower() == want_wiki:
            score += 80
        if score > best_score:
            best_score = score
            best_id = hit["id"]
            best_claims = claims
            best_wiki = ((ent.get("sitelinks") or {}).get("enwiki") or {}).get("title")
            best_description = str(wiki_desc or "").strip()
    if not best_id or not best_claims or best_score < 40:
        return None
    out = {"sourceUrl": f"https://www.wikidata.org/wiki/{best_id}"}
    li = _claim_strings(best_claims, "P4264")
    if li:
        out["linkedinUrl"] = (
            f"https://www.linkedin.com/company/{li[0].strip().strip('/')}"
        )
    wd_emp, wd_year = latest_employee_claim(best_claims)
    sites = _claim_strings(best_claims, "P856")
    if sites:
        out["domain"] = _normalize_host(sites[0])
    logo_files = _claim_strings(best_claims, "P154") or _claim_strings(
        best_claims, "P18"
    )
    best_logo = pick_best_logo_filename(logo_files, name)
    if best_logo:
        out["logoUrl"] = commons_filepath_url(best_logo)
    hq_ids = _claim_entity_ids(best_claims, "P159")
    wiki_text = None
    wiki_emp, wiki_year = None, None
    if best_wiki:
        wiki_text = await _wikipedia_wikitext(str(best_wiki))
        wiki_emp, wiki_year = parse_wikipedia_infobox_employees(wiki_text)
        products = parse_wikipedia_infobox_products(wiki_text)
        if products:
            out["products"] = products
        infobox_city = parse_wikipedia_infobox_headquarters(wiki_text)
        if infobox_city:
            out["city"] = infobox_city
        bundle = await wikipedia_summary_bundle(str(best_wiki))
        if bundle.get("description"):
            out["description"] = bundle["description"]
        elif len(best_description) >= 20:
            out["description"] = best_description[:800]
        if not out.get("logoUrl") and bundle.get("logoUrl"):
            out["logoUrl"] = bundle["logoUrl"]
        infobox_logo = parse_wikipedia_infobox_logo(wiki_text)
        if infobox_logo and not out.get("logoUrl"):
            out["logoUrl"] = commons_filepath_url(infobox_logo)
    elif len(best_description) >= 20:
        out["description"] = best_description[:800]
    emp, emp_src = pick_employee_count(wd_emp, wd_year, wiki_emp, wiki_year)
    if emp:
        out["employeeCount"] = emp
        if emp_src == "wikipedia" and best_wiki:
            out["sourceUrl"] = (
                f"https://en.wikipedia.org/wiki/{str(best_wiki).replace(' ', '_')}"
            )
    if "city" not in out and hq_ids:
        hq_ents = await _get_json(
            "https://www.wikidata.org/w/api.php?action=wbgetentities"
            f"&ids={'|'.join(hq_ids[:3])}&props=labels&languages=en&format=json"
        )
        labels = (hq_ents or {}).get("entities") or {}
        for qid in hq_ids[:3]:
            label = ((labels.get(qid) or {}).get("labels") or {}).get("en") or {}
            city = normalize_company_city(
                label.get("value") if isinstance(label, dict) else None
            )
            if city:
                out["city"] = city
                break
    if not any(k in out for k in ("employeeCount", "linkedinUrl", "domain", "description")):
        return None
    if not wiki_firmographics_match_company(name, out):
        return None
    return out



def extract_linkedin_company_url(html: str) -> str | None:
    m = re.search(
        r"https?://(?:www\.)?linkedin\.com/company/[a-zA-Z0-9_-]+/?",
        html,
        re.I,
    )
    if not m:
        return None
    return m.group(0).rstrip("/").split("?")[0]
