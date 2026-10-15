from __future__ import annotations

import json
import re
from typing import Any

from bs4 import BeautifulSoup


def extract_firmographics(html: str, page_url: str) -> dict[str, Any]:
    soup = BeautifulSoup(html, "lxml")
    out: dict[str, Any] = {"sourceUrl": page_url}

    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        try:
            data = json.loads(script.string or "")
        except Exception:
            continue
        nodes = data if isinstance(data, list) else [data]
        for node in nodes:
            if not isinstance(node, dict):
                continue
            type_ = str(node.get("@type") or "")
            if not re.search(r"Organization|Corporation|LocalBusiness", type_, re.I):
                continue
            if isinstance(node.get("name"), str):
                out.setdefault("name", node["name"])
            if isinstance(node.get("industry"), str):
                out.setdefault("industry", node["industry"])
            ld_logo = _jsonld_logo_url(node)
            if ld_logo:
                abs_logo = _absolutize(ld_logo, page_url)
                if abs_logo:
                    out.setdefault("logoUrl", abs_logo)
            if isinstance(node.get("description"), str):
                cleaned = _clean_description(node["description"])
                if cleaned:
                    out.setdefault("description", cleaned)
            products = _products_from_jsonld(node)
            if products:
                out.setdefault("products", products)
            emp = node.get("numberOfEmployees")
            if isinstance(emp, (int, float)):
                out.setdefault("employeeCount", int(emp))
            elif isinstance(emp, dict) and "value" in emp:
                try:
                    out.setdefault("employeeCount", int(emp["value"]))
                except Exception:
                    pass
            addr = node.get("address")
            if isinstance(addr, dict):
                street = addr.get("streetAddress")
                city = addr.get("addressLocality")
                region = addr.get("addressRegion")
                postal = addr.get("postalCode")
                country = addr.get("addressCountry")
                if isinstance(country, dict):
                    country = country.get("name")
                if isinstance(street, str) and street.strip():
                    parts = [
                        street.strip(),
                        city.strip() if isinstance(city, str) else "",
                        region.strip() if isinstance(region, str) else "",
                        postal.strip() if isinstance(postal, str) else "",
                        country.strip() if isinstance(country, str) else "",
                    ]
                    joined = ", ".join(p for p in parts if p)
                    if _is_plausible_address(joined):
                        out.setdefault("address", joined)
                if isinstance(city, str) and city.strip():
                    out.setdefault("city", city.strip())

    def meta(prop: str) -> str | None:
        tag = soup.find("meta", attrs={"property": prop}) or soup.find(
            "meta", attrs={"name": prop}
        )
        if tag and tag.get("content"):
            return str(tag["content"]).strip()
        return None

    desc = meta("og:description") or meta("description") or ""
    cleaned_desc = _clean_description(desc)
    if cleaned_desc:
        out.setdefault("description", cleaned_desc)
    if "industry" not in out and desc:
        guessed = guess_industry(desc)
        if guessed:
            out["industry"] = guessed
            out["industryConfidence"] = 45
    else:
        out.setdefault("industryConfidence", 70)

    title_tag = soup.find("title")
    if title_tag and title_tag.string:
        out.setdefault("pageTitle", title_tag.string.strip())

    if "products" not in out:
        from_dom = _extract_products_from_dom(soup)
        if from_dom:
            out["products"] = from_dom

    if "logoUrl" not in out:
        logo = _extract_logo(soup, page_url)
        if logo:
            out["logoUrl"] = logo

    if "employeeCount" not in out:
        n = extract_employee_count_from_text(soup.get_text(" ", strip=True))
        if n:
            out["employeeCount"] = n

    return out


_EMP_LABEL_RE = (
    r"(?:global\s+)?(?:employees?|workforce|associates|professionals|"
    r"hexawarians|team members|headcount|people worldwide)"
)
_EMP_NUM_RE = (
    r"((?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*[kKmM]?)\s*\+?"
)
_EMP_NEAR_RE = re.compile(
    rf"(?:{_EMP_NUM_RE}\s*{_EMP_LABEL_RE})|(?:{_EMP_LABEL_RE}\s*(?:of|:)?\s*{_EMP_NUM_RE})",
    re.I,
)


def parse_headcount_token(raw: str | None) -> int | None:
    """Parse 33K+, 31,605, 5.8k into an employee count. Reject billions (usually revenue)."""
    original = raw or ""
    had_comma = "," in original
    s = re.sub(r"[\s,]", "", original.strip().lower()).rstrip("+")
    m = re.match(r"^(\d+(?:\.\d+)?)([km])?$", s)
    if not m:
        return None
    n = float(m.group(1))
    suf = m.group(2)
    if suf == "k":
        n *= 1_000
    elif suf == "m":
        n *= 1_000_000
    count = int(round(n))
    # Bare 1990–2035 without K/M or thousands separator is almost always a year.
    if suf is None and not had_comma and 1990 <= count <= 2035:
        return None
    if 10 <= count <= 20_000_000:
        return count
    return None


def extract_employee_count_from_text(text: str | None) -> int | None:
    """First-party about/key-facts copy, e.g. '33K+ Global Employees'."""
    blob = re.sub(r"\s+", " ", text or "")
    if not blob:
        return None
    best: int | None = None
    for m in _EMP_NEAR_RE.finditer(blob):
        token = next((g for g in m.groups() if g), None)
        n = parse_headcount_token(token)
        if not n:
            continue
        # Prefer global/total figure over a small office headcount on the same page.
        best = n if best is None else max(best, n)
    return best


_BANNED_ADDRESSES = {
    "headquarters",
    "hq",
    "head office",
    "headoffice",
    "corporate office",
    "main office",
    "registered office",
    "n/a",
    "na",
    "none",
    "unknown",
    "address",
    "tbd",
}


def _is_plausible_address(value: str | None) -> bool:
    raw = (value or "").strip()
    if len(raw) < 8 or len(raw) > 180:
        return False
    lower = re.sub(r"\s+", " ", raw.lower())
    if lower in _BANNED_ADDRESSES:
        return False
    if re.match(r"^(headquarters|hq|head office)\b", lower) and not re.search(r"\d", lower):
        return False
    if re.match(r"^https?://", raw, re.I):
        return False
    if re.search(
        r"\b(projects?|clients?|chatbot|gpt-?\d|leveraging|running|happy clients|testimonials?|subscribe|cookie|privacy)\b",
        lower,
    ):
        return False
    has_street = bool(
        re.search(
            r"\b(st|street|rd|road|ave|avenue|blvd|lane|ln|dr|drive|way|court|ct|plot|floor|suite|ste|building|bldg|near|cross|nagar|colony|phase|sector|block|apartment|apt|marg|chowk)\b",
            lower,
        )
    )
    if not re.search(r"\d", raw) or not has_street:
        return False
    if re.search(r"\b(google rating|rating score|best digital|reviews?|stars?)\b", lower):
        return False
    return True


def _absolutize(href: str, page_url: str) -> str | None:
    try:
        from urllib.parse import urljoin

        return urljoin(page_url, href)
    except Exception:
        return None


def _jsonld_logo_url(node: dict) -> str | None:
    logo = node.get("logo")
    if isinstance(logo, str) and logo.strip():
        return logo.strip()
    if isinstance(logo, dict):
        url = logo.get("url") or logo.get("contentUrl")
        if isinstance(url, str) and url.strip():
            return url.strip()
    return None


def _page_host(url: str | None) -> str | None:
    try:
        from urllib.parse import urlparse

        host = (urlparse(url or "").hostname or "").lower().removeprefix("www.")
        return host or None
    except Exception:
        return None


_LOGO_REL_RE = re.compile(
    r"apple-touch-icon|shortcut icon|\bicon\b|mask-icon|fluid-icon",
    re.I,
)
_LOGO_HINT_RE = re.compile(r"logo|brand|mark|wordmark|icon", re.I)
_IMG_EXT_RE = re.compile(r"\.(png|svg|webp|jpe?g|ico|gif)(\?|$)", re.I)
_PARTNER_IMG_RE = re.compile(
    r"partner|client|customer|testimonial|award|sponsor|press",
    re.I,
)


def _extract_logo(soup: BeautifulSoup, page_url: str) -> str | None:
    """Pull a real site logo from the fetched homepage — not a third-party favicon API."""
    page_host = _page_host(page_url)
    scored: list[tuple[float, str]] = []

    def add(url: str | None, score: float) -> None:
        if url:
            scored.append((score, url))

    for tag in soup.find_all("link", href=True):
        rel = tag.get("rel")
        rel_s = " ".join(rel).lower() if isinstance(rel, list) else str(rel or "").lower()
        href = str(tag.get("href") or "").strip()
        if not href or not _LOGO_REL_RE.search(rel_s):
            continue
        abs_url = _absolutize(href, page_url)
        if not abs_url:
            continue
        score = 20.0
        if "apple-touch" in rel_s:
            score += 30
        if _IMG_EXT_RE.search(href) and not re.search(r"\.ico(\?|$)", href, re.I):
            score += 15
        elif re.search(r"\.ico(\?|$)", href, re.I):
            score += 8
        sizes = str(tag.get("sizes") or "")
        m = re.search(r"(\d+)", sizes)
        if m:
            score += min(int(m.group(1)), 256) / 32
        add(abs_url, score)

    for prop in ("msapplication-TileImage", "msapplication-square150x150logo"):
        tag = soup.find("meta", attrs={"name": prop})
        if tag and tag.get("content"):
            add(_absolutize(str(tag["content"]).strip(), page_url), 28)

    def meta_content(prop: str) -> str | None:
        tag = soup.find("meta", attrs={"property": prop}) or soup.find(
            "meta", attrs={"name": prop}
        )
        if tag and tag.get("content"):
            return str(tag["content"]).strip()
        return None

    for prop in ("og:image", "twitter:image", "twitter:image:src"):
        content = meta_content(prop)
        if not content:
            continue
        abs_url = _absolutize(content, page_url)
        if not abs_url:
            continue
        score = 18.0
        if _LOGO_HINT_RE.search(abs_url):
            score += 20
        img_host = _page_host(abs_url)
        if page_host and img_host and (
            img_host == page_host
            or img_host.endswith(f".{page_host}")
            or page_host.endswith(f".{img_host}")
        ):
            score += 16
        elif not _LOGO_HINT_RE.search(abs_url):
            score -= 8
        add(abs_url, score)

    for img in soup.find_all("img", src=True)[:60]:
        blob = " ".join(
            [
                str(img.get("src") or ""),
                str(img.get("alt") or ""),
                " ".join(img.get("class") or [])
                if isinstance(img.get("class"), list)
                else str(img.get("class") or ""),
                str(img.get("id") or ""),
            ]
        )
        if not _LOGO_HINT_RE.search(blob) or _PARTNER_IMG_RE.search(blob):
            continue
        add(_absolutize(str(img.get("src")).strip(), page_url), 32)
        break

    if scored:
        scored.sort(key=lambda row: -row[0])
        return scored[0][1]

    try:
        from urllib.parse import urlparse, urlunparse

        parsed = urlparse(page_url)
        if parsed.scheme in {"http", "https"} and parsed.netloc:
            return urlunparse((parsed.scheme, parsed.netloc, "/favicon.ico", "", "", ""))
    except Exception:
        pass
    return None


_PRODUCT_HEADING_RE = re.compile(
    r"\b(products?|solutions?|platforms?|offerings?|what we (?:do|offer)|our software)\b",
    re.I,
)
_JUNK_PRODUCT_RE = re.compile(
    r"^(learn more|get started|contact|sign up|log in|subscribe|read more|"
    r"see all|view all|cookie|privacy|terms|home|about|blog|careers?|"
    r"request demo|talk to sales|pricing)\b",
    re.I,
)
_PRODUCT_PATH_RE = re.compile(
    r"/(products?|solutions?|platforms?|offerings?|what-we-do)(/|$|\?)",
    re.I,
)
_ABOUT_PATH_RE = re.compile(
    r"/(about(?:-us)?|company|who-we-are|our-story)(/|$|\?)",
    re.I,
)
_LOCATION_PATH_RE = re.compile(
    r"/(locations?|offices?|contact(?:-us)?|global-presence|our-offices)(/|$|\?)",
    re.I,
)


def _clean_description(text: str | None) -> str | None:
    raw = re.sub(r"\s+", " ", (text or "").strip())
    if len(raw) < 40 or len(raw) > 900:
        return None
    lower = raw.lower()
    if re.search(
        r"cookie|subscribe to our newsletter|all rights reserved|lorem ipsum",
        lower,
    ):
        return None
    return raw[:800]


def _normalize_product_name(value: str | None) -> str | None:
    name = re.sub(r"\s+", " ", (value or "").strip())
    if len(name) < 2 or len(name) > 80:
        return None
    if _JUNK_PRODUCT_RE.search(name):
        return None
    if re.match(r"^https?://", name, re.I):
        return None
    if name.startswith("|") or re.match(r"^[a-z_]+\s*=", name, re.I) or re.search(
        r"[=:]$", name
    ):
        return None
    if name.lower() in {
        "brands",
        "products",
        "services",
        "offerings",
        "all markets",
        "markets",
        "solutions",
        "industries",
    }:
        return None
    return name


def normalize_products_value(value: Any) -> str | None:
    """Canonical '; '-joined product list from a string or list."""
    names: list[str] = []
    if isinstance(value, str):
        parts = re.split(r"[;|,]", value)
    elif isinstance(value, list):
        parts = value
    else:
        return None
    for part in parts:
        cleaned = _normalize_product_name(str(part) if part is not None else "")
        if cleaned and cleaned not in names:
            names.append(cleaned)
        if len(names) >= 16:
            break
    return "; ".join(names) if names else None


def _offer_names(node: Any) -> list[str]:
    names: list[str] = []
    if isinstance(node, dict):
        item = node.get("itemOffered") or node.get("item") or node
        if isinstance(item, dict):
            for key in ("name", "alternateName"):
                cleaned = _normalize_product_name(
                    item.get(key) if isinstance(item.get(key), str) else None
                )
                if cleaned:
                    names.append(cleaned)
        elif isinstance(item, str):
            cleaned = _normalize_product_name(item)
            if cleaned:
                names.append(cleaned)
        elif isinstance(item, list):
            for child in item:
                names.extend(_offer_names(child))
    elif isinstance(node, list):
        for child in node:
            names.extend(_offer_names(child))
    return names


def _products_from_jsonld(node: dict[str, Any]) -> str | None:
    names: list[str] = []
    for key in ("makesOffer", "hasOfferCatalog", "brand"):
        names.extend(_offer_names(node.get(key)))
    catalog = node.get("hasOfferCatalog")
    if isinstance(catalog, dict):
        names.extend(_offer_names(catalog.get("itemListElement")))
    type_ = str(node.get("@type") or "")
    if re.search(r"SoftwareApplication|Product", type_, re.I):
        cleaned = _normalize_product_name(
            node.get("name") if isinstance(node.get("name"), str) else None
        )
        if cleaned:
            names.append(cleaned)
    return normalize_products_value(names)


def _extract_products_from_dom(soup: BeautifulSoup) -> str | None:
    names: list[str] = []
    for heading in soup.find_all(["h1", "h2", "h3", "h4"]):
        heading_text = heading.get_text(" ", strip=True)
        if not _PRODUCT_HEADING_RE.search(heading_text):
            continue
        block = heading.find_next(["ul", "ol", "div"])
        if not block:
            continue
        for item in block.find_all(["li", "h3", "h4", "a"], limit=20):
            cleaned = _normalize_product_name(item.get_text(" ", strip=True))
            if cleaned:
                names.append(cleaned)
        if names:
            break
    return normalize_products_value(names)


def _same_host_paths(
    html: str, page_url: str, path_re: re.Pattern[str]
) -> list[str]:
    soup = BeautifulSoup(html, "lxml")
    try:
        from urllib.parse import urlparse

        base_host = urlparse(page_url).hostname or ""
        base_host = re.sub(r"^www\.", "", base_host.lower())
    except Exception:
        return []
    out: list[str] = []
    for tag in soup.find_all("a", href=True):
        href = str(tag.get("href") or "").strip()
        abs_url = _absolutize(href, page_url)
        if not abs_url or not path_re.search(abs_url):
            continue
        try:
            from urllib.parse import urlparse

            host = re.sub(r"^www\.", "", (urlparse(abs_url).hostname or "").lower())
        except Exception:
            continue
        if host and host == base_host and abs_url not in out:
            out.append(abs_url)
    return out


def _first_same_host_path(
    html: str, page_url: str, path_re: re.Pattern[str]
) -> str | None:
    urls = _same_host_paths(html, page_url, path_re)
    return urls[0] if urls else None


def first_product_page_url(html: str, page_url: str) -> str | None:
    """Same-host /products|/solutions|/platform link, if any."""
    return _first_same_host_path(html, page_url, _PRODUCT_PATH_RE)


def first_about_page_url(html: str, page_url: str) -> str | None:
    """Same-host /about|/company page for what they do."""
    return _first_same_host_path(html, page_url, _ABOUT_PATH_RE)


def first_location_page_url(html: str, page_url: str) -> str | None:
    """Same-host HQ/country location page — not a multi-office index if a better link exists."""
    from urllib.parse import urlparse

    urls = _same_host_paths(html, page_url, _LOCATION_PATH_RE)
    if not urls:
        return None

    def score(u: str) -> int:
        path = (urlparse(u).path or "").lower()
        s = 0
        if re.search(r"hq|headquarter|corporate", path):
            s += 50
        if re.search(r"india|mumbai|navi|head-office", path):
            s += 40
        if path.rstrip("/") in {
            "/location",
            "/locations",
            "/offices",
            "/contact",
            "/contact-us",
        }:
            s -= 20
        s += min(len(path), 40)
        return s

    return max(urls, key=score)


_PIN_CITY_RE = re.compile(
    r"([A-Z][A-Za-z .]{2,40}?)\s+\d{5,6},\s*([A-Z][A-Za-z .]{2,40}),\s*([A-Z][A-Za-z .]{2,40})\b"
)


def _pin_cities(text: str) -> list[str]:
    from app.tools.company_identity import normalize_company_city

    out: list[str] = []
    for m in _PIN_CITY_RE.finditer(text):
        city = normalize_company_city(
            f"{m.group(1).strip()}, {m.group(2).strip()}, {m.group(3).strip()}"
        )
        if city and city not in out:
            out.append(city)
    return out


def city_from_page_text(html: str) -> str | None:
    """HQ city/region/country from official location copy (not 'Headquarters')."""
    text = BeautifulSoup(html, "lxml").get_text(" ", strip=True)
    text = re.sub(r"\s+", " ", text)
    for m in re.finditer(
        r".{0,220}(headquarter|\bHQ\b|corporate office|registered office|head office).{0,220}",
        text,
        re.I,
    ):
        cities = _pin_cities(m.group(0))
        if cities:
            return cities[0]
    cities = _pin_cities(text)
    if len(cities) == 1:
        return cities[0]
    return None


def guess_industry(text: str) -> str | None:
    t = text.lower()
    mapping = [
        (r"software|saas|cloud|devops", "Software"),
        (r"financ|bank|fintech|insur", "Financial Services"),
        (r"health|pharma|biotech|clinic", "Healthcare"),
        (r"retail|e-?commerce|shop", "Retail"),
        (r"manufactur|industrial", "Manufacturing"),
        (r"educat|university|school", "Education"),
        (r"real estate|property", "Real Estate"),
        (r"telecom|network", "Telecommunications"),
        (r"media|publish|news", "Media"),
        (r"consult", "Consulting"),
    ]
    for pattern, label in mapping:
        if re.search(pattern, t):
            return label
    return None
