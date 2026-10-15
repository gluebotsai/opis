#!/usr/bin/env python3
"""Add illustrative Sample column to CRM field tables in docs/table-schemas.md."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOC = ROOT / "docs" / "table-schemas.md"

# Consistent fictional row (B2B demo org 1000, TCS / Jane Doe arc)
S = {
    "cuid": "clx7k2m9p0001abc123def",
    "company_id": "clx7comp0001tcs00001",
    "location_id": "clx7loc0001mumbai001",
    "deal_id": "clx7deal0001crmexp001",
    "contact_id": "9",
    "activity_id": "clx7act0001meeting01",
    "appointment_id": "clx7appt0001demo001",
    "quote_id": "clx7quote0001q2026001",
    "order_id": "clx7order0001so202601",
    "invoice_id": "clx7inv0001inv2026001",
    "proposal_id": "clx7prop0001p2026001",
    "product_id": "clx7prod0001crmseat01",
    "offer_id": "clx7offer0001pro001",
    "addon_id": "clx7addon0001support1",
    "template_id": "clx7tmpl0001quote001",
    "session_id": "clx7sess0001meet001",
    "job_id": "clx7job0001score001",
    "org_id": "1000",
    "user_id": "1006",
    "admin_id": "1001",
    "ts": "2026-08-25T10:00:00.000Z",
    "ts_end": "2026-08-25T10:30:00.000Z",
    "date": "2026-08-25",
}


def sample_for(col: str, typ: str, null: str, default: str, desc: str) -> str:
    c = col.strip("`")
    nullable = null == "nullable"
    t = typ.lower()

    # Explicit column overrides (highest priority)
    overrides: dict[str, str] = {
        "id": S["cuid"],
        "organization_id": S["org_id"],
        "account_contact_id": S["contact_id"],
        "contact_id": S["contact_id"],
        "company_id": S["company_id"],
        "location_id": S["location_id"],
        "deal_id": S["deal_id"],
        "activity_id": S["activity_id"],
        "appointment_id": S["appointment_id"],
        "quote_id": S["quote_id"],
        "order_id": S["order_id"],
        "invoice_id": S["invoice_id"],
        "proposal_id": S["proposal_id"],
        "product_id": S["product_id"],
        "offer_id": S["offer_id"],
        "addon_id": S["addon_id"],
        "template_id": S["template_id"],
        "session_id": S["session_id"],
        "job_id": S["job_id"],
        "parent_company_id": S["company_id"],
        "converted_deal_id": S["deal_id"],
        "renew_deal_id": S["deal_id"],
        "inbound_activity_id": S["activity_id"],
        "reply_activity_id": S["activity_id"],
        "price_book_id": "clx7pb0001usdlist001",
        "addon_id_tier": S["addon_id"],
        "entity_id": S["deal_id"],
        "owner_user_id": S["user_id"],
        "user_id": S["user_id"],
        "host_user_id": S["user_id"],
        "created_by_user_id": S["user_id"],
        "updated_by_user_id": S["user_id"],
        "actor_user_id": S["user_id"],
        "assignee_user_id": S["user_id"],
        "mailbox_user_id": S["user_id"],
        "escalated_to_user_id": S["admin_id"],
        "approved_by_user_id": S["admin_id"],
        "name": "TCS",
        "title": "CRM expansion — TCS Mumbai",
        "subject": "Product demo follow-up",
        "number": "Q-2026-0042",
        "domain": "tcs.com",
        "linkedin_url": "https://linkedin.com/company/tcs",
        "logo_url": "https://cdn.example.com/logos/tcs.png",
        "industry": "IT services",
        "employee_count": "620000",
        "channel_role": "standard",
        "type": "hq",
        "address": "Nariman Point, Mumbai",
        "city": "Mumbai",
        "country": "India",
        "lead_source": "Inbound demo request",
        "lead_status": "qualified",
        "disqualify_reason": "null",
        "crm_status": "active",
        "notes": "Interested in 50-seat rollout Q4.",
        "tags": "{enterprise, inbound}",
        "contact_name": "Jane Doe",
        "contact_email": "jane.doe@tcs.com",
        "contact_type": "lead",
        "stage": "discover",
        "amount": "85000.00",
        "currency": "USD",
        "subtotal": "75000.00",
        "total": "85000.00",
        "discount_pct": "5.00",
        "discount_amount": "3750.00",
        "tax_amount": "6375.00",
        "quantity": "50",
        "unit_price": "1500.00",
        "sort_order": "0",
        "version": "1",
        "status": "scheduled",
        "source": "crm_ui",
        "provider": "google_meet",
        "join_url": "https://meet.google.com/abc-defg-hij",
        "calendar_event_id": "google_evt_abc123xyz",
        "timezone": "Asia/Kolkata",
        "starts_at": S["ts"],
        "ends_at": S["ts_end"],
        "guest_emails": '["jane.doe@tcs.com"]',
        "assignment_reason": "Territory match: India + existing relationship",
        "title_appt": "Worktual CRM demo — TCS",
        "folder": "inbox",
        "thread_id": "thread-clx7inbox001",
        "email_direction": "inbound",
        "mail_provider": "google",
        "account_email": "rep.b2b@worktual.com",
        "watch_kind": "user",
        "history_id": "184729",
        "senior_amount_threshold": "50000",
        "accepting_leads": "true",
        "max_open_deals": "25",
        "seniority_tier": "mid",
        "on_pto_until": "null",
        "code": "PRO-ANNUAL",
        "billing_type": "recurring",
        "billing_frequency": "annual",
        "included_qty": "50",
        "meter_key": "seat",
        "pricing_model": "per_unit",
        "flat_price": "null",
        "step_size": "null",
        "min_qty": "1",
        "max_qty": "49",
        "is_default": "false",
        "is_pinned": "false",
        "is_overage": "false",
        "marketing_opt_out": "false",
        "needs_manual_response": "false",
        "forecast_flagged": "false",
        "assignment_escalated": "false",
        "flagged_for_review": "false",
        "bant_budget": "true",
        "bant_authority": "false",
        "bant_need": "true",
        "bant_timeline": "true",
        "vertical": "general",
        "action": "stage_change",
        "entity_type": "deal",
        "kind": "dashboard_pipeline",
        "agent": "score",
        "step": "load_context",
        "label": "Load lead context",
        "seq": "1",
        "speaker": "Jane Doe",
        "text": "We are evaluating CRM for our sales team.",
        "spoken_at": S["ts"],
        "outcome": "qualified_interest",
        "confidence": "0.82",
        "enrichment_confidence": "0.91",
        "score": "72",
        "fit_score": "68",
        "intent_score": "76",
        "band": "hot",
        "grade": "A",
        "headline": "Enterprise IT buyer — demo booked",
        "summary": "Jane Doe at TCS requested a CRM demo for 50 reps…",
        "signature": "sha256:abc123…",
        "model": "gpt-4.1-mini",
        "attempts": "1",
        "max_attempts": "5",
        "decision": "nurture_now",
        "sensitivity": "safe",
        "category": "demo_request",
        "ladder": "lead_status",
        "from_stage": "new",
        "to_stage": "qualified",
        "trigger_reason": "inbound_email",
        "rationale": "Strong ICP fit + explicit demo ask",
        "next_best_action": "Schedule discovery call",
        "recommended_action": "Send tailored case study",
        "company_name": "TCS",
        "company_size": "10000+",
        "revenue_band": "$1B+",
        "geography": "India",
        "email_domain_type": "corporate",
        "enrichment_source": "llm",
        "company_description": "Global IT services and consulting.",
        "products": "CRM, ERP integration services",
        "arr": "102000.00",
        "payment_terms": "Net 30",
        "billing_address": "Nariman Point, Mumbai 400021",
        "lead_email": "jane.doe@tcs.com",
        "lead_phone": "+91-9876543210",
        "tax_id": "27AAACR5055K1Z5",
        "tax_percent": "18.00",
        "approval_status": "approved",
        "approval_note": "Standard enterprise discount applied",
        "escalation_severity": "medium",
        "escalation_reason": "Invoice 45 days overdue",
        "expansion_signal": "expand",
        "hash_prefix": "sha256:$2a$10$…",
        "scopes": "{contacts, deals, appointments}",
        "key_prefix": "wt_live_abc",
        "notification_type": "appointment.scheduled",
        "href": "/contacts/9?tab=timeline",
        "read_at": "null",
        "dismissed_at": "null",
        "request_type": "export",
        "confirmation_token": "tok_clx7confirm001",
        "slot_key": "coworker:deal:clx7deal0001",
        "content": "User prefers email over calls",
        "importance": "0.7",
        "expires_at": S["ts"],
        "generated_at": S["ts"],
        "created_at": S["ts"],
        "updated_at": S["ts"],
        "completed_at": "null",
        "canceled_at": "null",
        "closed_at": "null",
        "due_at": "2026-08-28T09:00:00.000Z",
        "expected_close_date": "2026-09-30T00:00:00.000Z",
        "valid_until": "2026-09-15T00:00:00.000Z",
        "sent_at": S["ts"],
        "accepted_at": "null",
        "shared_at": "null",
        "paid_at": "null",
        "issue_date": "2026-08-01T00:00:00.000Z",
        "token_expires_at": S["ts_end"],
        "expiration": "2026-09-01T00:00:00.000Z",
        "sla_deadline": "2026-08-26T18:00:00.000Z",
        "assigned_at": S["ts"],
        "nurture_started_at": "null",
        "nurture_last_touch_at": "null",
        "nurture_sequence_step": "null",
        "nurture_status_col": "null",
        "lifecycle_last_run_at": S["ts"],
        "forecast_last_run_at": "null",
        "expansion_last_run_at": "null",
        "escalation_last_run_at": "null",
        "transcript_analyzed_at": "null",
        "reminder_24h_sent_at": "null",
        "reminder_1h_sent_at": "null",
        "miss_escalated_at": "null",
        "mom_sent_at": "null",
        "reminder_sent_at": "null",
        "analyzed_at": S["ts"],
        "started_at": S["ts"],
        "ended_at": "null",
        "last_assist_at": "null",
        "last_applied_at": S["ts"],
        "last_sent_at": "null",
        "enrichment_timestamp": S["ts"],
        "marketing_opt_out_at": "null",
        "approved_at": S["ts"],
        "renewal_reminded_at": "null",
        "confirmed_at": S["ts"],
        "next_retry_at": "null",
        "last_error": "null",
        "body": "<p>Thanks for your interest in Worktual CRM…</p>",
        "transcript_text": "Rep: Welcome… Jane: We need pipeline visibility…",
        "transcript_source": "google_meet",
        "gmail_message_id": "18c4f2a1b3d5e6f7",
        "gmail_thread_id": "18c4f2a1b3d5e6f7",
        "provider_message_id": "AAMkAGI2…",
        "provider_thread_id": "AAQkAGI2…",
        "rfc_message_id": "<CA+xyz@mail.gmail.com>",
        "external_meeting_id": "87654321098",
        "task_status": "open",
        "invoice_line_kind": "product",
        "description": "Annual CRM seat license",
        "unit_label": "seats",
        "customer_name": "TCS",
        "company_name_doc": "TCS",
        "vendor_name": "Worktual B2B Demo",
        "summary_prop": "Replace legacy CRM for 50 reps in India.",
        "lost_reason": "null",
        "forecast_category": "commit",
        "forecast_confidence_percent": "75",
        "forecast_reason": "null",
        "flag_reason": "null",
        "lifecycle_last_action": "qualify",
        "lifecycle_last_reason": "Demo completed with budget confirmed",
        "nurture_status": "active",
        "current_sequence_step": "2",
        "sequence_started_at": S["ts"],
        "error_reason": "null",
        "speaker_email": "jane.doe@tcs.com",
        "bant_timeline_text": "Q4 2026",
        "next_step_agreed": "Send formal quote by Friday",
        "insight_type": "talk_ratio",
        "severity": "info",
        "insight_text": "Rep spoke 62% — aim for 40% on discovery calls",
        "metric_value": "0.62",
        "benchmark_value": "0.40",
        "related_activity_id": S["activity_id"],
        "related_deal_id": S["deal_id"],
        "privacy_status": "pending",
        "subject_email": "jane.doe@tcs.com",
        "payload_domain": '{"industry":"IT services","employees":620000}',
        "result_summary": '{"band":"hot","score":72}',
        "factors": '{"fit":68,"intent":76,"signals":["demo_booked"]}',
        "flags": '{"missing_budget":false}',
        "conflict_flags": '{"company_size":"user_entered_500_vs_enriched_620000"}',
        "transcript_insights": '{"intent":"evaluation","objections":["integration"]}',
        "objections_raised": '["Need Salesforce migration path"]',
        "evidence": '[{"quote":"We need pipeline visibility","ts":"00:04:12"}]',
        "last_suggestions": '{"prompts":["Ask about current CRM pain"]}',
        "meta": '{"previous_stage":"qualification","new_stage":"discover"}',
        "detail": '{"contact_id":"9","score":72}',
        "tax_details": '{"gst":18,"components":[{"name":"IGST","rate":18}]}',
        "custom_attributes": '{"employee_band":"enterprise","region":"APAC"}',
        "vertical_config": "{}",
        "lead_icp": '{"targetIndustries":["IT services"],"sizeTiers":["enterprise"],"serviceableGeos":["IN","US"]}',
        "sections": '[{"id":"s1","key":"intro","title":"Introduction","body":"…","sortOrder":0}]',
        "blueprint": '{"version":1,"html":"<div>…</div>","css":"","theme":"default","slots":{}}',
        "assets": '[{"id":"logo1","kind":"image","mime":"image/png","dataBase64":"…"}]',
        "document_sections": '[{"id":"s1","title":"Scope","body":"50 seats"}]',
        "payload_report": '{"open_pipeline":1250000,"won_mtd":320000}',
        "access_token": "[redacted OAuth token]",
        "refresh_token": "[redacted OAuth refresh]",
        "scope": "https://www.googleapis.com/auth/gmail.readonly …",
        "hash": "sha256:$2a$10$N9qo8uLOickgx2ZMRZoMye…",
        "key_hash": "a3f5c9e2b1d8476f0e8c2a4b6d9e1f3c5a7b9d2e4f6a8c0b2d4e6f8a0c2e4",
        "name_api_key": "CCaaS production",
        "slot_value": '{"preferred_channel":"email","notes":"Decision by Q4"}',
    }

    # Contextual text fields (check before generic override map)
    if c == "title":
        if "Meeting title" in desc:
            return "Worktual CRM demo — TCS"
    if c == "name":
        if "Admin-visible key label" in desc:
            return "CCaaS production"

    if c in overrides:
        return overrides[c]

    if c == "title":
        if "Opportunity name" in desc or "Display title" in desc:
            return "CRM expansion — TCS Mumbai"
    if c == "name":
        if "Display name" in desc and "Account" in desc:
            return "TCS"
        if "Display name" in desc:
            return "Enterprise CRM — 50 seats"
    if c == "key_hash":
        return "a3f5c9e2b1d8476f0e8c2a4b6d9e1f3c5a7b9d2e4f6a8c0b2d4e6f8a0c2e4"

    # Secrets
    if "token" in c and c not in ("confirmation_token",):
        return "[redacted]"
    if c == "hash":
        return overrides.get("hash", "[redacted bcrypt hash]")

    # Enums from description backticks
    enum_match = re.search(r"`([a-z_]+)`", desc)
    if "enum" in desc.lower() or re.search(r"\b[a-z]+ / [a-z]+", desc):
        if enum_match:
            return enum_match.group(1)
    if "/" in desc and re.search(r"\b\w+ / \w+", desc):
        part = re.split(r"[/,]", desc)[0]
        m = re.search(r"(\w+)\s*$", part.strip())
        if m and m.group(1).islower():
            return m.group(1)

    # Types
    if "boolean" in t:
        if "false" in default.lower() or "false" in desc.lower():
            return "false"
        return "true"
    if "integer" in t or t == "float8":
        if "0–1" in desc or "0-1" in desc:
            return "0.85"
        if "percent" in c or "confidence" in c:
            return "75"
        if "attempts" in c:
            return "0"
        if "max_attempts" in c:
            return default.strip("`") if default.strip() not in ("—", "-", "") else "5"
        return "1"
    if "numeric" in t:
        return "1500.00"
    if "text[]" in t:
        return "{tag1, tag2}"
    if "jsonb" in t or "json" in t:
        if nullable and "required" not in null:
            return "{}"
        return '{"example": true}'
    if "varchar" in t or t == "text":
        if "email" in c:
            return "jane.doe@tcs.com"
        if "phone" in c:
            return "+91-9876543210"
        if "url" in c:
            return "https://example.com/resource"
        if "reason" in c or "error" in c:
            return "null" if nullable else "Example reason text"
        if "status" in c:
            return "active"
        if nullable:
            return "null"
        return "example text"
    if "timestamp" in t or "timestamptz" in t:
        return "null" if nullable and "required" not in null else S["ts"]
    if "date" in t:
        return "null" if nullable else S["date"]
    if t == "bigint":
        return S["org_id"] if "organization" in c else S["user_id"]

    if nullable:
        return "null"
    return "—"


def parse_row(line: str) -> list[str] | None:
    if not line.startswith("| `"):
        return None
    parts = [p.strip() for p in line.strip().strip("|").split("|")]
    if len(parts) < 5 or not parts[0].startswith("`"):
        return None
    return parts


def format_row(parts: list[str]) -> str:
    return "| " + " | ".join(parts) + " |"


def transform_crm_section(text: str) -> str:
    lines = text.splitlines()
    out: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("| Column | Type | Null | Default | Description |"):
            out.append("| Column | Type | Null | Default | Description | Sample |")
            out.append("|---|---|---|---|---|---|")
            i += 2 if i + 1 < len(lines) and lines[i + 1].startswith("|---") else 1
            continue
        parts = parse_row(line)
        if parts and len(parts) >= 5:
            col = parts[0].strip("`")
            typ = parts[1].strip("`")
            null = parts[2]
            default = parts[3]
            desc = parts[4]
            sample = sample_for(col, typ, null, default, desc)
            out.append(
                format_row(
                    [
                        f"`{col}`",
                        f"`{typ}`",
                        null,
                        default,
                        desc,
                        f"`{sample}`",
                    ]
                )
            )
            i += 1
            continue
        out.append(line)
        i += 1
    return "\n".join(out)


def main() -> None:
    content = DOC.read_text(encoding="utf-8")
    marker = "## `crm` schema"
    enum_marker = "## CRM enums"
    start = content.index(marker)
    end = content.index(enum_marker)
    before = content[:start]
    crm = content[start:end]
    after = content[end:]

    if "| Sample |" in crm:
        pass  # idempotent: rewrite samples from column metadata

    crm_new = transform_crm_section(crm)
    DOC.write_text(before + crm_new + after, encoding="utf-8")
    print(f"Updated {DOC} with Sample columns in CRM section")


if __name__ == "__main__":
    main()
