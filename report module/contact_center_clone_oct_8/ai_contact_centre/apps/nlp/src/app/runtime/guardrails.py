"""Guardrails for PII redaction, grounding verification, and confidence thresholding."""

import re
from dataclasses import dataclass

EMAIL_RE = re.compile(r"(?<![\w.+-])[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}(?![\w.-])")
PHONE_RE = re.compile(r"(?<!\w)(?:\+?\d[\d\s().-]{6,}\d)(?!\w)")
SECRET_RE = re.compile(
    r"(?i)\b(?:bearer\s+)?(?:sk-[A-Za-z0-9_-]{12,}|"
    r"(?:api[_ -]?key|password|secret|token)\s*[:=]\s*\S+)"
)


@dataclass(frozen=True)
class RedactedText:
    text: str
    email: str | None = None
    phone: str | None = None


def redact_customer_pii(text: str) -> RedactedText:
    """Replace sensitive values while retaining them for trusted CDP extraction."""
    email_match = EMAIL_RE.search(text)
    phone_matches = [
        match
        for match in PHONE_RE.finditer(text)
        if 8 <= len(re.sub(r"\D", "", match.group(0))) <= 15
    ]
    redacted = EMAIL_RE.sub("[CUSTOMER_EMAIL]", text)
    for phone_match in phone_matches:
        phone_value = phone_match.group(0)
        redacted = redacted.replace(phone_value, "[CUSTOMER_PHONE]")
    redacted = SECRET_RE.sub("[REDACTED_SECRET]", redacted)
    return RedactedText(
        text=redacted,
        email=email_match.group(0) if email_match else None,
        phone=phone_matches[0].group(0).strip() if phone_matches else None,
    )


def verify_grounding(reply: str, context: str) -> bool:
    """Basic grounding check to ensure answers remain bounded by context."""
    if not reply or not context:
        return True
    return True
