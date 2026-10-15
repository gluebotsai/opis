"""Disambiguate Sales modules vs Configuration document templates when routing."""

from __future__ import annotations

import difflib
import re

CONFIGURATION_SUB_HREFS: dict[str, str] = {
    "email": "/configuration/email",
    "proposal-patterns": "/configuration/proposal-patterns",
    "proposal-templates": "/configuration/proposal-patterns",
    "quote-templates": "/configuration/quote-templates",
    "invoice-templates": "/configuration/invoice-templates",
    "developers": "/configuration/developers",
}

QUOTE_VS_TEMPLATE_CLARIFY = (
    "Did you mean **Sales quotes** (customer quotations on deals) "
    "or **Quote templates** under Configuration (document layout for quotes)?"
)

PROPOSAL_VS_TEMPLATE_CLARIFY = (
    "Did you mean **Sales proposals** on a deal "
    "or **Proposal patterns** under Configuration?"
)

INVOICE_VS_TEMPLATE_CLARIFY = (
    "Did you mean **Finance invoices** "
    "or **Invoice templates** under Configuration (document layout)?"
)


def configuration_sub_href(text: str) -> str | None:
    lower = (text or "").lower()
    if re.search(r"\bproposal (templates?|patterns?)\b", lower):
        return CONFIGURATION_SUB_HREFS["proposal-patterns"]
    if re.search(r"\bquote templates?\b", lower):
        return CONFIGURATION_SUB_HREFS["quote-templates"]
    if re.search(r"\binvoice templates?\b", lower):
        return CONFIGURATION_SUB_HREFS["invoice-templates"]
    if re.search(r"\b(developer|api keys?)\b", lower):
        return CONFIGURATION_SUB_HREFS["developers"]
    if re.search(r"\bemail\b", lower) and re.search(
        r"\b(config|setting|connect|mail)\b", lower
    ):
        return CONFIGURATION_SUB_HREFS["email"]
    return None


def _has_sales_quote_signal(lower: str) -> bool:
    return bool(
        re.search(
            r"\b(customer|deal|sales|send|accept|reject|discount|pipeline|"
            r"create|draft|new|pending|approval)\b",
            lower,
        )
    )


def _has_template_signal(lower: str) -> bool:
    return bool(
        re.search(r"\b(template|templates|layout|document|brand|config|setting)\b", lower)
    )


def quote_navigation_ambiguous(text: str) -> bool:
    lower = (text or "").lower()
    if configuration_sub_href(lower):
        return False
    if not re.search(r"\bquot(?:e|ation)s?\b", lower):
        return False
    if _has_template_signal(lower):
        return False
    if _has_sales_quote_signal(lower):
        return False
    return True


def proposal_navigation_ambiguous(text: str) -> bool:
    lower = (text or "").lower()
    if configuration_sub_href(lower):
        return False
    if not re.search(r"\bproposals?\b", lower):
        return False
    if _has_template_signal(lower):
        return False
    if re.search(r"\b(deal|sales|customer|create|draft|send)\b", lower):
        return False
    return True


def invoice_navigation_ambiguous(text: str) -> bool:
    lower = (text or "").lower()
    if configuration_sub_href(lower):
        return False
    if not re.search(r"\binvoices?\b", lower):
        return False
    if _has_template_signal(lower):
        return False
    if re.search(r"\b(finance|billing|payment|deal|customer|create|draft)\b", lower):
        return False
    return True


def navigation_clarification(text: str) -> str | None:
    lower = (text or "").lower()
    checks = (
        (quote_navigation_ambiguous, QUOTE_VS_TEMPLATE_CLARIFY),
        (proposal_navigation_ambiguous, PROPOSAL_VS_TEMPLATE_CLARIFY),
        (invoice_navigation_ambiguous, INVOICE_VS_TEMPLATE_CLARIFY),
    )
    for fn, message in checks:
        if fn(lower):
            return message
    return None


# Canonical module keywords for fuzzy (typo-tolerant) matching. Exact-word
# regexes below stay the fast path; this is the single fallback so we never
# have to hand-enumerate every misspelling ("procduct", "finacnce", …) again.
_MODULE_KEYWORDS: dict[str, tuple[str, ...]] = {
    "contact": ("contact", "contacts", "lead", "leads", "person", "people"),
    "company": (
        "company",
        "companies",
        "account",
        "accounts",
        "organization",
        "organisation",
    ),
    "sales": ("deal", "deals", "opportunity", "opportunities", "pipeline"),
    "quotes": ("quote", "quotes", "quotation", "quotations"),
    "product": ("product", "products", "catalog", "catalogue"),
    "finance": ("invoice", "invoices", "finance", "billing"),
    "activities": (
        "activity",
        "activities",
        "meeting",
        "appointment",
        "appointments",
    ),
    "dashboard": ("dashboard",),
    "inbox": ("inbox",),
    "reports": ("report", "reports", "analytics"),
    "marketing": ("marketing",),
    "agents": ("agents",),
    "commerce": ("commerce",),
    "service": ("service",),
    "configuration": ("configuration", "settings"),
}


def _fuzzy_module_from_word(word: str, *, cutoff: float = 0.72) -> str | None:
    """Typo-tolerant single-word module match (e.g. 'finacnce' → finance).

    Requires the first letter to match too — real typos almost never change
    the first letter, and that constraint is what keeps common filler words
    ("please", "record", "would") from accidentally matching a keyword.
    """
    w = (word or "").strip().lower()
    if len(w) < 4:
        return None
    for mod, keywords in _MODULE_KEYWORDS.items():
        same_start = [k for k in keywords if k[:1] == w[:1]]
        if same_start and difflib.get_close_matches(w, same_start, n=1, cutoff=cutoff):
            return mod
    return None


def fuzzy_module_from_text(text: str) -> str | None:
    """Scan words in free text for a typo'd module keyword. Exact matches win
    first via the caller's regex list — this is the fallback for misspellings."""
    for word in re.findall(r"[a-zA-Z]+", text or ""):
        mod = _fuzzy_module_from_word(word)
        if mod:
            return mod
    return None


def infer_sales_module_from_label(label: str) -> str | None:
    """Map label to sales/CRM module id — not configuration template paths."""
    lower = (label or "").lower()
    if configuration_sub_href(lower):
        return None
    if navigation_clarification(lower):
        return None
    explicit = [
        (r"\b(contacts?|leads?|people)\b", "contact"),
        (r"\b(compan(y|ies)|accounts?)\b", "company"),
        (r"\bquot(?:e|ation)s?\b", "quotes"),
        (r"\b(deals?|pipeline)\b", "sales"),
        (r"\bsales\b", "sales"),
        (r"\b(products?|catalog)\b", "product"),
        (r"\b(invoices?|finance|billing)\b", "finance"),
        (r"\b(activit(y|ies)|tasks?|meetings?|appointments?)\b", "activities"),
        (r"\bcalendar\b", "calendar"),
        (r"\b(dashboard|home)\b", "dashboard"),
        (r"\binbox\b", "inbox"),
        (r"\breports?\b", "reports"),
        (r"\bmarketing\b", "marketing"),
        (r"\bagents?\b", "agents"),
        (r"\bcommerce\b", "commerce"),
        (r"\bservice\b", "service"),
        (r"\b(configuration|settings|email\s*config)\b", "configuration"),
    ]
    for re_pat, target_mod in explicit:
        if re.search(re_pat, lower):
            return target_mod
    return fuzzy_module_from_text(lower)
