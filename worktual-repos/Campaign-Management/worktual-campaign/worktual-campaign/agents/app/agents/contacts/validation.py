"""Email + phone validation for contacts agent (mirrors backend rules)."""

from __future__ import annotations

import re
from typing import Any

# Keep in sync with backend/src/helpers/contact-validation.ts
EMAIL_RE = re.compile(
    r"^[a-zA-Z0-9](?:[a-zA-Z0-9._%+-]{0,62}[a-zA-Z0-9])?@"
    r"[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?"
    r"(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*"
    r"\.[a-zA-Z]{2,24}$"
)

NATIONAL_LENGTH: dict[str, int | tuple[int, int]] = {
    "1": 10,
    "7": 10,
    "20": 10,
    "27": 9,
    "30": 10,
    "31": 9,
    "32": 9,
    "33": 9,
    "34": 9,
    "36": 9,
    "39": (9, 10),
    "41": 9,
    "43": (10, 11),
    "44": 10,
    "45": 8,
    "46": (9, 10),
    "47": 8,
    "48": 9,
    "49": (10, 11),
    "52": 10,
    "55": (10, 11),
    "60": (9, 10),
    "61": 9,
    "62": (9, 12),
    "63": 10,
    "64": (8, 10),
    "65": 8,
    "66": 9,
    "81": (10, 11),
    "82": (9, 10),
    "84": (9, 10),
    "86": 11,
    "90": 10,
    "91": 10,
    "92": 10,
    "93": 9,
    "94": 9,
    "95": (8, 10),
    "98": 10,
    "212": 9,
    "213": 9,
    "216": 8,
    "234": (10, 11),
    "254": 9,
    "255": 9,
    "256": 9,
    "351": 9,
    "352": 9,
    "353": 9,
    "358": (9, 10),
    "370": 8,
    "371": 8,
    "372": 7,
    "380": 9,
    "385": 9,
    "420": 9,
    "421": 9,
    "852": 8,
    "853": 8,
    "880": 10,
    "886": 9,
    "960": 7,
    "965": 8,
    "966": 9,
    "968": 8,
    "971": 9,
    "973": 8,
    "974": 8,
    "975": 8,
    "977": 10,
}

CALLING_CODES = sorted(NATIONAL_LENGTH.keys(), key=len, reverse=True)


def digits_only(value: str) -> str:
    return re.sub(r"\D", "", value or "")


def _match_calling_code(digits: str) -> tuple[str, str] | None:
    for code in CALLING_CODES:
        if not digits.startswith(code) or len(digits) <= len(code):
            continue
        rest = digits[len(code) :]
        expected = NATIONAL_LENGTH[code]
        if isinstance(expected, tuple):
            len_ok = expected[0] <= len(rest) <= expected[1]
        else:
            len_ok = len(rest) == expected
        if not len_ok:
            continue
        return code, rest
    return None


def _try_india_mobile_fallback(digits: str) -> tuple[str, str] | None:
    """Common India mobiles: 10 digits, 91+10, or 11 digits with one extra trailing digit."""
    d = digits_only(digits)
    if not d:
        return None
    if len(d) == 12 and d.startswith("91"):
        national = d[2:]
        if len(national) == 10 and national[0] in "6789":
            return "91", national
    if len(d) == 10 and d[0] in "6789":
        return "91", d
    if len(d) == 11 and d[0] in "6789":
        national = d[:10]
        if national[0] in "6789":
            return "91", national
    return None


def _prefer_india_over_short_code_match(digits: str, matched: tuple[str, str]) -> bool:
    """Avoid mis-parsing 93930459103 as +93 when user meant a 91 mobile."""
    if matched[0] == "91":
        return False
    india = _try_india_mobile_fallback(digits)
    if not india:
        return False
    return digits[0] in "6789" and len(digits) in (10, 11, 12)


def collapse_doubled_calling_code(raw_digits: str) -> str:
    """Collapse 91+91… (and similar) into a single country code + national."""
    digits = digits_only(raw_digits)
    if digits.startswith("00"):
        digits = digits[2:]

    for _ in range(4):
        stripped = False
        for code in CALLING_CODES:
            doubled = code + code
            if not digits.startswith(doubled):
                continue
            candidate = digits[len(code) :]
            if _match_calling_code(candidate):
                digits = candidate
                stripped = True
                break
            national = candidate[len(code) :]
            expected = NATIONAL_LENGTH[code]
            if isinstance(expected, tuple):
                len_ok = expected[0] <= len(national) <= expected[1]
            else:
                len_ok = len(national) == expected
            if candidate.startswith(code) and len_ok:
                digits = candidate
                stripped = True
                break
        if not stripped:
            break
    return digits


def is_valid_email(email: str) -> bool:
    v = (email or "").strip()
    if not v or len(v) > 254 or ".." in v:
        return False
    return bool(EMAIL_RE.match(v))


# Common mailbox-domain typos → suggested correction (format-only; not chat intent).
_EMAIL_DOMAIN_TYPOS: dict[str, str] = {
    "gmai.com": "gmail.com",
    "gmial.com": "gmail.com",
    "gmal.com": "gmail.com",
    "gmil.com": "gmail.com",
    "gmail.co": "gmail.com",
    "gmail.con": "gmail.com",
    "gmail.cm": "gmail.com",
    "gamil.com": "gmail.com",
    "gnail.com": "gmail.com",
    "hotmial.com": "hotmail.com",
    "hotmal.com": "hotmail.com",
    "hotmail.co": "hotmail.com",
    "outlok.com": "outlook.com",
    "outllok.com": "outlook.com",
    "outlook.co": "outlook.com",
    "yaho.com": "yahoo.com",
    "yahooo.com": "yahoo.com",
    "yahoo.co": "yahoo.com",
}


def suggest_email_domain_fix(email: str) -> str | None:
    """If local@typo-domain, return corrected address; else None."""
    raw = (email or "").strip().lower()
    if not raw or "@" not in raw:
        return None
    local, _, domain = raw.partition("@")
    if not local or not domain:
        return None
    fixed = _EMAIL_DOMAIN_TYPOS.get(domain)
    if not fixed:
        return None
    suggested = f"{local}@{fixed}"
    return suggested if suggested != raw else None


def review_email_address(email: str) -> dict[str, Any]:
    """Validate format + common domain typos for agent tools."""
    raw = (email or "").strip()
    if not raw:
        return {"ok": False, "email": None, "error": "empty", "message": "Email is empty."}
    lowered = raw.lower()
    if not is_valid_email(lowered):
        hint = ""
        if "@" not in raw:
            hint = " A valid address needs @ (e.g. name@company.com)."
        elif raw.count("@") != 1:
            hint = " Use exactly one @ between the name and domain."
        else:
            hint = " Use a full address like name@company.com."
        return {
            "ok": False,
            "email": lowered,
            "error": "invalid_format",
            "message": f"Invalid email format: {raw}.{hint}",
        }
    suggested = suggest_email_domain_fix(lowered)
    if suggested:
        return {
            "ok": False,
            "email": lowered,
            "error": "likely_typo",
            "suggested_email": suggested,
            "message": (
                f"Email looks mistyped: {lowered}. Did you mean {suggested}? "
                "Confirm with the user, then retry with the corrected address."
            ),
        }
    return {"ok": True, "email": lowered, "message": None}


def looks_like_email_attempt(text: str) -> bool:
    """True when the utterance is mainly an email (valid or malformed) — format gate only."""
    raw = (text or "").strip()
    if not raw or len(raw) > 120:
        return False
    words = raw.split()
    if len(words) > 4:
        return False
    if "@" in raw:
        return True
    # Missing @: namegmail.com / namegmail.co
    compact = re.sub(r"\s+", "", raw)
    if re.search(
        r"(?i)(?:gmail|yahoo|outlook|hotmail|icloud)\.(?:com|co|in|org)\s*$",
        compact,
    ):
        return True
    if re.search(r"(?i)^[a-z0-9._%+-]+@[a-z0-9.-]*$", compact):
        return True
    return False


def parse_and_validate_phone(raw: str | None) -> dict:
    trimmed = (raw or "").strip()
    if not trimmed:
        return {
            "ok": False,
            "message": (
                "No phone provided. Use email instead, or enter a phone with "
                "country code (e.g. +91 9876543210)."
            ),
        }
    digits = digits_only(trimmed)
    if not digits:
        return {
            "ok": False,
            "message": "Enter a phone number with country code (e.g. +91 9876543210).",
        }

    has_plus = trimmed.startswith("+")
    has_00 = digits.startswith("00") if not has_plus else False
    if has_00:
        digits = digits[2:]
    digits = collapse_doubled_calling_code(digits)

    matched = _match_calling_code(digits)
    # Do not invent a country code for bare local numbers (e.g. 10-digit India mobiles).
    # Accept only explicit + / 00, or digits that already include a known calling code
    # (e.g. 919876543210). User must supply the country code.
    if not matched:
        return {
            "ok": False,
            "message": (
                "Include a valid country code and the correct number of digits "
                "for that country (e.g. +91 9876543210)."
                if has_plus or has_00
                else "Include a country code with the number (e.g. +91 9876543210 or 919876543210)."
            ),
        }

    # Digits like 93930459103 match +93 (AF) but also look like a mangled India mobile.
    # Without explicit + / 00, do not guess — ask for country code instead of inventing +91.
    if (
        not has_plus
        and not has_00
        and _prefer_india_over_short_code_match(digits, matched)
    ):
        return {
            "ok": False,
            "message": (
                "Include a country code with the number "
                "(e.g. +91 9876543210 or 919876543210)."
            ),
        }

    country_code, national = matched
    return {
        "ok": True,
        "e164": f"+{country_code}{national}",
        "country_code": country_code,
        "national_number": national,
    }


def validate_email_phone(
    email: str | None,
    phone: str | None,
    *,
    require_phone: bool = False,
    require_channel: bool = True,
) -> dict:
    """Validate email/phone. Create needs at least one channel (email OR phone)."""
    em_raw = (email or "").strip().lower()
    ph_raw = (phone or "").strip()

    em: str | None = None
    if em_raw:
        reviewed = review_email_address(em_raw)
        if not reviewed.get("ok"):
            out: dict[str, Any] = {
                "ok": False,
                "message": reviewed.get("message") or "Enter a valid email address.",
                "error": reviewed.get("error"),
                "email": reviewed.get("email"),
            }
            if reviewed.get("suggested_email"):
                out["suggested_email"] = reviewed["suggested_email"]
            return out
        em = str(reviewed.get("email") or em_raw)

    ph_e164: str | None = None
    if ph_raw:
        ph = parse_and_validate_phone(ph_raw)
        if not ph.get("ok"):
            return {"ok": False, "message": ph.get("message") or "Invalid phone."}
        ph_e164 = ph["e164"]
    elif require_phone:
        return {
            "ok": False,
            "message": "Phone number with country code is required (e.g. +91 9876543210).",
        }

    if require_channel and not em and not ph_e164:
        return {
            "ok": False,
            "message": "Provide an email address or a phone number with country code.",
        }

    return {"ok": True, "email": em, "phone": ph_e164}


def emails_match(a: str | None, b: str | None) -> bool:
    return (a or "").strip().lower() == (b or "").strip().lower()


def phones_match(a: str | None, b: str | None) -> bool:
    pa = parse_and_validate_phone(a)
    pb = parse_and_validate_phone(b)
    if pa.get("ok") and pb.get("ok"):
        return pa["e164"] == pb["e164"]
    da, db = digits_only(a or ""), digits_only(b or "")
    return bool(da) and da == db


def identity_snapshot(draft: dict[str, Any] | None) -> dict[str, str]:
    """Baseline email/phone for update immutability checks."""
    d = draft or {}
    phone_raw = str(d.get("phone") or "").strip()
    ph = parse_and_validate_phone(phone_raw)
    phone = str(ph.get("e164") or phone_raw) if ph.get("ok") else phone_raw
    em = str(d.get("email") or "").strip().lower()
    return {"email": em, "phone": phone}


def validate_update_identity_change(
    baseline: dict[str, Any] | None,
    *,
    email: str | None = None,
    phone: str | None = None,
) -> dict[str, Any]:
    """
    Update rules: existing email/phone cannot change; missing identity may be filled.
    Returns {ok, field?, identity_locked?, message?}.
    """
    base = identity_snapshot(baseline if isinstance(baseline, dict) else {})
    if email is not None:
        raw = str(email or "").strip()
        if raw:
            reviewed = review_email_address(raw)
            if not reviewed.get("ok"):
                return {
                    "ok": False,
                    "field": "email",
                    "message": str(reviewed.get("message") or "Enter a valid email address."),
                }
            new_em = str(reviewed.get("email") or raw).strip().lower()
            if base.get("email") and not emails_match(base["email"], new_em):
                return {
                    "ok": False,
                    "field": "email",
                    "identity_locked": True,
                    "message": (
                        "This contact's email is already set and cannot be changed. "
                        "You can update other fields, or add a missing phone if needed."
                    ),
                }
    if phone is not None:
        raw = str(phone or "").strip()
        if raw:
            ph = parse_and_validate_phone(raw)
            if not ph.get("ok"):
                return {
                    "ok": False,
                    "field": "phone",
                    "message": str(ph.get("message") or "Enter a phone with country code."),
                }
            new_ph = str(ph.get("e164") or raw)
            if base.get("phone") and not phones_match(base["phone"], new_ph):
                return {
                    "ok": False,
                    "field": "phone",
                    "identity_locked": True,
                    "message": (
                        "This contact's phone is already set and cannot be changed. "
                        "You can update other fields, or add a missing email if needed."
                    ),
                }
    return {"ok": True}


_PERSON_NAME_TOKEN_RE = re.compile(r"^[A-Za-z][A-Za-z'.-]{0,39}$")
_SINGLE_LETTER_NAME_RE = re.compile(r"^[A-Za-z]$")


def normalize_name_answer(raw: str | None) -> str:
    """Trim trailing typo punctuation (what' → what); keep internal O'Brien apostrophes."""
    t = str(raw or "").strip()
    while len(t) > 1 and t[-1] in "'\"?!.":
        t = t[:-1].strip()
    return t


def is_valid_person_name_token(raw: str | None, *, field: str = "") -> bool:
    """
    Accept given/family names including single-letter surnames (e.g. P).
    Reject digits, placeholders, and long consonant-only gibberish.
    """
    from app.agents.contacts.draft_ingest import is_garbage_person_name

    t = normalize_name_answer(raw)
    if not t:
        return False
    if is_garbage_person_name(t):
        return False
    if re.search(r"\d", t):
        return False
    if _SINGLE_LETTER_NAME_RE.match(t):
        return True
    if not _PERSON_NAME_TOKEN_RE.match(t):
        return False
    if len(t) >= 4 and not re.search(r"[aeiouAEIOUy]", t):
        return False
    if len(t) >= 8 and len(re.findall(r"[aeiouAEIOUy]", t)) < 2:
        return False
    _ = field
    return True


def title_case_person_name(raw: str | None) -> str:
    """Title-case a person name. aravindh → Aravindh. Keep in sync with backend helper."""
    t = (raw or "").strip()
    if not t:
        return ""
    parts = re.split(r"([\s-]+)", t)
    out: list[str] = []
    for part in parts:
        if not part or re.fullmatch(r"[\s-]+", part):
            out.append(part)
            continue
        segs = re.split(r"(')", part)
        built: list[str] = []
        for seg in segs:
            if not seg or seg == "'":
                built.append(seg)
                continue
            built.append(seg[:1].upper() + seg[1:].lower())
        out.append("".join(built))
    return "".join(out)
