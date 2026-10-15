"""Dispatch coworker MCP tools — UI directives + crm.* SQL mutations."""

from __future__ import annotations

import json
import uuid
from typing import Any

from app.mcp import db
from app.mcp.commands import forward_business_command
from app.mcp.catalog import FORM_OWNED_TOOLS, get_tool
from app.mcp.context import get_ctx
from app.mcp.rbac import (
    McpAuthError,
    can_access_module,
    require_edit,
    require_org,
    require_user,
)
from app.mcp.seo_tools import handle_seo_tool


def _str(v: Any) -> str:
    if v is None:
        return ""
    return str(v).strip()


def _confirmed(args: dict[str, Any]) -> bool:
    return args.get("confirmed") is True or args.get("confirmed") == "true"


def _proposal(def_: dict[str, Any], args: dict[str, Any]) -> dict[str, Any]:
    label = _str(args.get("label")) or def_["name"].replace("propose_", "").replace(
        "_", " "
    )
    rest = {k: v for k, v in args.items() if k != "confirmed"}
    return {
        "id": f"mcp-{def_['name']}-{uuid.uuid4().hex[:8]}",
        "name": def_["name"],
        "label": label[:80],
        "args": {**rest, "auto": args.get("auto") is True},
        "risk": def_.get("risk") or "low",
    }


def _fail(error: str) -> dict[str, Any]:
    return {"ok": False, "kind": "error", "error": error}


def _ok_executed(text: str, data: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "ok": True,
        "kind": "executed",
        "assistantText": text,
        "data": data or {},
    }


def _form_owned_result(def_: dict[str, Any], args: dict[str, Any]) -> dict[str, Any]:
    """Vite/Fastify page handler performs the write — return a chat proposal."""
    ctx = get_ctx()
    from app.orchestrator.action_receipts import receipt_key

    scoped_args = dict(args)
    if ctx.organization_id and ctx.acting_user_id:
        scoped_args["receiptKey"] = receipt_key(
            ctx.organization_id, ctx.acting_user_id, def_["name"], args
        )
    return {
        "ok": True,
        "kind": "form_owned",
        "proposal": _proposal(def_, {**scoped_args, "auto": True}),
    }


def _merge_draft(args: dict[str, Any]) -> dict[str, Any]:
    draft = get_ctx().draft if isinstance(get_ctx().draft, dict) else {}
    return {**draft, **args}


def _is_hub_actor() -> bool:
    actor = (get_ctx().acting_user_id or "").strip().lower()
    return actor.startswith("hub:")


async def dispatch(
    name: str,
    raw_args: dict[str, Any] | None = None,
) -> dict[str, Any]:
    def_ = get_tool(name)
    if not def_:
        return _fail(f"Unknown tool: {name}")
    args = dict(raw_args or {})

    seo_result = await handle_seo_tool(name, args)
    if seo_result is not None:
        return seo_result

    # Hub cannot use Vite form-owned writes — execute confirmed mutations.
    hub_form_owned_write = (
        name in {"propose_create_activity", "propose_stage_change"}
        and _confirmed(args)
        and _is_hub_actor()
        and bool(get_ctx().execution_token)
    )
    if name in FORM_OWNED_TOOLS and not hub_form_owned_write:
        return _form_owned_result(def_, args)

    kind = def_.get("kind")
    if kind == "clarify":
        q = _str(args.get("question")) or "Could you clarify what you’d like to do?"
        return {
            "ok": True,
            "kind": "clarify",
            "assistantText": q,
        }

    if kind == "draft_patch":
        patch = {
            k: v
            for k, v in args.items()
            if v is not None and v != "" and k not in ("label", "auto", "confirmed")
        }
        if name == "patch_company_draft":
            if not patch.get("locationAddress"):
                addr = patch.pop("address", None)
                if isinstance(addr, str) and addr.strip():
                    patch["locationAddress"] = addr.strip()
            city = patch.pop("city", None)
            if isinstance(city, str) and city.strip():
                if not patch.get("locationName"):
                    patch["locationName"] = city.strip()
                # Never mirror city into street address — address is its own guided step.
            from app.agents.draft_conversation import (
                clamp_company_patch_to_walk,
                company_next_ask_key,
                normalize_company_address_patch,
            )

            draft = get_ctx().draft if isinstance(get_ctx().draft, dict) else {}
            ask = company_next_ask_key(draft)
            patch = dict(
                normalize_company_address_patch(patch, draft) or {},
            )
            patch = clamp_company_patch_to_walk(patch, ask=ask)
        return {
            "ok": True,
            "kind": "draft_patch",
            "patch": patch,
            "proposal": _proposal(def_, {**args, "auto": True}),
        }

    if kind == "ui_directive":
        href = _str(args.get("href"))
        if href and get_ctx().business_type:
            target = href.lstrip("/").split("/", 1)[0]
            target = "sales" if target in {"quotes", "calendar"} else target
            if target and not can_access_module(
                target, get_ctx().business_type, get_ctx().role
            ):
                return _fail("Your role or business type cannot open that CRM module.")
        return {
            "ok": True,
            "kind": "ui_directive",
            "proposal": _proposal(
                def_, {**args, "auto": args.get("auto") is not False}
            ),
        }

    # Mutations / analytics / memory
    if def_.get("risk") == "high" and not _confirmed(args):
        return {
            "ok": True,
            "kind": "needs_confirm",
            "proposal": _proposal(def_, args),
        }

    # Low-risk mutations (memory, analytics) may run without confirm
    if name not in (
        "lookup_contacts",
        "remember_memory",
        "clear_memory",
    ):
        if not _confirmed(args) and kind == "mutation" and def_.get("risk") == "low":
            # still allow auto for low risk when agent sets confirmed or auto
            if args.get("auto") is not True and not _confirmed(args):
                # remember_memory: treat as executable when called by agent with values
                pass

    try:
        return await _run_mutation(name, args)
    except McpAuthError as exc:
        return _fail(str(exc))
    except Exception as exc:  # noqa: BLE001
        return _fail(str(exc) or "Tool failed")


async def _run_mutation(name: str, args: dict[str, Any]) -> dict[str, Any]:
    merged = _merge_draft(args)
    ctx = get_ctx()

    if name == "query_analytics":
        org = require_org()
        user = require_user()
        if not can_access_module("dashboard", ctx.business_type, ctx.role):
            raise McpAuthError(
                "Your role or business type cannot access CRM analytics."
            )
        question = _str(args.get("question"))[:4000]
        if not question:
            return _fail("Analytics question is required.")

        allowed_objects = {
            "contacts",
            "companies",
            "deals",
            "quotes",
            "invoices",
            "activities",
            "contracts",
            "products",
        }
        raw_context = (
            args.get("reportsContext")
            if isinstance(args.get("reportsContext"), dict)
            else {}
        )
        reports_context = {
            key: str(raw_context.get(key) or "")[:400]
            for key in (
                "objectLock",
                "timePhrase",
                "lastKpiId",
                "lastAnswerType",
                "lastSummary",
            )
            if raw_context.get(key)
        }
        object_lock = _str(args.get("objectLock")).lower()
        if object_lock not in allowed_objects:
            object_lock = _str(reports_context.get("objectLock")).lower()
        if object_lock not in allowed_objects:
            object_lock = ""
        if object_lock:
            reports_context["objectLock"] = object_lock

        recent_messages: list[dict[str, str]] = []
        raw_messages = args.get("recentMessages")
        if isinstance(raw_messages, list):
            for item in raw_messages[-8:]:
                if not isinstance(item, dict):
                    continue
                role = _str(item.get("role")).lower()
                content = _str(item.get("content"))[:400]
                if role in {"user", "assistant"} and content:
                    recent_messages.append({"role": role, "content": content})

        from app.agents.reports_analytics_agent import run as run_reports

        result = await run_reports(
            question=question,
            organization_id=org,
            actor_id=user,
            role=ctx.role,
            business_type=ctx.business_type,
            session_id=_str(args.get("sessionId")) or ctx.run_id or None,
            messages=recent_messages,
            working_memory=(
                {"slots": {"reportsContext": reports_context}}
                if reports_context
                else None
            ),
            time_phrase=_str(args.get("timePhrase")) or None,
            object_lock=object_lock or None,
        )
        ok = result.get("ok") is not False
        return {
            "ok": ok,
            "kind": "executed",
            "assistantText": _str(result.get("assistantText")),
            "data": {
                "analytics": result.get("analytics"),
                "suggestions": result.get("suggestions"),
                "reportsContextPatch": result.get("reportsContextPatch"),
                "source": result.get("source") or "ai",
                "reason": result.get("reason"),
            },
            **(
                {"error": _str(result.get("error")) or "reports_turn_failed"}
                if not ok
                else {}
            ),
        }

    if name == "lookup_contacts":
        return await _lookup_contacts(_str(merged.get("query")))

    if name == "remember_memory":
        require_edit()
        org = require_org()
        user = require_user()
        scope_type = _str(merged.get("scopeType")) or "user"
        scope_id = "" if scope_type == "org" else (_str(merged.get("scopeId")) or user)
        slot_key = _str(merged.get("slotKey"))
        if slot_key not in {
            "prefs",
            "last_intent",
            "open_ask",
            "entity_hint",
            "tone",
            "follow_up",
            "note",
        }:
            return _fail("Invalid slotKey")
        val = merged.get("slotValue")
        if isinstance(val, str):
            try:
                slot_value = json.loads(val)
            except json.JSONDecodeError:
                slot_value = val
        else:
            slot_value = val
        mem_id = f"amem_{uuid.uuid4().hex[:16]}"
        await db.execute(
            """
            INSERT INTO agent_memories (
              id, organization_id, scope_type, scope_id, slot_key, slot_value, source,
              created_at, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,'chat',NOW(),NOW())
            ON CONFLICT (organization_id, scope_type, scope_id, slot_key)
            DO UPDATE SET slot_value = EXCLUDED.slot_value, updated_at = NOW(), source = 'chat'
            """,
            mem_id,
            org,
            scope_type,
            scope_id,
            slot_key,
            json.dumps(slot_value),
        )
        ctx.note_refresh(reason="memory")
        return _ok_executed("Remembered.", {"slotKey": slot_key})

    if name == "clear_memory":
        require_edit()
        org = require_org()
        user = require_user()
        scope_type = _str(merged.get("scopeType")) or "user"
        scope_id = "" if scope_type == "org" else (_str(merged.get("scopeId")) or user)
        slot_key = _str(merged.get("slotKey"))
        await db.execute(
            """
            DELETE FROM agent_memories
            WHERE organization_id = $1::bigint
              AND scope_type = $2 AND scope_id = $3 AND slot_key = $4
            """,
            org,
            scope_type,
            scope_id,
            slot_key,
        )
        ctx.note_refresh(reason="memory")
        return _ok_executed("Cleared that memory.")

    # Remaining high-risk / create paths need confirm already checked
    require_edit()
    org = require_org()
    user = require_user()

    if name == "propose_create_activity":
        contact_id = _str(merged.get("contactId")) or _str(ctx.entity_id)
        subject = _str(merged.get("subject")) or _str(merged.get("body"))
        activity_type = _str(merged.get("type")) or "note"
        if not contact_id or not subject:
            return _fail("contactId and subject are required to log an activity")
        data = await forward_business_command(
            "create_activity",
            {
                "contactId": contact_id,
                "type": activity_type,
                "subject": subject,
                "body": _str(merged.get("body")) or subject,
                "dueAt": _str(merged.get("dueAt")) or None,
                "assigneeUserId": _str(merged.get("assigneeUserId")) or None,
            },
        )
        ctx.note_refresh(
            modules=["activities", "contact"],
            entity_ids=[contact_id, str(data.get("activityId") or "")],
            reason="activity_created",
        )
        return _ok_executed(
            f"Logged {activity_type} on the contact.",
            {
                "contactId": contact_id,
                "activityId": data.get("activityId"),
                "type": data.get("type") or activity_type,
            },
        )

    if name == "propose_stage_change":
        from app.agents.deal_draft_agent import normalize_deal_stage

        deal_id = _str(merged.get("dealId")) or _str(ctx.entity_id)
        stage = normalize_deal_stage(merged.get("stage")) or ""
        if not deal_id or not stage:
            return _fail("dealId and stage required")
        from app.orchestrator.action_receipts import configured_action_receipts

        receipts = configured_action_receipts()
        receipt = await receipts.claim(
            organization_id=org,
            actor_id=user,
            tool_name=name,
            arguments=merged,
        )
        if receipt.replay:
            return _ok_executed(
                "This confirmed action was already applied.",
                {"receiptId": receipt.receipt_id, "replayed": True},
            )
        try:
            data = await forward_business_command(
                "update_deal_stage",
                {
                    "dealId": deal_id,
                    "stage": stage,
                    "lostReason": _str(merged.get("lostReason")) or None,
                },
            )
        except Exception:
            await receipts.release(receipt)
            raise
        ctx.note_refresh(
            modules=["sales"],
            entity_ids=[deal_id, str(data.get("contactId") or "")],
            reason="deal_stage",
        )
        return _ok_executed(
            "Done — stage updated.",
            {
                "dealId": deal_id,
                "stage": stage,
                **({"receiptId": receipt.receipt_id} if receipt else {}),
            },
        )

    if name == "compose_customer_email":
        return await _compose_customer_email(args)

    if name in FORM_OWNED_TOOLS:
        return _form_owned_result(get_tool(name) or {"name": name, "risk": "low"}, args)

    return _fail(f"No handler for tool: {name}")


def email_address_list(value: Any) -> list[str]:
    """Pull real email addresses out of a tool `to` array or a loose string."""
    import re

    chunks: list[str] = []
    if isinstance(value, list):
        chunks = [str(item) for item in value]
    elif value is not None and str(value).strip():
        chunks = [str(value)]
    seen: set[str] = set()
    out: list[str] = []
    pattern = re.compile(r"[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}", re.I)
    for chunk in chunks:
        for match in pattern.findall(chunk):
            key = match.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append(match)
    return out


async def _compose_customer_email(args: dict[str, Any]) -> dict[str, Any]:
    """Reuse compose-email. The page agent must not invent the subject or body."""
    from app.agents.compose_email_agent import run as compose_email

    instruction = _str(args.get("instruction"))
    if not instruction:
        return _fail("Say what the email should say.")
    ctx = get_ctx()
    saved = ctx.email_draft if isinstance(ctx.email_draft, dict) else {}
    if str(saved.get("status") or "") == "sent":
        saved = {}
    current_subject = _str(args.get("currentSubject")) or _str(saved.get("subject")) or None
    current_body = _str(args.get("currentBody")) or _str(saved.get("body")) or None
    result = await compose_email(
        instruction=instruction,
        contact_id=_str(args.get("contactId")) or None,
        contact_name=_str(args.get("contactName")) or None,
        company_name=_str(args.get("companyName")) or None,
        subject=current_subject,
        current_body=current_body,
        is_reply=bool(args.get("isReply")),
        organization_id=ctx.organization_id or None,
    )
    subject = _str(result.get("subject"))
    body = _str(result.get("body"))
    if not result.get("ok") or not body:
        return _fail(str(result.get("reason") or "Could not draft that email."))
    return _ok_executed(
        "Draft ready. Call propose_save_email_draft with this subject and body.",
        {
            "subject": subject,
            "body": body,
            "to": email_address_list(args.get("to")),
            "contactId": _str(args.get("contactId")),
            "contactName": _str(args.get("contactName")),
            "companyName": _str(args.get("companyName")),
        },
    )


async def _lookup_contacts(query: str) -> dict[str, Any]:
    q = query.strip()
    if len(q) < 2:
        return _fail("Say the name or email to look up.")
    data = await forward_business_command(
        "lookup_contacts",
        {"query": q[:80]},
    )
    items = data.get("items") if isinstance(data.get("items"), list) else []
    try:
        total = int(data.get("total"))
    except (TypeError, ValueError):
        total = len(items)
    noun = "contact" if total == 1 else "contacts"
    return _ok_executed(
        f"Found {total} {noun} matching {q}.",
        {"query": q, "total": total, "items": items[:8]},
    )

