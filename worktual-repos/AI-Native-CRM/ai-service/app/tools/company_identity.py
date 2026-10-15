"""Company name vs domain / LinkedIn identity checks for lead enrichment."""

from __future__ import annotations

import re

_ACRONYM_SKIP_WORDS = frozenset(
    {
        "the",
        "and",
        "of",
        "a",
        "an",
        "inc",
        "incorporated",
        "ltd",
        "llc",
        "corp",
        "corporation",
        "company",
        "co",
        "plc",
        "sa",
        "ag",
        "gmbh",
        "group",
        "holding",
        "holdings",
        "international",
        "worldwide",
        "limited",
        "private",
        "http",
        "https",
        "www",
        "com",
        "org",
        "net",
        "wiki",
        "wikipedia",
        "wikidata",
        "html",
    }
)

_GENERIC_NAME_TOKENS = frozenset(
    {
        "services",
        "solutions",
        "technologies",
        "technology",
        "systems",
        "group",
        "company",
        "limited",
        "private",
        "india",
        "global",
        "digital",
    }
)


def _name_tokens(company_name: str | None) -> tuple[str, list[str]]:
    name = re.sub(r"[^a-z0-9]+", " ", (company_name or "").lower()).strip()
    tokens = [t for t in name.split() if len(t) >= 3]
    meaningful = [t for t in tokens if t not in _GENERIC_NAME_TOKENS]
    return name, meaningful


def _host_slug(value: str | None) -> str:
    raw = (value or "").strip().lower()
    raw = re.sub(r"^https?://", "", raw)
    raw = re.sub(r"^www\.", "", raw)
    host = raw.split("/")[0].split("?")[0]
    return host.split(".")[0] if host else ""


def is_short_company_acronym(name: str | None) -> bool:
    """True for 2–5 letter tickers / abbreviations (CTS, TCS, IBM).

    Title-case brand names (Zepto, Zoho, Stripe) must NOT use this path —
    their real sites are often zeptonow.com / stripe.com and need normal
    contains matching + web search. Only ALL-CAPS compact names are tickers.
    """
    compact = re.sub(r"[.\s]", "", (name or "").strip())
    if not re.fullmatch(r"[A-Za-z]{2,5}", compact):
        return False
    return compact.isupper()


def acronym_matches_entity_text(acronym: str | None, text: str | None) -> bool:
    """True when text expands the acronym (Cognizant Technology Solutions → CTS).

    Also accepts brand forms where the acronym is the leading name token
    (HCL Technologies, HCLTech) — common for Indian IT tickers whose wiki
    title is the acronym itself rather than a Hindustan-Computers-style expand.
    Does not treat a lone 'CTS' token as enough — that matches too many pages.
    """
    ac = re.sub(r"[^A-Za-z]", "", acronym or "").upper()
    blob = re.sub(r"https?://\S+", " ", text or "")
    if len(ac) < 2 or not blob.strip():
        return False
    lead = blob[:240]
    if re.search(
        rf"\b(?:known as|also called|abbreviated(?:\s+as)?|short(?:ened)?(?:\s+for)?|"
        rf"trading as|dba)\s+{re.escape(ac)}\b",
        lead,
        re.I,
    ):
        return True
    if re.search(rf"\({re.escape(ac)}\)", blob[:100]):
        return True
    # Brand form: "HCL Technologies Limited…", "TCS" + company suffix in lead.
    if re.search(
        rf"(?:^|[\s(]){re.escape(ac)}\s+"
        rf"(?:Technologies|Technology|Tech|Group|Systems|Solutions|Services|"
        rf"Software|Consulting|Corporation|Corp|Limited|Ltd|Inc|Labs|"
        rf"Communications|Infosystems)\b",
        lead,
        re.I,
    ):
        return True
    # Compound wiki titles like HCLTech when the extract is clearly a company.
    first = re.match(r"^[A-Za-z0-9]+", lead.strip())
    if first:
        token = first.group(0)
        if (
            token.upper().startswith(ac)
            and len(ac) < len(token) <= len(ac) + 10
            and re.search(
                r"\b(compan(?:y|ies)|corporation|multinational|headquartered|"
                r"enterprise|information technology|it services)\b",
                blob[:500],
                re.I,
            )
        ):
            return True
    words = re.findall(r"[A-Za-z]+", blob)
    significant: list[str] = []
    for w in words:
        if w.lower() in _ACRONYM_SKIP_WORDS:
            continue
        if w.upper() == ac:
            continue
        significant.append(w)
        if len(significant) >= max(12, len(ac) + 6):
            break
    n = len(ac)
    if len(significant) < n:
        return False
    for i in range(0, len(significant) - n + 1):
        initials = "".join(w[0] for w in significant[i : i + n]).upper()
        if initials == ac:
            return True
    return False


def _evidence_clearly_about_company(
    company_name: str | None, evidence: str | None
) -> bool:
    """True when wiki lead/title clearly names this company (brand pages)."""
    name = (company_name or "").strip()
    if len(name) < 4:
        return False
    lead = re.sub(r"\s+", " ", (evidence or "").strip())[:280]
    if not lead:
        return False
    return bool(re.search(rf"\b{re.escape(name)}\b", lead, re.I))


def company_identity_allows_domain(
    company_name: str | None,
    domain: str | None,
    *,
    evidence_text: str | None = None,
    source_url: str | None = None,
) -> bool:
    """Name-in-host, or trusted wiki evidence for tickers / brand subsidiaries.

    Examples: CTS→cognizant.com (acronym expansion), Hotstar→disneyplus.com
    (brand article lists parent official site). Never trusts free search alone.
    """
    if company_name_matches_domain(company_name, domain):
        return True
    if not is_trusted_firmographic_source(source_url):
        return False
    evidence = " ".join(p for p in (evidence_text, source_url) if p)
    if is_short_company_acronym(company_name):
        return acronym_matches_entity_text(company_name, evidence)
    # Brand / product: Wikipedia article about Hotstar may list disneyplus.com.
    return _evidence_clearly_about_company(company_name, evidence)


def company_name_matches_domain(
    company_name: str | None, domain: str | None
) -> bool:
    """True when name and domain likely refer to the same org.

    Blocks Zendesk + zoho.com (and similar enrichment mix-ups).
    Short acronyms (CTS) must match the slug exactly — ctscorp.com is not CTS.
    """
    name, meaningful = _name_tokens(company_name)
    host = _host_slug(domain)
    if not name or not host or len(host) < 3:
        return False
    if is_short_company_acronym(company_name):
        compact = re.sub(r"[.\s]", "", (company_name or "").strip()).lower()
        return host == compact or host.replace("-", "") == compact
    if not meaningful:
        return len(host) >= 4 and host in name
    return any(t in host or host in t or host in name for t in meaningful)


def company_name_matches_linkedin(
    company_name: str | None, linkedin_url: str | None
) -> bool:
    """True when a LinkedIn company slug matches the company name."""
    raw = (linkedin_url or "").strip()
    if not raw:
        return False
    m = re.search(r"linkedin\.com/company/([^/?#]+)", raw, re.I)
    slug = (m.group(1) if m else raw).strip("/").lower()
    if not slug or slug in {"company", "school", "in"}:
        return False
    return company_name_matches_domain(company_name, f"{slug}.com")


def wiki_firmographics_match_company(
    company_name: str | None, wiki: dict | None
) -> bool:
    """Reject Wikidata hits whose official site / LinkedIn belong to another org."""
    if not wiki:
        return False
    evidence = " ".join(
        str(p)
        for p in (
            wiki.get("wikiTitle"),
            wiki.get("description"),
            wiki.get("sourceUrl"),
        )
        if p
    )
    src = str(wiki.get("sourceUrl") or "") or None
    domain = wiki.get("domain")
    linkedin = wiki.get("linkedinUrl")
    if domain and not company_identity_allows_domain(
        company_name,
        str(domain),
        evidence_text=evidence,
        source_url=src,
    ):
        return False
    if linkedin and not (
        company_name_matches_linkedin(company_name, str(linkedin))
        or company_identity_allows_domain(
            company_name,
            str(linkedin),
            evidence_text=evidence,
            source_url=src,
        )
    ):
        return False
    if domain or linkedin:
        return True
    return bool(
        wiki.get("description")
        and acronym_matches_entity_text(company_name, evidence)
    )


_UNVERIFIABLE_LOGO_HOSTS = (
    "googleusercontent.com",
    "gstatic.com",
    "fbcdn.net",
)


def brand_host_from_logo_url(value: str | None) -> str | None:
    """Brand host implied by a logo URL (favicons ?domain=, Clearbit, or image host)."""
    raw = (value or "").strip()
    if not raw:
        return None
    if raw.lower().startswith("favicon:"):
        host = raw.split(":", 1)[-1].strip().lower().removeprefix("www.")
        return host or None
    try:
        from urllib.parse import parse_qs, urlparse

        parsed = urlparse(raw if "://" in raw else f"https://{raw}")
        host = (parsed.hostname or "").lower().removeprefix("www.")
        if not host:
            return None
        if "google." in host and "favicon" in (parsed.path or "").lower():
            domain = (parse_qs(parsed.query).get("domain") or [None])[0]
            if domain:
                return str(domain).lower().removeprefix("www.").split("/")[0]
        if "clearbit.com" in host:
            slug = (parsed.path or "").strip("/").split("/")[0].lower().removeprefix(
                "www."
            )
            if "." in slug:
                return slug
        if any(host == h or host.endswith(f".{h}") for h in _UNVERIFIABLE_LOGO_HOSTS):
            return None
        return host
    except Exception:
        return None


def is_synthetic_company_logo_url(value: str | None) -> bool:
    """Google favicon / Clearbit URLs — not a logo fetched from the company site."""
    raw = (value or "").strip()
    if not raw:
        return False
    if raw.lower().startswith("favicon:"):
        return True
    try:
        from urllib.parse import urlparse

        parsed = urlparse(raw if "://" in raw else f"https://{raw}")
        host = (parsed.hostname or "").lower().removeprefix("www.")
        if "google." in host and "favicon" in (parsed.path or "").lower():
            return True
        if host == "logo.clearbit.com" or host.endswith(".clearbit.com"):
            return True
        return False
    except Exception:
        return False


def _logo_url_mentions_company(company_name: str | None, logo_url: str | None) -> bool:
    _, meaningful = _name_tokens(company_name)
    url = (logo_url or "").lower()
    if not url:
        return False
    if any(len(t) >= 4 and t in url for t in meaningful):
        return True
    # Short tickers (HCL, TCS): filename often embeds the acronym + brand form.
    if is_short_company_acronym(company_name):
        ac = re.sub(r"[^a-z]", "", (company_name or "").lower())
        fname = url.split("/")[-1].split("?")[0]
        if (
            ac
            and len(ac) >= 2
            and ac in fname
            and (
                "logo" in fname
                or "tech" in fname
                or fname.startswith(ac)
                or f"{ac}_" in fname
                or f"{ac}-" in fname
            )
        ):
            return True
    return False


def scrape_host_allowed(
    company_name: str | None,
    host: str | None,
    *,
    trusted_domain: str | None = None,
    evidence_text: str | None = None,
    source_url: str | None = None,
) -> bool:
    """Allow scraping this host: same as wiki-resolved domain, or name match."""
    if not host:
        return False
    if trusted_domain and _hosts_same_company_site(host, trusted_domain):
        return True
    if company_name_matches_domain(company_name, host):
        return True
    return company_identity_allows_domain(
        company_name,
        host,
        evidence_text=evidence_text,
        source_url=source_url,
    )


def _hosts_same_company_site(a: str | None, b: str | None) -> bool:
    ha = (a or "").lower().removeprefix("www.")
    hb = (b or "").lower().removeprefix("www.")
    if not ha or not hb:
        return False
    if ha == hb or ha.endswith(f".{hb}") or hb.endswith(f".{ha}"):
        return True
    ra = ".".join(ha.split(".")[-2:])
    rb = ".".join(hb.split(".")[-2:])
    return len(ra) >= 4 and ra == rb


_GENERIC_LOCATION_LABELS = frozenset(
    {
        "headquarters",
        "hq",
        "head office",
        "headoffice",
        "corporate office",
        "main office",
        "registered office",
        "worldwide",
        "global",
        "remote",
        "multiple locations",
        "n/a",
        "na",
        "none",
        "unknown",
        "tbd",
        "address",
    }
)


def is_generic_location_label(value: str | None) -> bool:
    """True for type labels like Headquarters — not a real city/address."""
    lower = re.sub(r"\s+", " ", (value or "").strip().lower())
    if not lower:
        return True
    if lower in _GENERIC_LOCATION_LABELS:
        return True
    if re.match(r"^(headquarters|hq|head office)\b", lower) and "," not in lower:
        return True
    return False


def normalize_company_city(value: str | None) -> str | None:
    """HQ geography from Wikipedia/Wikidata. Never 'Headquarters'."""
    text = re.sub(r"<ref[^>]*>.*?</ref>", " ", value or "", flags=re.I | re.S)
    text = re.sub(r"\{\{[^}]+\}\}", " ", text)
    text = re.sub(r"\[\[([^|\]]+)\|([^\]]+)\]\]", r"\2", text)
    text = re.sub(r"\[\[([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"<br\s*/?>", ", ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"^(headquarters|hq|head office)\s*[,:]\s*", "", text, flags=re.I)
    text = re.sub(r"\s+", " ", text).strip(" ,;")
    if len(text) < 2 or len(text) > 90:
        return None
    if is_generic_location_label(text):
        return None
    if not re.search(r"[A-Za-z]", text):
        return None
    if re.match(r"^\d", text):
        return None
    if re.search(r"\b(worldwide|global|remote only|multiple locations)\b", text, re.I):
        return None
    return text


def is_trusted_firmographic_source(
    source_url: str | None,
    company_domain: str | None = None,
) -> bool:
    """Wikipedia, Wikidata, or the company's own site — not Google overviews."""
    raw = (source_url or "").strip()
    if not raw:
        return False
    try:
        from urllib.parse import urlparse

        host = urlparse(raw).hostname or ""
    except Exception:
        return False
    host = host.lower().removeprefix("www.")
    if host == "wikidata.org" or host.endswith(".wikidata.org"):
        return True
    if host == "wikipedia.org" or host.endswith(".wikipedia.org"):
        return True
    trusted = (company_domain or "").strip().lower().removeprefix("www.")
    if trusted and (host == trusted or host.endswith(f".{trusted}")):
        return True
    return False


def logo_url_belongs_to_company(
    company_name: str | None,
    logo_url: str | None,
    *,
    source_url: str | None = None,
    company_domain: str | None = None,
    evidence_text: str | None = None,
) -> bool:
    """True when the logo is this company's mark — not another brand (Zendesk ≠ Zoho)."""
    if is_synthetic_company_logo_url(logo_url):
        return False
    host = brand_host_from_logo_url(logo_url)
    trusted_domain = (company_domain or "").strip().lower().removeprefix("www.")
    # Icon on the company's known domain — but only when that domain is really theirs
    # (Zendesk must not keep a zoho.com favicon just because domain was mis-set).
    if host and trusted_domain and _hosts_same_company_site(host, trusted_domain):
        if company_name_matches_domain(company_name, trusted_domain):
            return True
        if company_identity_allows_domain(
            company_name,
            trusted_domain,
            evidence_text=evidence_text,
            source_url=source_url,
        ):
            return True
        if is_short_company_acronym(company_name):
            ac = re.sub(r"[^a-z]", "", (company_name or "").lower())
            slug = _host_slug(trusted_domain)
            if ac and slug.startswith(ac) and len(slug) <= len(ac) + 12:
                return True
    if host and (
        host == "wikimedia.org"
        or host.endswith(".wikimedia.org")
        or host == "wikipedia.org"
        or host.endswith(".wikipedia.org")
    ):
        if _logo_url_mentions_company(company_name, logo_url):
            return True
        if is_trusted_firmographic_source(source_url) and (
            company_identity_allows_domain(
                company_name,
                trusted_domain or host,
                evidence_text=evidence_text or "",
                source_url=source_url,
            )
            or acronym_matches_entity_text(
                company_name, evidence_text or source_url or ""
            )
        ):
            return True
    if host and company_name_matches_domain(company_name, host):
        trusted = (company_domain or "").strip()
        if not trusted or not company_name_matches_domain(company_name, trusted):
            return True
        trusted_slug = _host_slug(trusted)
        logo_slug = _host_slug(host)
        if len(trusted_slug) < 3 or len(logo_slug) < 3 or trusted_slug == logo_slug:
            return True
        if trusted_slug in host or logo_slug in trusted.lower():
            return True
        return _logo_url_mentions_company(company_name, logo_url)
    if _logo_url_mentions_company(company_name, logo_url):
        return True
    page_host = brand_host_from_logo_url(source_url)
    if (
        host
        and page_host
        and company_name_matches_domain(company_name, page_host)
        and _hosts_same_company_site(host, page_host)
    ):
        return True
    return False
