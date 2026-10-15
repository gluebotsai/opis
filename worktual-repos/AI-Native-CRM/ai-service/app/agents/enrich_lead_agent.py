from __future__ import annotations

import json
import logging
import re
from typing import Any, Awaitable, Callable, TypedDict, Optional

from app.agents.native_pipeline import run_steps

from app.agents.base import email_domain, is_free_mail
from app.agents.llm_result import extract_json, sectioned_system_prompt
from app.agents.step_trace import emit_step, traced_step
from app.crm_client import CrmClient
from app.llm import LLM_JOB_TIMEOUT_MS, generate_ai_text, is_ai_configured
from app.tools.bs4_extract import (
    extract_firmographics,
    first_about_page_url,
    first_location_page_url,
    first_product_page_url,
    city_from_page_text,
    normalize_products_value,
    _is_plausible_address,
)
from app.tools.company_identity import (
    acronym_matches_entity_text,
    company_identity_allows_domain,
    company_name_matches_domain,
    company_name_matches_linkedin,
    is_short_company_acronym,
    is_trusted_firmographic_source,
    logo_url_belongs_to_company,
    normalize_company_city,
    scrape_host_allowed,
    wiki_firmographics_match_company,
)
from app.tools.ddg_search import hostname_of, rank_domain, search_duckduckgo
from app.tools.page_fetch import safe_fetch_text
from app.tools.wikidata_lookup import (
    extract_linkedin_company_url,
    lookup_wikidata_firmographics,
    resolve_company_via_web_search,
)

logger = logging.getLogger(__name__)

ENRICH_MODULE_PATH = "enrichment"
ENRICH_AGENT = "lead_enrichment"

ENRICH_MAP_SYSTEM = sectioned_system_prompt(
    role="You are a CRM lead enrichment agent for Worktual.",
    goal=(
        "Fill blank company/contact fields from research evidence only. "
        "companyDescription and products are required for the lead summary "
        "About company section — persist them to CRM, do not narrate them here."
    ),
    instructions=(
        "- Only fill keys listed in blanks.\n"
        "- Use evidence values; do not invent industries, headcount, addresses, or URLs.\n"
        "- When companyDescription is blank, always fill it if Wikipedia, Wikidata, "
        "or homepage/about copy describes what they do (1–3 sentences: business, "
        "customers, category).\n"
        "- When products is blank, always fill named products/platforms/offerings "
        "from Wikipedia infobox, JSON-LD, or the /products page "
        "(semicolon-separated). Omit generic words like 'software' or 'solutions'.\n"
        "- Domain and LinkedIn MUST belong to the named company "
        "(Zendesk → zendesk.com, never zoho.com).\n"
        "- logoUrl: only a logo fetched from that company's site, JSON-LD, or Wikidata. "
        "Never Google favicons, Clearbit, or another company's mark.\n"
        "- employeeCount: prefer the company's own site (about / key facts, "
        "including 33K+ Global Employees). Then Wikipedia/Wikidata. "
        "Never invent Google-overview numbers or copy another company's headcount.\n"
        "- city: real HQ geography (city / region / country), e.g. "
        "'San Francisco, California' or 'Navi Mumbai, Maharashtra, India'. "
        "Never 'Headquarters', 'HQ', or other location-type labels.\n"
        "- If evidence is about a different organization, omit those fields.\n"
        "- Omit a field when evidence is weak or conflicting.\n"
        "- confidence is 0–100 based on evidence strength."
    ),
    context="Evidence and blanks are in the user message.",
    output=(
        "Return ONLY JSON: "
        '{"fields":{"industry":{"value":"...","confidence":70,"sourceUrl":"..."},'
        '"companyDescription":{"value":"...","confidence":80,"sourceUrl":"..."},'
        '"logoUrl":{"value":"https://.../logo.svg","confidence":75,"sourceUrl":"..."},'
        '"products":{"value":"Product A; Product B","confidence":70,"sourceUrl":"..."},'
        '"employeeCount":{"value":6970,"confidence":85,"sourceUrl":"..."},'
        '"city":{"value":"San Francisco, California","confidence":80,"sourceUrl":"..."}'
        "}} — include only filled blanks."
    ),
    guardrails=(
        "Never invent domain, LinkedIn, logos, employee counts, addresses, or product names "
        "without evidence. Never attach another company's website, LinkedIn, logo, "
        "description, or products to this company."
    ),
)


class EnrichState(TypedDict, total=False):
    contact_id: str
    organization_id: Optional[str]
    context: dict[str, Any]
    candidates: list[dict[str, str]]
    best_url: Optional[str]
    best_domain: Optional[str]
    extracted: dict[str, Any]
    fields: dict[str, Any]
    status: str
    reason: Optional[str]
    source: str
    persist_result: dict[str, Any]


def _field(value: Any, confidence: float, source_url: str | None = None) -> dict[str, Any]:
    return {
        "value": value,
        "confidence": confidence,
        "sourceUrl": source_url,
    }


NodeFn = Callable[[EnrichState], Awaitable[EnrichState]]
DetailFn = Callable[[EnrichState, EnrichState], "dict[str, Any] | None"]


async def load_context(state: EnrichState) -> EnrichState:
    client = CrmClient(state.get("organization_id"))
    ctx = await client.get_enrichment_context(state["contact_id"])
    return {**state, "context": ctx}


async def normalize(state: EnrichState) -> EnrichState:
    ctx = state.get("context") or {}
    company_name = (ctx.get("companyName") or "").strip()
    if not company_name:
        return {**state, "status": "skipped", "reason": "no_company_name", "fields": {}}
    blanks = ctx.get("blanks") or []
    if not blanks:
        return {**state, "status": "skipped", "reason": "nothing_to_fill", "fields": {}}
    return {**state, "status": "running"}


async def search_ddg(state: EnrichState) -> EnrichState:
    if state.get("status") == "skipped":
        return state
    ctx = state["context"]
    company_name = ctx.get("companyName") or ""
    # Short acronyms (CTS) must not spend the timeout on DDG "official website"
    # — that ranked ctscorp.com. Wikipedia search in rank_candidates is the source.
    if is_short_company_acronym(company_name):
        return {**state, "candidates": []}
    hits = await search_duckduckgo(f"{company_name} official website")
    return {**state, "candidates": hits}


async def rank_candidates(state: EnrichState) -> EnrichState:
    if state.get("status") == "skipped":
        return state
    ctx = state["context"]
    company_name = ctx.get("companyName")
    blanks = set(ctx.get("blanks") or [])
    fields: dict[str, Any] = {}

    mail = email_domain(ctx.get("email"))
    if (
        "domain" in blanks
        and mail
        and not is_free_mail(mail)
        and company_name_matches_domain(company_name, mail)
    ):
        fields["domain"] = _field(mail, 88, f"mailto:{ctx.get('email')}")

    trusted_existing = (
        ctx.get("companyDomain")
        if company_name_matches_domain(company_name, ctx.get("companyDomain"))
        else None
    )

    # Prefer Wikidata/Wikipedia for employees + LinkedIn + what they do + logo.
    if blanks & {
        "employeeCount",
        "linkedinUrl",
        "domain",
        "companyDescription",
        "logoUrl",
        "products",
        "city",
    }:
        wiki = await lookup_wikidata_firmographics(
            company_name or "",
            trusted_existing,
        )
        unsure = (
            is_short_company_acronym(company_name)
            or not wiki
            or not wiki.get("description")
            or not wiki_firmographics_match_company(company_name, wiki)
        )
        if unsure:
            resolved = await resolve_company_via_web_search(
                company_name or "",
                state.get("candidates") or [],
            )
            if resolved:
                wd2 = None
                title = resolved.get("wikiTitle")
                if title:
                    wd2 = await lookup_wikidata_firmographics(
                        str(title),
                        resolved.get("domain") or trusted_existing,
                        wiki_title=str(title),
                    )
                merged: dict[str, Any] = dict(wd2 or {})
                for key in (
                    "description",
                    "products",
                    "domain",
                    "logoUrl",
                    "city",
                    "employeeCount",
                    "linkedinUrl",
                    "wikiTitle",
                    "sourceUrl",
                ):
                    if not resolved.get(key):
                        continue
                    if (
                        key == "description"
                        and merged.get("description")
                        and len(str(merged["description"]))
                        > len(str(resolved[key]))
                    ):
                        continue
                    merged[key] = resolved[key]
                if merged.get("wikiTitle") and not merged.get("sourceUrl"):
                    merged["sourceUrl"] = (
                        "https://en.wikipedia.org/wiki/"
                        + str(merged["wikiTitle"]).replace(" ", "_")
                    )
                if merged.get("description") or merged.get("domain"):
                    wiki = merged
        if wiki and wiki_firmographics_match_company(company_name, wiki):
            src = wiki.get("sourceUrl")
            if "linkedinUrl" in blanks and wiki.get("linkedinUrl"):
                fields["linkedinUrl"] = _field(wiki["linkedinUrl"], 90, src)
            if "employeeCount" in blanks and wiki.get("employeeCount"):
                fields["employeeCount"] = _field(int(wiki["employeeCount"]), 85, src)
            if "domain" in blanks and "domain" not in fields and wiki.get("domain"):
                fields["domain"] = _field(wiki["domain"], 80, src)
            if wiki.get("description"):
                desc = re.sub(r"\s+", " ", str(wiki["description"])).strip()[:800]
                if len(desc) >= 40 and "companyDescription" not in fields:
                    # Keep description even when already persisted — _clean_fields
                    # needs it to prove CTS → cognizant.com.
                    fields["companyDescription"] = _field(desc, 82, src)
            if "logoUrl" in blanks and wiki.get("logoUrl"):
                fields["logoUrl"] = _field(str(wiki["logoUrl"]), 72, src)
            if "products" in blanks and wiki.get("products"):
                products = normalize_products_value(wiki.get("products"))
                if products:
                    fields["products"] = _field(products, 78, src)
            if "city" in blanks and wiki.get("city"):
                city = normalize_company_city(str(wiki["city"]))
                if city:
                    fields["city"] = _field(city, 85, src)

    best_url = None
    best_score = 0
    best_domain = (
        fields.get("domain", {}).get("value")
        if fields.get("domain")
        else trusted_existing
    )

    # When domain already known AND matches the name, skip DDG for the homepage.
    if best_domain and not best_url:
        best_url = f"https://{best_domain}"
        best_score = 90

    for hit in state.get("candidates") or []:
        host = hostname_of(hit.get("url") or "")
        if not host:
            continue
        score = rank_domain(host, company_name)
        if score > best_score and company_name_matches_domain(company_name, host):
            best_score = score
            best_url = hit["url"]
            if "domain" not in fields and score >= 70:
                best_domain = host

    if (
        "domain" not in fields
        and best_domain
        and best_score >= 70
        and company_name_matches_domain(company_name, best_domain)
    ):
        fields["domain"] = _field(best_domain, min(85, best_score), best_url)

    if not fields.get("domain") and not best_url and not fields:
        return {
            **state,
            "status": "skipped",
            "reason": "no_confident_domain",
            "fields": fields,
            "best_url": None,
            "best_domain": None,
        }

    page_url = best_url or (
        f"https://{fields['domain']['value']}"
        if fields.get("domain")
        else f"https://{best_domain}"
        if best_domain
        else None
    )
    return {
        **state,
        "fields": fields,
        "best_url": page_url,
        "best_domain": fields.get("domain", {}).get("value") or best_domain,
    }


async def fetch_pages(state: EnrichState) -> EnrichState:
    if state.get("status") == "skipped":
        return state
    url = state.get("best_url")
    fields = dict(state.get("fields") or {})
    blanks = set((state.get("context") or {}).get("blanks") or [])
    if not url:
        return {**state, "extracted": {}, "fields": fields}
    html = await safe_fetch_text(url)
    if not html:
        return {**state, "extracted": {}, "fields": fields}
    extracted = extract_firmographics(html, url)
    company_name = (state.get("context") or {}).get("companyName")
    trusted_domain = (
        str((fields.get("domain") or {}).get("value") or "")
        or str(state.get("best_domain") or "")
        or None
    )
    evidence = " ".join(
        str(p)
        for p in (
            (fields.get("companyDescription") or {}).get("value"),
            (fields.get("companyDescription") or {}).get("sourceUrl"),
            (fields.get("domain") or {}).get("sourceUrl"),
        )
        if p
    )
    source_url = str(
        (fields.get("domain") or {}).get("sourceUrl")
        or (fields.get("companyDescription") or {}).get("sourceUrl")
        or ""
    ) or None
    host = hostname_of(url)
    if host and not scrape_host_allowed(
        company_name,
        host,
        trusted_domain=trusted_domain,
        evidence_text=evidence,
        source_url=source_url,
    ):
        # Fetched the wrong org — do not scrape firmographics onto this company.
        return {**state, "extracted": {}, "fields": fields}
    if "linkedinUrl" in blanks and "linkedinUrl" not in fields:
        li = extract_linkedin_company_url(html)
        if li and (
            company_name_matches_linkedin(company_name, li)
            or company_identity_allows_domain(
                company_name,
                li,
                evidence_text=evidence,
                source_url=source_url,
            )
        ):
            fields["linkedinUrl"] = _field(li, 80, url)
    if "products" in blanks:
        extra = first_product_page_url(html, url)
        extra_host = hostname_of(extra or "")
        if extra and extra_host and scrape_host_allowed(
            company_name,
            extra_host,
            trusted_domain=trusted_domain,
            evidence_text=evidence,
            source_url=source_url,
        ):
            html2 = await safe_fetch_text(extra)
            if html2:
                extra_ex = extract_firmographics(html2, extra)
                if extra_ex.get("products"):
                    extracted["products"] = normalize_products_value(
                        "; ".join(
                            filter(
                                None,
                                [
                                    extracted.get("products"),
                                    extra_ex.get("products"),
                                ],
                            )
                        )
                    ) or extra_ex.get("products")
                if not extracted.get("description") and extra_ex.get("description"):
                    extracted["description"] = extra_ex["description"]
    need_about = (
        ("companyDescription" in blanks and not extracted.get("description"))
        or ("employeeCount" in blanks and not extracted.get("employeeCount"))
    )
    if need_about:
        about = first_about_page_url(html, url)
        about_host = hostname_of(about or "")
        if about and about_host and scrape_host_allowed(
            company_name,
            about_host,
            trusted_domain=trusted_domain,
            evidence_text=evidence,
            source_url=source_url,
        ):
            html3 = await safe_fetch_text(about)
            if html3:
                about_ex = extract_firmographics(html3, about)
                if not extracted.get("description") and about_ex.get("description"):
                    extracted["description"] = about_ex["description"]
                if not extracted.get("employeeCount") and about_ex.get("employeeCount"):
                    extracted["employeeCount"] = about_ex["employeeCount"]
                    extracted["sourceUrl"] = about
    if ("city" in blanks or "address" in blanks) and (
        not extracted.get("city") or not extracted.get("address")
    ):
        loc = first_location_page_url(html, url)
        loc_host = hostname_of(loc or "")
        if loc and loc_host and scrape_host_allowed(
            company_name,
            loc_host,
            trusted_domain=trusted_domain,
            evidence_text=evidence,
            source_url=source_url,
        ):
            html4 = await safe_fetch_text(loc)
            if html4:
                loc_ex = extract_firmographics(html4, loc)
                if not extracted.get("city") and loc_ex.get("city"):
                    extracted["city"] = loc_ex["city"]
                if not extracted.get("address") and loc_ex.get("address"):
                    extracted["address"] = loc_ex["address"]
                if not extracted.get("city"):
                    city = city_from_page_text(html4)
                    if not city:
                        child = first_location_page_url(html4, loc)
                        child_host = hostname_of(child or "")
                        if (
                            child
                            and child != loc
                            and child_host
                            and scrape_host_allowed(
                                company_name,
                                child_host,
                                trusted_domain=trusted_domain,
                                evidence_text=evidence,
                                source_url=source_url,
                            )
                        ):
                            html5 = await safe_fetch_text(child)
                            if html5:
                                city = city_from_page_text(html5)
                                child_ex = extract_firmographics(html5, child)
                                if not extracted.get("address") and child_ex.get("address"):
                                    extracted["address"] = child_ex["address"]
                    if city:
                        extracted["city"] = city
    return {**state, "extracted": extracted, "fields": fields}


async def extract_bs4(state: EnrichState) -> EnrichState:
    # Extraction already done in fetch_pages; keep node for graph clarity.
    return state


async def validate(state: EnrichState) -> EnrichState:
    """Gather deterministic evidence into candidate fields, then LLM-map blanks."""
    if state.get("status") == "skipped":
        return state
    ctx = state["context"]
    blanks = set(ctx.get("blanks") or [])
    fields = dict(state.get("fields") or {})
    extracted = state.get("extracted") or {}
    source_url = extracted.get("sourceUrl") or state.get("best_url")

    if "industry" in blanks and extracted.get("industry"):
        conf = float(extracted.get("industryConfidence") or 70)
        if conf >= 45:
            fields["industry"] = _field(str(extracted["industry"])[:80], conf, source_url)
    if "employeeCount" in blanks and extracted.get("employeeCount"):
        try:
            n = int(extracted["employeeCount"])
            if n > 0:
                # First-party site outranks Wikipedia/Wikidata for every company.
                fields["employeeCount"] = _field(
                    n,
                    88,
                    extracted.get("sourceUrl") or source_url,
                )
        except Exception:
            pass
    if "city" in blanks and extracted.get("city"):
        city = normalize_company_city(str(extracted["city"]))
        if city:
            fields["city"] = _field(city, 70, source_url)
    if "address" in blanks and extracted.get("address"):
        addr = str(extracted["address"])
        if _is_plausible_address(addr):
            fields["address"] = _field(addr, 65, source_url)
    if "logoUrl" in blanks and extracted.get("logoUrl"):
        fields["logoUrl"] = _field(str(extracted["logoUrl"]), 75, source_url)
    if "companyDescription" in blanks and extracted.get("description"):
        incoming = re.sub(r"\s+", " ", str(extracted["description"])).strip()[:800]
        existing_desc = str((fields.get("companyDescription") or {}).get("value") or "")
        if len(incoming) >= 40 and (not existing_desc or len(incoming) >= len(existing_desc)):
            fields["companyDescription"] = _field(incoming, 75, source_url)
    if "products" in blanks and extracted.get("products"):
        extra = normalize_products_value(extracted.get("products"))
        if extra:
            prev = normalize_products_value(
                (fields.get("products") or {}).get("value")
            )
            merged = normalize_products_value(
                f"{prev}; {extra}" if prev else extra
            )
            if merged:
                fields["products"] = _field(merged, 70, source_url)

    heuristic_fields = _clean_fields(fields, ctx.get("companyName"))
    await emit_step(
        state,
        module_path=ENRICH_MODULE_PATH,
        agent=ENRICH_AGENT,
        step="map_fields_via_llm",
        label="Asking the AI to fill remaining fields",
        status="started",
        detail={"blanksRemaining": sorted(blanks)},
    )
    mapped, llm_reason = await map_fields_via_llm(
        ctx=ctx,
        blanks=sorted(blanks),
        evidence={
            "heuristicFields": heuristic_fields,
            "extracted": extracted,
            "bestUrl": state.get("best_url"),
            "bestDomain": state.get("best_domain"),
            "companyName": ctx.get("companyName"),
            "email": ctx.get("email"),
        },
    )
    await emit_step(
        state,
        module_path=ENRICH_MODULE_PATH,
        agent=ENRICH_AGENT,
        step="map_fields_via_llm",
        label="Asking the AI to fill remaining fields",
        status="ok" if mapped is not None else "skipped",
        detail={"fieldsReturned": sorted((mapped or {}).keys())}
        if mapped is not None
        else None,
        error_reason=llm_reason if mapped is None else None,
    )
    if mapped is not None:
        merged = {
            **heuristic_fields,
            **_clean_fields(mapped, ctx.get("companyName")),
        }
        cleaned = _clean_fields(merged, ctx.get("companyName"))
        source = "ai"
        reason = None
    else:
        logger.warning(
            "enrich-lead LLM map failed; heuristic fallback contact=%s reason=%s",
            state.get("contact_id"),
            llm_reason,
        )
        cleaned = heuristic_fields
        source = "heuristic"
        reason = llm_reason or "llm_failed"

    if not cleaned:
        return {
            **state,
            "fields": {},
            "status": "skipped",
            "reason": "no_confident_fields",
            "source": source,
        }
    return {
        **state,
        "fields": cleaned,
        "status": "enriched",
        "reason": reason,
        "source": source,
    }


def _detail_load_context(
    _before: EnrichState, after: EnrichState
) -> dict[str, Any] | None:
    ctx = after.get("context") or {}
    return {"blanksToFill": len(ctx.get("blanks") or [])}


def _detail_normalize(
    _before: EnrichState, after: EnrichState
) -> dict[str, Any] | None:
    ctx = after.get("context") or {}
    return {"blanks": ctx.get("blanks") or []}


def _detail_search_ddg(
    _before: EnrichState, after: EnrichState
) -> dict[str, Any] | None:
    return {"resultsFound": len(after.get("candidates") or [])}


def _detail_rank_candidates(
    _before: EnrichState, after: EnrichState
) -> dict[str, Any] | None:
    fields = after.get("fields") or {}
    return {
        "domainFound": (fields.get("domain") or {}).get("value"),
        "fieldsFound": sorted(fields.keys()),
    }


def _detail_fetch_pages(
    _before: EnrichState, after: EnrichState
) -> dict[str, Any] | None:
    return {"url": after.get("best_url"), "fetched": bool(after.get("extracted"))}


def _detail_extract_bs4(
    _before: EnrichState, after: EnrichState
) -> dict[str, Any] | None:
    extracted = after.get("extracted") or {}
    return {"fieldsExtracted": sorted(extracted.keys())}


def _detail_validate(
    _before: EnrichState, after: EnrichState
) -> dict[str, Any] | None:
    fields = after.get("fields") or {}
    return {"fieldsKept": sorted(fields.keys()), "source": after.get("source")}


def _detail_persist(
    _before: EnrichState, after: EnrichState
) -> dict[str, Any] | None:
    fields = after.get("fields") or {}
    return {"status": after.get("status"), "fieldsSaved": sorted(fields.keys())}


def _clean_fields(
    fields: dict[str, Any], company_name: str | None = None
) -> dict[str, Any]:
    evidence_parts: list[str] = []
    for item in fields.values():
        if not isinstance(item, dict):
            continue
        evidence_parts.append(str(item.get("value") or ""))
        evidence_parts.append(str(item.get("sourceUrl") or ""))
    evidence = " ".join(evidence_parts)
    cleaned: dict[str, Any] = {}
    for k, v in fields.items():
        if not isinstance(v, dict) or float(v.get("confidence") or 0) < 40:
            continue
        if k == "address" and not _is_plausible_address(str(v.get("value") or "")):
            continue
        val = v.get("value")
        if k == "city":
            city = normalize_company_city(str(val or ""))
            if not city:
                continue
            v = {**v, "value": city}
            val = city
        if k == "employeeCount":
            try:
                n = int(float(str(val).replace(",", "")))
            except (TypeError, ValueError):
                continue
            if n <= 0:
                continue
            v = {**v, "value": n}
            val = n
        src = str(v.get("sourceUrl") or "") or None
        trusted_src = src
        if not is_trusted_firmographic_source(trusted_src):
            for item in fields.values():
                if not isinstance(item, dict):
                    continue
                other = str(item.get("sourceUrl") or "") or None
                if is_trusted_firmographic_source(other):
                    trusted_src = other
                    break
        if k == "domain" and not company_identity_allows_domain(
            company_name,
            str(val or ""),
            evidence_text=evidence,
            source_url=trusted_src or src,
        ):
            continue
        if k == "linkedinUrl" and not (
            company_name_matches_linkedin(company_name, str(val or ""))
            or company_identity_allows_domain(
                company_name,
                str(val or ""),
                evidence_text=evidence,
                source_url=src,
            )
        ):
            continue
        if k == "logoUrl":
            domain_val = str(
                (fields.get("domain") or {}).get("value") or ""
            ) or None
            if not logo_url_belongs_to_company(
                company_name,
                str(val or ""),
                source_url=src,
                company_domain=domain_val,
                evidence_text=evidence,
            ):
                continue
        cleaned[k] = v
    return cleaned


async def map_fields_via_llm(
    *,
    ctx: dict[str, Any],
    blanks: list[str],
    evidence: dict[str, Any],
) -> tuple[dict[str, Any] | None, str | None]:
    if not blanks:
        return {}, None
    if not is_ai_configured():
        return None, "llm_not_configured"
    raw = await generate_ai_text(
        system=ENRICH_MAP_SYSTEM,
        user="\n".join(
            [
                f"blanks: {json.dumps(blanks)}",
                f"company: {ctx.get('companyName') or '—'}",
                "evidence:",
                json.dumps(evidence, default=str)[:7000],
            ]
        ),
        max_tokens=1500,
        timeout_ms=LLM_JOB_TIMEOUT_MS,
    )
    if not raw:
        return None, "llm_empty"
    parsed = extract_json(raw)
    if not parsed:
        return None, "llm_bad_json"
    raw_fields = parsed.get("fields") if isinstance(parsed.get("fields"), dict) else parsed
    if not isinstance(raw_fields, dict):
        return None, "llm_invalid_fields"
    blank_set = set(blanks)
    out: dict[str, Any] = {}
    for k, v in raw_fields.items():
        if k not in blank_set:
            continue
        if not isinstance(v, dict) or v.get("value") in (None, ""):
            continue
        try:
            conf = float(v.get("confidence") or 60)
        except (TypeError, ValueError):
            conf = 60.0
        val = v.get("value")
        if k == "products":
            val = normalize_products_value(val)
            if not val:
                continue
        if k == "companyDescription" and isinstance(val, str):
            val = re.sub(r"\s+", " ", val).strip()[:800]
            if len(val) < 40:
                continue
        if k == "city":
            val = normalize_company_city(str(val or ""))
            if not val:
                continue
        if k == "employeeCount":
            try:
                val = int(float(str(val).replace(",", "")))
            except (TypeError, ValueError):
                continue
            if val <= 0:
                continue
        out[k] = _field(val, conf, v.get("sourceUrl"))
    return out, None


async def persist(state: EnrichState) -> EnrichState:
    if state.get("status") not in {"enriched", "skipped"}:
        return state
    if state.get("status") == "skipped" and not state.get("fields"):
        return state
    client = CrmClient(state.get("organization_id"))
    payload = {
        "contactId": state["contact_id"],
        "fields": state.get("fields") or {},
        "status": state.get("status"),
        "reason": state.get("reason"),
    }
    result = await client.persist_enrichment(state["contact_id"], payload)
    return {**state, "persist_result": result}


def _route_after_normalize(state: EnrichState) -> str:
    if state.get("status") == "skipped":
        return "persist"
    return "search_ddg"


def _route_after_rank(state: EnrichState) -> str:
    if state.get("status") == "skipped":
        return "persist"
    return "fetch_pages"


_STEP_LOAD_CONTEXT = traced_step(
            ENRICH_MODULE_PATH,
            ENRICH_AGENT,
            "load_context",
            "Loading contact & company context",
            _detail_load_context,
        )(load_context)
_STEP_NORMALIZE = traced_step(
            ENRICH_MODULE_PATH,
            ENRICH_AGENT,
            "normalize",
            "Checking what needs to be filled",
            _detail_normalize,
        )(normalize)
_STEP_SEARCH_DDG = traced_step(
            ENRICH_MODULE_PATH,
            ENRICH_AGENT,
            "search_ddg",
            "Searching the web for the official site",
            _detail_search_ddg,
        )(search_ddg)
_STEP_RANK_CANDIDATES = traced_step(
            ENRICH_MODULE_PATH,
            ENRICH_AGENT,
            "rank_candidates",
            "Identifying the company (Wikidata / web ranking)",
            _detail_rank_candidates,
        )(rank_candidates)
_STEP_FETCH_PAGES = traced_step(
            ENRICH_MODULE_PATH,
            ENRICH_AGENT,
            "fetch_pages",
            "Reading the company website",
            _detail_fetch_pages,
        )(fetch_pages)
_STEP_EXTRACT_BS4 = traced_step(
            ENRICH_MODULE_PATH,
            ENRICH_AGENT,
            "extract_bs4",
            "Extracting firmographic details from the page",
            _detail_extract_bs4,
        )(extract_bs4)
_STEP_VALIDATE = traced_step(
            ENRICH_MODULE_PATH,
            ENRICH_AGENT,
            "validate",
            "Validating extracted fields against company identity",
            _detail_validate,
        )(validate)
_STEP_PERSIST = traced_step(
            ENRICH_MODULE_PATH,
            ENRICH_AGENT,
            "persist",
            "Saving enrichment results",
            _detail_persist,
        )(persist)


async def _run_pipeline(state: EnrichState) -> EnrichState:
    state = await run_steps(state, (_STEP_LOAD_CONTEXT, _STEP_NORMALIZE))
    if _route_after_normalize(state) != "persist":
        state = await run_steps(state, (_STEP_SEARCH_DDG, _STEP_RANK_CANDIDATES))
        if _route_after_rank(state) != "persist":
            state = await run_steps(
                state, (_STEP_FETCH_PAGES, _STEP_EXTRACT_BS4, _STEP_VALIDATE)
            )
    return await run_steps(state, (_STEP_PERSIST,))


async def run(contact_id: str, organization_id: str | None = None) -> dict[str, Any]:
    result = await _run_pipeline(
        {
            "contact_id": contact_id,
            "organization_id": organization_id,
            "fields": {},
            "status": "running",
            "reason": None,
        }
    )
    return {
        "contactId": contact_id,
        "status": result.get("status") or "failed",
        "source": result.get("source") or "heuristic",
        "reason": result.get("reason"),
        "fields": result.get("fields") or {},
        "persistResult": result.get("persist_result"),
    }
