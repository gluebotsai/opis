"""Contact MCP server backed by tenant-scoped cc-core adapters."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Literal

import phonenumbers
import pycountry
from mcp.server.fastmcp import FastMCP
from phonenumbers import NumberParseException

from app.logging import get_logger
from app.mcp.context import (
    CcCoreError,
    CcCoreHTTPAdapter,
    execute_once,
    get_tool_context,
)

logger = get_logger("nlp.mcp.contact")

_PHONE_KEYS = {"primaryPhone", "secondaryPhone"}
_INACTIVE_VALUES = {"false", "inactive", "0", "no", "off"}
_ACTIVE_VALUES = {"true", "active", "1", "yes", "on"}


def coerce_is_active(value: Any) -> bool | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return bool(value)
    normalized = str(value).strip().lower()
    if normalized in _INACTIVE_VALUES:
        return False
    if normalized in _ACTIVE_VALUES:
        return True
    return None


def phone_digits(value: Any) -> str:
    digits = "".join(character for character in str(value or "") if character.isdigit())
    if digits.startswith("00"):
        return digits[2:]
    return digits


class PhoneCountryRequired(Exception):
    """A national number cannot be validated until a country name or calling code is known."""


def _hint_is_calling_code(hint: str) -> bool:
    token = hint.strip()
    if token.startswith("+"):
        token = token[1:]
    elif token.startswith("00"):
        token = token[2:]
    return token.isdigit()


def region_from_phone_hint(hint: str | None) -> str | None:
    text = str(hint or "").strip()
    if not text:
        return None
    if _hint_is_calling_code(text):
        digits = text[1:] if text.startswith("+") else text[2:] if text.startswith("00") else text
        regions = phonenumbers.COUNTRY_CODE_TO_REGION_CODE.get(int(digits))
        return regions[0] if regions else None
    try:
        return pycountry.countries.lookup(text).alpha_2
    except LookupError:
        return None


def _split_phone_answer(value: str) -> tuple[str, str | None]:
    text = " ".join(str(value).split())
    if text.startswith("+") or text.startswith("00"):
        return text, None
    parts = text.split()
    if len(parts) < 2:
        return text, None
    if parts[-1].isdigit() and region_from_phone_hint(" ".join(parts[:-1])):
        return parts[-1], " ".join(parts[:-1])
    if parts[0].isdigit() and region_from_phone_hint(" ".join(parts[1:])):
        return parts[0], " ".join(parts[1:])
    return text, None


def canonicalize_contact_phone(value: str, region_hint: str | None = None) -> str:
    """Return E.164, or ask for a country when the number is only national."""
    number_text, embedded_hint = _split_phone_answer(value)
    hint = region_hint or embedded_hint
    region = region_from_phone_hint(hint)
    if number_text.startswith("00"):
        number_text = f"+{number_text[2:]}"
    international = number_text.startswith("+")
    if region and not international:
        calling_code = str(phonenumbers.country_code_for_region(region))
        digits = phone_digits(number_text)
        if calling_code and digits.startswith(calling_code) and len(digits) - len(calling_code) >= 4:
            number_text = digits[len(calling_code) :]
    try:
        parsed = phonenumbers.parse(number_text, None if international else region)
    except NumberParseException:
        parsed = None
    if parsed is not None and phonenumbers.is_valid_number(parsed):
        return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
    if not international and region is None:
        raise PhoneCountryRequired
    raise CcCoreError(
        "That phone number is not valid for the country given. Ask for the number again."
    )


def normalize_phone_fields(fields: dict[str, Any]) -> dict[str, Any]:
    """Validate primary and secondary phones. A calling-code hint is not a location country."""
    normalized = dict(fields)
    hint = str(normalized.get("country") or "").strip() or None
    used_calling_code_hint = False
    for key in ("primaryPhone", "secondaryPhone"):
        raw = normalized.get(key)
        if raw is None or not str(raw).strip():
            continue
        try:
            normalized[key] = canonicalize_contact_phone(str(raw))
        except PhoneCountryRequired:
            if hint is None:
                raise CcCoreError(
                    f"{key} needs a country. Ask which country this number is for. "
                    "A country name or calling code is fine, such as India or +91. "
                    "Then stage the number again together with that country."
                ) from None
            try:
                normalized[key] = canonicalize_contact_phone(str(raw), hint)
            except PhoneCountryRequired:
                raise CcCoreError(
                    f"{key} needs a country. Ask which country this number is for. "
                    "A country name or calling code is fine, such as India or +91."
                ) from None
            if _hint_is_calling_code(hint):
                used_calling_code_hint = True
    if used_calling_code_hint:
        normalized.pop("country", None)
    return normalized


def phones_equivalent(left: Any, right: Any) -> bool:
    first = phone_digits(left)
    second = phone_digits(right)
    if not first and not second:
        return True
    if not first or not second:
        return False
    if first == second:
        return True
    shorter, longer = (first, second) if len(first) <= len(second) else (second, first)
    if len(shorter) < 10 or not longer.endswith(shorter):
        return False
    prefix = longer[: len(longer) - len(shorter)]
    return 1 <= len(prefix) <= 3


def duplicate_channel_message(values: dict[str, Any]) -> str | None:
    primary_email = str(values.get("primaryEmail") or "").strip().casefold()
    secondary_email = str(values.get("secondaryEmail") or "").strip().casefold()
    if primary_email and primary_email == secondary_email:
        return "Primary email and secondary email must be different."
    primary_phone = values.get("primaryPhone")
    secondary_phone = values.get("secondaryPhone")
    if phone_digits(primary_phone) and phones_equivalent(primary_phone, secondary_phone):
        return "Primary phone and secondary phone must be different."
    return None


def merged_channel_values(current: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    merged = dict(current)
    merged.update(patch)
    return merged


def contact_name_key(contact: dict[str, Any]) -> str:
    full = str(contact.get("fullName") or "").strip()
    if full:
        return " ".join(full.split()).casefold()
    return " ".join(
        part
        for part in (
            str(contact.get("firstName") or "").strip(),
            str(contact.get("lastName") or "").strip(),
        )
        if part
    ).casefold()


def match_contacts_by_query(
    candidates: list[dict[str, Any]],
    email: str | None,
    name: str | None,
) -> list[dict[str, Any]]:
    if email:
        normalized = email.strip().casefold()
        return [
            contact
            for contact in candidates
            if str(contact.get("primaryEmail") or "").casefold() == normalized
        ]
    if not name:
        return []
    normalized = " ".join(name.split()).casefold()
    exact = [contact for contact in candidates if contact_name_key(contact) == normalized]
    if exact:
        return exact
    tokens = [token for token in normalized.split() if token]
    return [
        contact
        for contact in candidates
        if tokens and all(token in contact_name_key(contact) for token in tokens)
    ]


def group_same_name_contacts(contacts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for contact in contacts:
        key = contact_name_key(contact)
        if not key:
            continue
        grouped.setdefault(key, []).append(contact)
    return [
        {
            "name": members[0].get("fullName") or key,
            "contacts": members,
        }
        for key, members in grouped.items()
        if len(members) > 1
    ]


def values_equivalent(key: str, left: Any, right: Any) -> bool:
    if key == "isActive":
        left_active = coerce_is_active(left)
        right_active = coerce_is_active(right)
        if left_active is None and right_active is None:
            return True
        return left_active == right_active
    if key in _PHONE_KEYS:
        return phones_equivalent(left, right)
    if left is None and right is None:
        return True
    if isinstance(left, str) and isinstance(right, str):
        return left.strip().casefold() == right.strip().casefold()
    return left == right


def meaningful_field_changes(
    current: dict[str, Any],
    patch: dict[str, Any],
) -> dict[str, Any]:
    changes: dict[str, Any] = {}
    for key, value in patch.items():
        next_value = coerce_is_active(value) if key == "isActive" else value
        if next_value is None and key == "isActive":
            continue
        if values_equivalent(key, current.get(key), next_value):
            continue
        changes[key] = next_value
    return changes

ContactDraftMode = Literal["create", "update"]
ContactEnrichmentField = Literal[
    "email",
    "phone",
    "firstName",
    "lastName",
    "displayName",
    "company",
    "city",
    "country",
]
ContactDraftField = Literal[
    "firstName",
    "lastName",
    "primaryEmail",
    "primaryPhone",
    "secondaryEmail",
    "secondaryPhone",
    "gender",
    "dateOfBirth",
    "company",
    "industry",
    "city",
    "region",
    "country",
    "language",
    "timezone",
    "customFields",
    "isActive",
]

CREATE_FIELD_SEQUENCE: tuple[str, ...] = (
    "firstName",
    "lastName",
    "primaryEmail",
    "primaryPhone",
    "secondaryPhone",
    "gender",
    "city",
    "country",
)

CREATE_FIELD_QUESTIONS = {
    "firstName": "What is the first name?",
    "lastName": "What is the last name? You can skip this.",
    "primaryEmail": "What is the email address?",
    "primaryPhone": (
        "What is the phone number, including a country name or calling code such as India or +91? "
        "You can skip this if an email is already set."
    ),
    "secondaryPhone": (
        "What is the WhatsApp or secondary phone number, including a country name or calling code? "
        "You can skip this."
    ),
    "gender": "What is the gender? You can skip this.",
    "city": "What city is this contact in? You can skip this.",
    "country": "What country? You can skip this.",
}


def _contact_field_present(fields: dict[str, Any], key: str) -> bool:
    value = fields.get(key)
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    return True


def _create_field_done(fields: dict[str, Any], skipped: set[str], key: str) -> bool:
    return key in skipped or _contact_field_present(fields, key)


def _first_open_create_field(fields: dict[str, Any], skipped: set[str]) -> str | None:
    for key in CREATE_FIELD_SEQUENCE:
        if not _create_field_done(fields, skipped, key):
            return key
    return None


def _staged_contact_fields() -> dict[str, Any]:
    staged = get_tool_context().contact_draft
    if not isinstance(staged, dict):
        return {}
    fields = staged.get("fields")
    return dict(fields) if isinstance(fields, dict) else {}


def _staged_skipped_fields() -> list[str]:
    staged = get_tool_context().contact_draft
    if not isinstance(staged, dict):
        return []
    skipped = staged.get("skippedFields")
    if not isinstance(skipped, list):
        return []
    return [str(item) for item in skipped]


def _snap_create_next_field(
    fields: dict[str, Any],
    skipped: list[str],
    requested: str | None,
) -> tuple[str | None, str | None]:
    skipped_set = {item for item in skipped}
    open_field = _first_open_create_field(fields, skipped_set)
    if open_field is None:
        return None, None
    if requested in {None, open_field}:
        return open_field, None if requested == open_field else (
            "Create still needs "
            f"{open_field} before confirmation. Ask it, or add it to skippedFields."
        )
    if requested in CREATE_FIELD_SEQUENCE:
        requested_index = CREATE_FIELD_SEQUENCE.index(requested)
        open_index = CREATE_FIELD_SEQUENCE.index(open_field)
        if requested_index > open_index:
            return open_field, (
                f"Ask {open_field} next (or skip it). Do not jump to confirmation "
                "until city and country are answered or skipped."
            )
    return open_field, None


class ContactMCPServer:
    tool_names = (
        "list_contacts",
        "count_contacts_created",
        "get_contact",
        "stage_contact_draft",
        "create_contact",
        "update_contact",
        "contact_enrich",
    )

    def __init__(self) -> None:
        self.http = CcCoreHTTPAdapter()
        self.mcp = FastMCP("contact")
        descriptions = {
            "list_contacts": (
                "Search or list contacts by full name, first name, last name, email, or "
                "phone. Same-name matches are grouped with emails for confirmation."
            ),
            "count_contacts_created": (
                "Count contacts created today, yesterday, or in an inclusive ISO date range. "
                "Prefer period=today/yesterday for those relative periods."
            ),
            "get_contact": (
                "Get one contact by id, exact email, or name. If several people share the "
                "name, returns those contacts with emails so the user can confirm."
            ),
            "stage_contact_draft": (
                "Stage a non-mutating contact preview only. Does not save the contact. "
                "Create mode follows firstName, lastName, primaryEmail, primaryPhone, "
                "secondaryPhone, gender, city, country. A phone number must include a "
                "country name or calling code and is stored in E.164 only when valid. "
                "City and country stay open until "
                "they have a value or are in skippedFields; nextField cannot be null before that."
            ),
            "create_contact": (
                "Persist a new contact after explicit confirmation. Staging is not a save."
            ),
            "update_contact": (
                "Persist contact field changes after explicit confirmation. Staging is not "
                "a save. If field arguments are omitted, applies the staged draft."
            ),
            "contact_enrich": (
                "Enrich the contact linked to the current conversation. "
                "Call when the customer explicitly states a profile field. "
                "Conflicts are safely skipped and returned in requiresConfirmation; "
                "independent non-conflicting fields are still applied. "
                "Skip when values already match the authoritative profile. "
                "For a confirmed replacement, include the exact field in confirmedFields. "
                "Returns appliedFields, skippedFields, requiresConfirmation, canonicalContactId, "
                "and the updated contact summary. Acknowledge only appliedFields."
            ),
        }
        for tool_name in self.tool_names:
            handler = getattr(self, tool_name)
            self.mcp.tool(name=tool_name, description=descriptions[tool_name])(handler)

    def _summary(self, contact: dict[str, Any]) -> dict[str, Any]:
        keys = (
            "id",
            "firstName",
            "lastName",
            "primaryEmail",
            "primaryPhone",
            "secondaryEmail",
            "secondaryPhone",
            "gender",
            "dateOfBirth",
            "company",
            "industry",
            "city",
            "region",
            "country",
            "language",
            "timezone",
            "customFields",
            "isActive",
            "updatedAt",
        )
        result = {key: contact.get(key) for key in keys}
        composed_name = " ".join(
            part
            for part in (
                str(contact.get("firstName") or "").strip(),
                str(contact.get("lastName") or "").strip(),
            )
            if part
        )
        result["fullName"] = contact.get("fullName") or composed_name or contact.get("primaryEmail")
        result["customFields"] = contact.get("customFields", {})
        result["isActive"] = contact.get("isActive", True)
        return result

    @staticmethod
    def _ready_update_preview_at_turn_start() -> bool:
        draft = get_tool_context().contact_draft_at_turn_start
        if not isinstance(draft, dict) or not draft.get("ready"):
            return False
        mode = str(draft.get("mode") or "update").strip().lower()
        return mode in {"", "update"}

    @staticmethod
    def _staged_field_patch() -> dict[str, Any]:
        staged = get_tool_context().contact_draft
        if not isinstance(staged, dict):
            return {}
        fields = staged.get("fields")
        if not isinstance(fields, dict):
            return {}
        return {
            key: value
            for key, value in fields.items()
            if key not in {"contactId", "email", "name", "id"} and value is not None
        }

    async def _contacts(
        self,
        search: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        payload = await self.http.request(
            "GET",
            "/api/v1/cdp/contacts",
            get_tool_context(),
            params={
                "search": search or "",
                "page": 1,
                "pageSize": min(max(limit, 1), 100),
                "sort": "updatedAt",
                "order": "desc",
            },
        )
        return list(payload.get("contacts", []))

    async def _find_contact(
        self,
        contact_id: str | None,
        email: str | None,
        name: str | None,
    ) -> dict[str, Any]:
        context = get_tool_context()
        resolved_id = contact_id or context.contact_id
        if resolved_id:
            payload = await self.http.request(
                "GET",
                f"/api/v1/cdp/contacts/{resolved_id}",
                context,
            )
            return dict(payload["contact"])
        query = (email or name or "").strip()
        if not query:
            raise CcCoreError("Provide a contact id, email, or name")
        candidates = await self._contacts(query, 25)
        matches = match_contacts_by_query(candidates, email, name)
        if not matches:
            raise CcCoreError(f'Contact "{query}" was not found')
        if len(matches) > 1:
            emails = ", ".join(
                str(contact.get("primaryEmail") or "no email") for contact in matches
            )
            raise CcCoreError(
                f'Multiple contacts are named "{query}". Ask the user which email to use: {emails}.'
            )
        return dict(matches[0])

    async def list_contacts(
        self,
        search: str | None = None,
        limit: int = 20,
    ) -> dict[str, Any]:
        contacts = [self._summary(contact) for contact in await self._contacts(search, limit)]
        limited = contacts[:limit]
        same_name_matches = group_same_name_contacts(limited)
        result: dict[str, Any] = {
            "contacts": limited,
            "count": len(limited),
            "search": search,
            "sameNameMatches": same_name_matches,
        }
        if same_name_matches:
            result["message"] = (
                "Several people share a name. Show each name with its email and ask "
                "which person the user means before updating."
            )
        return result

    async def count_contacts_created(
        self,
        period: Literal["today", "yesterday"] | None = None,
        startDate: str | None = None,
        endDate: str | None = None,
    ) -> dict[str, Any]:
        if period:
            resolved = date.today()
            if period == "yesterday":
                resolved -= timedelta(days=1)
            startDate = endDate = resolved.isoformat()
        if not startDate or not endDate:
            raise CcCoreError(
                "Provide period as today or yesterday, or provide both startDate and endDate"
            )
        payload = await self.http.request(
            "GET",
            "/api/v1/cdp/contacts/stats/created",
            get_tool_context(),
            params={"startDate": startDate, "endDate": endDate},
        )
        return {
            "count": int(payload.get("count", 0)),
            "startDate": str(payload.get("startDate") or startDate),
            "endDate": str(payload.get("endDate") or endDate),
        }

    async def get_contact(
        self,
        contactId: str | None = None,
        email: str | None = None,
        name: str | None = None,
    ) -> dict[str, Any]:
        context = get_tool_context()
        resolved_id = (contactId or "").strip() or context.contact_id
        if resolved_id:
            contact = await self._find_contact(resolved_id, None, None)
            return {"contact": self._summary(contact)}
        if email:
            contact = await self._find_contact(None, email, None)
            return {"contact": self._summary(contact)}
        query = (name or "").strip()
        if not query:
            raise CcCoreError("Provide a contact id, email, or name")
        matches = match_contacts_by_query(await self._contacts(query, 25), None, query)
        if not matches:
            raise CcCoreError(f'Contact "{query}" was not found')
        summaries = [self._summary(contact) for contact in matches]
        if len(summaries) > 1:
            return {
                "ambiguous": True,
                "contacts": summaries,
                "emails": [
                    str(contact.get("primaryEmail") or "")
                    for contact in summaries
                    if contact.get("primaryEmail")
                ],
                "message": (
                    f'Multiple contacts are named "{query}". Show each name with its email '
                    "and ask the user which person they mean before updating."
                ),
            }
        return {"contact": summaries[0]}

    async def stage_contact_draft(
        self,
        mode: ContactDraftMode,
        nextField: ContactDraftField | None = None,
        nextQuestion: str | None = None,
        contactId: str | None = None,
        firstName: str | None = None,
        lastName: str | None = None,
        primaryEmail: str | None = None,
        primaryPhone: str | None = None,
        secondaryEmail: str | None = None,
        secondaryPhone: str | None = None,
        gender: str | None = None,
        dateOfBirth: str | None = None,
        company: str | None = None,
        industry: str | None = None,
        city: str | None = None,
        region: str | None = None,
        country: str | None = None,
        language: str | None = None,
        timezone: str | None = None,
        customFields: dict[str, Any] | None = None,
        isActive: bool | None = None,
        skippedFields: list[ContactDraftField] | None = None,
        ready: bool | None = None,
    ) -> dict[str, Any]:
        fields = {
            key: value
            for key, value in {
                "firstName": firstName,
                "lastName": lastName,
                "primaryEmail": primaryEmail,
                "primaryPhone": primaryPhone,
                "secondaryEmail": secondaryEmail,
                "secondaryPhone": secondaryPhone,
                "gender": gender,
                "dateOfBirth": dateOfBirth,
                "company": company,
                "industry": industry,
                "city": city,
                "region": region,
                "country": country,
                "language": language,
                "timezone": timezone,
                "customFields": customFields,
                "isActive": coerce_is_active(isActive) if isActive is not None else None,
            }.items()
            if value is not None
        }
        resolved_contact_id = contactId or get_tool_context().contact_id
        current_summary: dict[str, Any] | None = None
        if mode == "update" and resolved_contact_id and fields:
            fields = normalize_phone_fields(fields)
            try:
                current_summary = self._summary(
                    await self._find_contact(resolved_contact_id, None, None)
                )
                fields = meaningful_field_changes(current_summary, fields)
            except CcCoreError:
                pass
        skipped = list(dict.fromkeys([*(skippedFields or []), *_staged_skipped_fields()]))
        snap_guidance: str | None = None
        if mode == "create":
            fields = normalize_phone_fields({**_staged_contact_fields(), **fields})
            nextField, snap_guidance = _snap_create_next_field(
                fields,
                skipped,
                nextField if isinstance(nextField, str) else None,
            )
            if nextField is None:
                nextQuestion = None
            elif snap_guidance or not nextQuestion:
                nextQuestion = CREATE_FIELD_QUESTIONS.get(nextField)
            ready = nextField is None
        elif ready is None:
            ready = nextField is None
        duplicate = duplicate_channel_message(merged_channel_values(current_summary or {}, fields))
        if duplicate:
            raise CcCoreError(duplicate)
        result: dict[str, Any] = {
            "_contact_draft": {
                "mode": mode,
                "contactId": resolved_contact_id,
                "fields": fields,
                "nextField": nextField,
                "nextQuestion": nextQuestion,
                "skippedFields": skipped,
                "ready": bool(ready),
            },
        }
        if snap_guidance:
            result["guidance"] = snap_guidance
        return result

    async def create_contact(
        self,
        firstName: str,
        primaryEmail: str | None = None,
        lastName: str | None = None,
        primaryPhone: str | None = None,
        secondaryEmail: str | None = None,
        secondaryPhone: str | None = None,
        gender: str | None = None,
        dateOfBirth: str | None = None,
        company: str | None = None,
        industry: str | None = None,
        city: str | None = None,
        region: str | None = None,
        country: str | None = None,
        language: str | None = None,
        timezone: str | None = None,
        customFields: dict[str, Any] | None = None,
        isActive: bool | None = None,
    ) -> dict[str, Any]:
        arguments = {
            key: value
            for key, value in {
                "firstName": firstName,
                "primaryEmail": primaryEmail,
                "lastName": lastName,
                "primaryPhone": primaryPhone,
                "secondaryEmail": secondaryEmail,
                "secondaryPhone": secondaryPhone,
                "gender": gender,
                "dateOfBirth": dateOfBirth,
                "company": company,
                "industry": industry,
                "city": city,
                "region": region,
                "country": country,
                "language": language,
                "timezone": timezone,
                "customFields": customFields,
                "isActive": isActive,
            }.items()
            if value is not None
        }
        arguments = normalize_phone_fields(arguments)
        async def operation() -> dict[str, Any]:
            if not firstName.strip():
                raise CcCoreError("First name is required to create a contact")
            if not primaryEmail and not primaryPhone:
                raise CcCoreError("Provide at least an email address or a phone number")
            duplicate = duplicate_channel_message({**_staged_contact_fields(), **arguments})
            if duplicate:
                raise CcCoreError(duplicate)
            payload = await self.http.request(
                "POST",
                "/api/v1/cdp/contacts",
                get_tool_context(),
                json_body=arguments,
            )
            return {"contact": self._summary(dict(payload["contact"]))}

        return await execute_once("create_contact", arguments, operation)

    async def update_contact(
        self,
        contactId: str | None = None,
        email: str | None = None,
        name: str | None = None,
        primaryEmail: str | None = None,
        firstName: str | None = None,
        lastName: str | None = None,
        primaryPhone: str | None = None,
        secondaryEmail: str | None = None,
        secondaryPhone: str | None = None,
        gender: str | None = None,
        dateOfBirth: str | None = None,
        company: str | None = None,
        industry: str | None = None,
        city: str | None = None,
        region: str | None = None,
        country: str | None = None,
        language: str | None = None,
        timezone: str | None = None,
        customFields: dict[str, Any] | None = None,
        isActive: bool | None = None,
    ) -> dict[str, Any]:
        arguments = {
            key: value
            for key, value in {
                "contactId": contactId,
                "email": email,
                "name": name,
                "primaryEmail": primaryEmail,
                "firstName": firstName,
                "lastName": lastName,
                "primaryPhone": primaryPhone,
                "secondaryEmail": secondaryEmail,
                "secondaryPhone": secondaryPhone,
                "gender": gender,
                "dateOfBirth": dateOfBirth,
                "company": company,
                "industry": industry,
                "city": city,
                "region": region,
                "country": country,
                "language": language,
                "timezone": timezone,
                "customFields": customFields,
                "isActive": isActive,
            }.items()
            if value is not None
        }
        async def operation() -> dict[str, Any]:
            if not self._ready_update_preview_at_turn_start():
                raise CcCoreError(
                    "Confirmation is required. Stage a ready preview first and wait for "
                    "the user to approve it. Providing a new field value is not confirmation."
                )
            staged = get_tool_context().contact_draft
            staged_id = (
                str(staged.get("contactId") or "").strip() or None
                if isinstance(staged, dict)
                else None
            )
            contact = await self._find_contact(contactId or staged_id, email, name)
            patch = {
                key: value
                for key, value in arguments.items()
                if key not in {"contactId", "email", "name"}
            }
            if not patch:
                patch = self._staged_field_patch()
            patch = normalize_phone_fields(patch)
            summary = self._summary(contact)
            patch = meaningful_field_changes(summary, patch)
            if not patch:
                raise CcCoreError(
                    "Specify at least one contact field that actually differs from the "
                    "current profile. Do not restage unchanged phones or add a country code."
                )
            duplicate = duplicate_channel_message(merged_channel_values(summary, patch))
            if duplicate:
                raise CcCoreError(duplicate)
            payload = await self.http.request(
                "PATCH",
                f"/api/v1/cdp/contacts/{contact['id']}",
                get_tool_context(),
                json_body=patch,
            )
            return {
                "contact": self._summary(dict(payload["contact"])),
                "changes": list(patch),
            }

        return await execute_once("update_contact", arguments, operation)

    async def contact_enrich(
        self,
        email: str | None = None,
        phone: str | None = None,
        firstName: str | None = None,
        lastName: str | None = None,
        displayName: str | None = None,
        company: str | None = None,
        city: str | None = None,
        country: str | None = None,
        confirmedFields: list[ContactEnrichmentField] | None = None,
    ) -> dict[str, Any]:
        arguments = {
            key: value.strip()
            for key, value in {
                "email": email,
                "phone": phone,
                "firstName": firstName,
                "lastName": lastName,
                "displayName": displayName,
                "company": company,
                "city": city,
                "country": country,
            }.items()
            if isinstance(value, str) and value.strip()
        }
        confirmed_fields = list(dict.fromkeys(confirmedFields or []))

        async def operation() -> dict[str, Any]:
            context = get_tool_context()
            if not context.conversation_id:
                raise CcCoreError("A selected conversation is required to enrich its contact")
            if not arguments:
                raise CcCoreError("Specify at least one contact field to enrich")
            logger.info(
                "contact_enrich.started",
                extra={
                    "event": "contact_enrich.started",
                    "tenant_id": context.tenant_id,
                    "conversation_id": context.conversation_id,
                    "contact_enrich": {"fields": list(arguments.keys())},
                },
            )
            payload = await self.http.request(
                "POST",
                f"/internal/v1/conversations/{context.conversation_id}/contact/enrich",
                context,
                json_body={
                    "contactEntities": arguments,
                    "confirmedFields": confirmed_fields,
                },
                internal=True,
            )
            nested = payload.get("result") if isinstance(payload, dict) else None
            contact_summary = None
            if isinstance(nested, dict):
                contact = nested.get("contact")
                if isinstance(contact, dict):
                    contact_summary = self._summary(contact)
            logger.info(
                "contact_enrich.completed",
                extra={
                    "event": "contact_enrich.completed",
                    "tenant_id": context.tenant_id,
                    "conversation_id": context.conversation_id,
                    "contact_enrich": {
                        "outcome": nested.get("outcome") if isinstance(nested, dict) else None,
                        "fields": list(arguments.keys()),
                        "canonicalContactId": (
                            nested.get("canonicalContactId") if isinstance(nested, dict) else None
                        ),
                        "appliedFields": (
                            nested.get("appliedFields") if isinstance(nested, dict) else []
                        ),
                        "requiresConfirmation": (
                            nested.get("requiresConfirmation") if isinstance(nested, dict) else []
                        ),
                    },
                },
            )
            applied_fields = (
                nested.get("appliedFields") if isinstance(nested, dict) else []
            ) or []
            skipped_fields = (
                nested.get("skippedFields") if isinstance(nested, dict) else []
            ) or []
            requires_confirmation = (
                nested.get("requiresConfirmation") if isinstance(nested, dict) else []
            ) or []
            outcome = nested.get("outcome") if isinstance(nested, dict) else "no_change"
            if requires_confirmation:
                summary = (
                    f"Updated: {', '.join(applied_fields) or 'none'}. "
                    f"Not updated pending customer confirmation: "
                    f"{', '.join(requires_confirmation)}."
                )
            elif applied_fields:
                summary = f"Updated contact fields: {', '.join(applied_fields)}."
            elif skipped_fields:
                summary = "; ".join(
                    str(item.get("message") or item.get("field") or "")
                    for item in skipped_fields
                    if isinstance(item, dict) and (
                        item.get("message") or item.get("field")
                    )
                ) or "No contact fields changed."
            else:
                summary = "No contact fields changed."
            return {
                "conversationId": context.conversation_id,
                "enriched": bool(applied_fields),
                "status": outcome,
                "summary": summary,
                "fields": list(arguments),
                "contact": contact_summary,
                "canonicalContactId": (
                    nested.get("canonicalContactId") if isinstance(nested, dict) else None
                ),
                "appliedFields": applied_fields,
                "skippedFields": skipped_fields,
                "requiresConfirmation": requires_confirmation,
                "outcome": outcome,
                "result": nested,
            }

        operation_arguments = {
            **arguments,
            **({"confirmedFields": confirmed_fields} if confirmed_fields else {}),
        }
        return await execute_once("contact_enrich", operation_arguments, operation)
