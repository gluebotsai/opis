"""Join-session carry_messages merge.

Kept independent of Socket.IO so unit tests can load it without agent extras.
"""

from __future__ import annotations

import uuid
from datetime import datetime


def message_role_text_key(
    role: str, text: str, image_url: str = ""
) -> tuple[str, str, str]:
    return (
        str(role or "").strip().lower(),
        str(text or "").strip(),
        str(image_url or "").strip(),
    )


def _image_url_list_from_row(row: dict) -> list[str]:
    raw = row.get("image_urls") or row.get("imageUrls")
    urls: list[str] = []
    if isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            u = str(item.get("url") or "").strip()
            if u:
                urls.append(u)
    if urls:
        return urls[:12]
    single = str(row.get("image_url") or row.get("imageUrl") or "").strip()
    return [single] if single else []


def _image_url_dicts_from_row(row: dict) -> list[dict[str, str]]:
    raw = row.get("image_urls") or row.get("imageUrls")
    out: list[dict[str, str]] = []
    if isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            u = str(item.get("url") or "").strip()
            if not u:
                continue
            fn = str(item.get("filename") or "").strip()
            out.append({"url": u[:4096], **({"filename": fn[:240]} if fn else {})})
    if out:
        return out[:12]
    single = str(row.get("image_url") or row.get("imageUrl") or "").strip()
    if not single:
        return []
    fn = str(row.get("image_filename") or row.get("imageFilename") or "").strip()
    item: dict[str, str] = {"url": single[:4096]}
    if fn:
        item["filename"] = fn[:240]
    return [item]


def _merge_message_image_fields(keep: dict, donor: dict) -> dict:
    """Union image_urls; prefer the longer / richer attachment list."""
    merged = dict(keep)
    a = _image_url_dicts_from_row(keep)
    b = _image_url_dicts_from_row(donor)
    if not a and not b:
        return merged
    by_url: dict[str, dict[str, str]] = {}
    for row in a + b:
        u = str(row.get("url") or "").strip()
        if not u:
            continue
        prev = by_url.get(u)
        if not prev:
            by_url[u] = dict(row)
            continue
        if not prev.get("filename") and row.get("filename"):
            by_url[u] = dict(row)
    ordered: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in a + b:
        u = str(row.get("url") or "").strip()
        if not u or u in seen:
            continue
        seen.add(u)
        ordered.append(by_url[u])
    if not ordered:
        return merged
    merged["image_urls"] = ordered[:12]
    merged["image_url"] = ordered[0]["url"]
    if ordered[0].get("filename"):
        merged["image_filename"] = ordered[0]["filename"]
    return merged


def message_row_key(row: dict) -> tuple[str, str, str]:
    role = str(row.get("role") or "").strip().lower()
    text = str(row.get("text") or "").strip()
    fp = "|".join(_image_url_list_from_row(row))
    return (role, text, fp)


def normalize_carry_message_rows(raw: list) -> list[dict]:
    """FE/handoff rows → session message dicts (order preserved, max 40)."""
    out: list[dict] = []
    seen: set[tuple[str, str, str]] = set()
    for row in raw[-40:]:
        if not isinstance(row, dict):
            continue
        role = str(row.get("role") or "").strip().lower()
        text = str(row.get("text") or "").strip()
        image_dicts = _image_url_dicts_from_row(row)
        image_url = (
            image_dicts[0]["url"]
            if image_dicts
            else str(row.get("image_url") or row.get("imageUrl") or "").strip()
        )
        image_filename = str(
            row.get("image_filename") or row.get("imageFilename") or ""
        ).strip()
        if role not in ("user", "assistant"):
            continue
        if not text and not image_url and not image_dicts:
            continue
        key = message_row_key(
            {
                "role": role,
                "text": text,
                "image_url": image_url,
                "image_urls": image_dicts or None,
            }
        )
        if key in seen:
            continue
        seen.add(key)
        msg: dict = {
            "id": str(row.get("id") or uuid.uuid4()),
            "role": role,
            "text": text,
            "created_at": str(
                row.get("createdAt") or row.get("created_at") or ""
            ),
            "meta": {"carry_handoff": True},
        }
        if image_dicts:
            msg["image_urls"] = image_dicts
            msg["image_url"] = image_dicts[0]["url"]
            if image_dicts[0].get("filename"):
                msg["image_filename"] = image_dicts[0]["filename"]
        elif image_url:
            msg["image_url"] = image_url[:4096]
        if image_filename and not msg.get("image_filename"):
            msg["image_filename"] = image_filename[:240]
        out.append(msg)
    return out


def _message_created_at_ms(row: dict) -> float:
    raw = str(row.get("created_at") or row.get("createdAt") or "").strip()
    if not raw:
        return 0.0
    try:
        normalized = raw.replace("Z", "+00:00")
        return datetime.fromisoformat(normalized).timestamp()
    except Exception:  # noqa: BLE001
        return 0.0


def _insert_carry_row_by_created_at(out: list[dict], row: dict) -> None:
    """Insert a missing carry row by created_at; fall back to before first user."""
    t = _message_created_at_ms(row)
    insert_at = len(out)
    if t > 0:
        for i, existing in enumerate(out):
            ot = _message_created_at_ms(existing)
            if ot > 0 and ot > t:
                insert_at = i
                break
    elif str(row.get("role") or "").strip().lower() == "user":
        for i, existing in enumerate(out):
            if str(existing.get("role") or "").strip().lower() == "user":
                insert_at = i
                break
    out.insert(insert_at, row)


def last_handoff_turns(carry: list[dict], max_user_turns: int) -> list[dict]:
    """Keep only the last N user turns (plus the assistant immediately before)."""
    if max_user_turns <= 0:
        return []
    user_indexes = [
        i
        for i, row in enumerate(carry)
        if str(row.get("role") or "").strip().lower() == "user"
    ]
    if not user_indexes:
        return []
    start_user = user_indexes[-max_user_turns]
    start = start_user
    if (
        start_user > 0
        and str(carry[start_user - 1].get("role") or "").strip().lower()
        == "assistant"
    ):
        start = start_user - 1
    return list(carry[start:])


def merge_carry_into_messages(
    existing: list[dict],
    carry: list[dict],
    *,
    allow_missing_user_backfill: bool = False,
    empty_adopt_max_user_turns: int | None = None,
    restrict_to_handoff: bool = False,
) -> list[dict] | None:
    """
    Merge FE carry into server messages without relocating an established transcript.

    Create-campaign drafts must not backfill every missing user turn from carry —
    that copied Diwali user lines into a new Pongal session. Empty transcripts
    adopt at most `empty_adopt_max_user_turns` (handoff). Established transcripts
    may append only the trailing pending user.

    Hub / other modules pass allow_missing_user_backfill=True for reconnect.

    Returns None when nothing should change.
    """
    if not carry:
        return None
    existing = [m for m in existing if isinstance(m, dict)]
    if not existing:
        if empty_adopt_max_user_turns is not None:
            sliced = last_handoff_turns(carry, empty_adopt_max_user_turns)
            return sliced or None
        if restrict_to_handoff:
            return None
        return list(carry)

    exist_keys = {message_row_key(m) for m in existing}
    carry_keys = {message_row_key(m) for m in carry}

    if existing and (restrict_to_handoff or len(existing) >= 2):
        missing_users = [
            row
            for row in carry
            if str(row.get("role") or "").strip().lower() == "user"
            and message_row_key(row) not in exist_keys
        ]
        if not missing_users:
            return None
        if restrict_to_handoff or not allow_missing_user_backfill:
            trailing = missing_users[-1]
            out = list(existing)
            out.append(trailing)
            return out
        out = list(existing)
        for row in missing_users:
            _insert_carry_row_by_created_at(out, row)
        return out

    if exist_keys and exist_keys <= carry_keys:
        by_key: dict[tuple[str, str, str], dict] = {}
        for m in existing:
            by_key[message_row_key(m)] = m
        if len(existing) >= 2:
            # Established transcript — keep server order (refresh must not scramble).
            out = list(existing)
            changed = False
            for row in carry:
                key = message_row_key(row)
                if key in by_key:
                    idx = next(
                        i
                        for i, m in enumerate(out)
                        if message_row_key(m) == key
                    )
                    merged_row = _merge_message_image_fields(dict(out[idx]), row)
                    if merged_row != out[idx]:
                        out[idx] = merged_row
                        changed = True
                    continue
                _insert_carry_row_by_created_at(out, row)
                changed = True
            if not changed:
                return None
            return out
        merged: list[dict] = []
        for row in carry:
            key = message_row_key(row)
            if key in by_key:
                keep = _merge_message_image_fields(dict(by_key[key]), row)
                merged.append(keep)
            else:
                merged.append(row)
        if merged == existing:
            return None
        return merged

    seen = set(exist_keys)
    out = list(existing)
    added = False
    for row in carry:
        key = message_row_key(row)
        if key in seen:
            continue
        seen.add(key)
        out.append(row)
        added = True
    return out if added else None
