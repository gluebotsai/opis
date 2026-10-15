"""Collect on-demand audience identity (email / phone / customer id) — stdlib only."""

from __future__ import annotations

import re
from typing import Any

_EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
_PHONE_RE = re.compile(r"\+?\d[\d\s().-]{7,}\d")
_CUSTOMER_ID_LABEL_RE = re.compile(
    r"(?:customer|cdp|contact)\s*(?:id|ids)?\s*(?:is|=|:|-)?\s*([A-Za-z0-9._:-]{8,64})",
    re.I,
)
_LONG_DIGIT_RE = re.compile(r"\b(\d{10,22})\b")
_CDP_OPAQUE_RE = re.compile(r"\b(CDP-[A-Za-z0-9._@+:-]{4,200})\b", re.I)


def extract_emails(text: str) -> list[str]:
    return sorted({m.group(0).lower() for m in _EMAIL_RE.finditer(text or "")})


def extract_phones(text: str) -> list[str]:
    out: list[str] = []
    for m in _PHONE_RE.finditer(text or ""):
        digits = re.sub(r"[^\d+]", "", m.group(0))
        if len(re.sub(r"\D", "", digits)) >= 8:
            out.append(digits)
    return sorted(set(out))


def extract_customer_ids(text: str) -> list[str]:
    out: set[str] = set()
    for m in _CUSTOMER_ID_LABEL_RE.finditer(text or ""):
        val = (m.group(1) or "").strip()
        if val and "@" not in val:
            out.add(val)
    for m in _LONG_DIGIT_RE.finditer(text or ""):
        out.add(m.group(1))
    for m in _CDP_OPAQUE_RE.finditer(text or ""):
        out.add(m.group(1))
    return sorted(out)


def heuristic_identity_from_text(request_text: str) -> dict[str, list[str]]:
    text = (request_text or "").strip()
    return {
        "emails": extract_emails(text),
        "phones": extract_phones(text),
        "customer_ids": extract_customer_ids(text),
    }


def _drop_sku_like_phones(
    phones: list[str], *, emails: list[str], customer_ids: list[str]
) -> list[str]:
    """LLM analyse sometimes puts product SKUs in phones — ignore for lookup."""
    if not phones:
        return phones
    id_set = {str(c).strip() for c in customer_ids if str(c).strip()}
    cleaned: list[str] = []
    for raw in phones:
        p = str(raw or "").strip()
        if not p:
            continue
        digits = re.sub(r"\D", "", p)
        if (
            emails
            and len(digits) >= 10
            and not p.startswith("+")
            and (p in id_set or digits in id_set or p.isdigit())
        ):
            continue
        cleaned.append(p)
    return cleaned


def collect_audience_identity(
    analysis: dict[str, Any] | None,
    payload: dict[str, Any] | None = None,
) -> dict[str, list[str]]:
    """Merge structured payload + analyse output into emails / phones / ids."""
    payload = payload or {}
    analysis = analysis or {}
    args = payload.get("arguments")
    arg_email = args.get("email") if isinstance(args, dict) else None
    arg_emails = args.get("emails") if isinstance(args, dict) else None
    arg_phone = args.get("phone") if isinstance(args, dict) else None
    arg_phones = args.get("phones") if isinstance(args, dict) else None

    def _list(*groups: Any) -> list[str]:
        out: list[str] = []
        seen: set[str] = set()
        for group in groups:
            if not isinstance(group, list):
                if group is None or group is False:
                    continue
                group = [group]
            for item in group:
                val = str(item or "").strip()
                if not val:
                    continue
                key = val.lower()
                if key in seen:
                    continue
                seen.add(key)
                out.append(val)
        return out

    emails = [
        e.lower()
        for e in _list(
            payload.get("emails"),
            payload.get("email"),
            arg_emails,
            arg_email,
            analysis.get("emails"),
        )
    ]
    phones = _list(
        payload.get("phones"),
        payload.get("phone"),
        arg_phones,
        arg_phone,
        analysis.get("phones"),
    )
    customer_ids = _list(
        payload.get("customer_ids"),
        payload.get("contact_ids"),
        args.get("customer_ids") if isinstance(args, dict) else None,
        args.get("contact_ids") if isinstance(args, dict) else None,
        analysis.get("customer_ids"),
        analysis.get("contact_ids"),
    )
    phones = _drop_sku_like_phones(phones, emails=emails, customer_ids=customer_ids)
    return {"emails": emails, "phones": phones, "customer_ids": customer_ids}


def missing_contact_identity_error(identity: dict[str, list[str]]) -> str | None:
    """Hard abort message when Hub/operator gave no reachable contact identity."""
    if (
        identity.get("emails")
        or identity.get("phones")
        or identity.get("customer_ids")
    ):
        return None
    return (
        "No contact email, phone, or customer/contact id in the request. "
        "Dropping the on-demand plan — add a reachable contact and retry."
    )
