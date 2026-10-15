"""Campaign NL + certified KPI coverage vs live Postgres.

Identity: org 1012, branch 1004, admin user 1054.
Same pack path as `streamlit run test_streamlit/campaign/app.py`.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path("/home/vectone/Uday/report module")
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "test_streamlit/campaign"))
os.chdir(ROOT)

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from reports_analytics_agent_campaign_v2.core.loader import merge_effective
from reports_analytics_agent_campaign_v2.core.sql.run_kpi import run_kpi
from reports_analytics_agent_campaign_v2.core.sql.run_sql import run_sql
from reports_analytics_agent_campaign_v2.core.time import resolve_expression
from test_streamlit.campaign.turn import DSN, run_turn

ORG, USER, BRANCH, ROLE = 1012, 1054, 1004, "admin"
OUT = ROOT / "test_streamlit/campaign/logs"
OUT.mkdir(parents=True, exist_ok=True)

WINDOWS = [
    ("last 1 day", "1d"),
    ("last 7 days", "7d"),
    ("last 30 days", "30d"),
]

# Prefer one categorical dim per grain for NL; skip calendar dims (covered in matrix).
NL_DIM_PREF = ["status", "channel", "outcome", "ab_variant", "city", "reason", "event_status"]

KPI_NL = {
    "campaigns_ran": "How many campaigns ran",
    "campaigns_sent": "How many campaigns were sent",
    "campaigns_failed": "How many campaigns failed",
    "email_open_rate": "What is the unique email open rate",
    "click_rate": "What is the unique click rate",
    "delivered_by_channel": "Delivered messages by channel",
    "delivery_trend": "Delivery trend by day",
    "monitor_preview": "Show campaign monitor preview",
    "audience_selected": "How many people were selected in audience",
    "messages_sent": "How many messages were sent",
    "messages_failed": "How many messages failed",
    "messages_bounced": "How many messages bounced",
    "messages_delivered": "How many messages were delivered",
    "unique_opens": "How many unique opens",
    "unique_clicks": "How many unique clicks",
    "total_opens": "What is total opens",
    "total_clicks": "What is total clicks",
    "ctor": "What is the click to open rate",
    "ab_variant_performance": "Email A/B variant performance",
    "audience_missed": "How many audience contacts were missed",
    "event_opens": "How many event form opens",
    "event_submissions": "How many event form submissions",
    "event_conversion": "What is event conversion",
    "ppc_impressions": "PPC impressions",
    "ppc_clicks": "PPC clicks",
    "ppc_spend": "PPC spend",
    "ppc_conversions": "PPC conversions",
    "ppc_ctr": "PPC CTR",
    "ppc_cpc": "PPC CPC",
    "ppc_cpa": "PPC CPA",
    "cdp_contact_count": "How many CDP contacts are there",
    "cdp_contacts_blocked": "How many CDP contacts are blocked",
    "contact_unsubscribed": "How many contacts unsubscribed",
    "contact_lifetime_opens": "Contact lifetime opens",
    "contact_lifetime_clicks": "Contact lifetime clicks",
    "contact_delivery_rates": "Per contact delivery and open rates",
    "contact_campaigns_received": "How many campaigns each contact received",
    "contacts_engaged": "How many contacts engaged",
    "contacts_never_opened": "Who never opened",
    "contact_push_reachability": "Contact push reachability",
    "website_visitor_count": "How many website visitors",
    "web_push_subscribers": "How many web push subscribers",
    "identity_keys_count": "How many identity keys",
    "stub_sends": "How many stub sends",
    "bounce_rate": "What is the bounce rate",
    "suppressions": "How many email suppressions",
    "unsubscribes": "How many unsubscribes",
    "email_cap_health": "Email sending cap health",
    "domain_auth": "Domain authentication status",
    "channel_readiness": "Channel configuration readiness",
    "mailbox_send_ready": "Is mailbox send ready",
    "regulated_template_status": "Regulated template approval status",
    "push_endpoint_inventory": "Push endpoint inventory",
    "gallery_ops": "Gallery job health",
    "library_ops": "Library template reuse counts",
    "daily_report_email_log": "Daily report email log",
    "notifications_unread": "How many unread notifications",
    "pending_recipients": "How many pending recipients",
    "live_send_pressure": "Live send pressure",
    "entitlement_health": "Campaign entitlement health",
}


def _rows(res: dict) -> list:
    return list(res.get("rows") or [])


def _ok(res: dict) -> bool:
    return res.get("status") in {"ok", "success"}


def independent_t1(dsn: str) -> list[str]:
    """Hand SQL from the metrics doc vs run_kpi for 7d window."""
    from reports_analytics_agent_campaign_v2.core import db as pg

    bounds = resolve_expression("last 7 days")
    start = bounds.start.date().isoformat()
    end = bounds.end.date().isoformat()
    lines = [f"Independent T1 checks last 7 days UTC [{start}, {end})"]
    checks = [
        (
            "campaigns_ran",
            f"""
            SELECT COUNT(*)::bigint AS n
            FROM campaign.campaigns campaigns
            WHERE organization_id = {ORG} AND branch_id = {BRANCH}
              AND status IN ('live','completed','cancelled')
              AND launch_local_date IS NOT NULL
              AND launch_local_date >= '{start}' AND launch_local_date < '{end}'
              AND EXISTS (
                SELECT 1 FROM campaign.campaign_channels ch
                WHERE ch.campaign_id = campaigns.id AND ch.organization_id = {ORG}
                  AND ch.channel <> 'ppc'
              )
            """,
        ),
        (
            "inventory_all_saved",
            f"""
            SELECT COUNT(*)::bigint AS n
            FROM campaign.campaigns
            WHERE organization_id = {ORG} AND branch_id = {BRANCH}
            """,
        ),
        (
            "messages_delivered",
            f"""
            SELECT COUNT(*)::bigint AS n
            FROM campaign.campaign_send_recipients r
            JOIN campaign.campaign_send_batches b ON b.id = r.batch_id
            JOIN campaign.campaigns campaigns ON campaigns.id = r.campaign_id
            WHERE r.organization_id = {ORG} AND campaigns.branch_id = {BRANCH}
              AND campaigns.launch_local_date IS NOT NULL
              AND campaigns.launch_local_date >= '{start}' AND campaigns.launch_local_date < '{end}'
              AND (
                CASE
                  WHEN lower(coalesce(r.status,'')) IN ('failed','cancelled') THEN 'failed'
                  WHEN lower(coalesce(r.status,'')) = 'skipped' THEN 'skipped'
                  WHEN lower(coalesce(r.status,'')) IN ('stub','stub_sent') THEN 'stub'
                  WHEN lower(coalesce(r.provider_message_id,'')) LIKE 'stub-%'
                    OR lower(coalesce(r.provider_message_id,'')) LIKE 'stub://%' THEN 'stub'
                  WHEN lower(coalesce(r.status,'')) IN ('bounced','hard_bounce','soft_bounce') THEN 'bounce'
                  WHEN lower(coalesce(r.skip_fail_reason,'')) LIKE '%bounce%' THEN 'bounce'
                  WHEN lower(coalesce(r.status,'')) IN ('sent','delivered') THEN 'sent'
                  ELSE 'pending'
                END
              ) = 'sent'
            """,
        ),
    ]
    for name, sql in checks:
        try:
            hand = pg.fetchall(dsn, sql)
        except Exception as exc:
            lines.append(f"- FAIL `{name}` hand SQL error: {exc}")
            continue
        hand_n = hand[0].get("n") if hand else None
        if name == "inventory_all_saved":
            lines.append(f"- INFO `{name}` postgres={hand_n} (no certified KPI; not campaigns_ran)")
            continue
        packed = run_kpi(
            name,
            organization_id=ORG,
            user_id=USER,
            branch_id=BRANCH,
            role=ROLE,
            scope_level="org",
            time_window="last 7 days",
            dsn=dsn,
        )
        pack_n = None
        if _ok(packed) and _rows(packed):
            row = _rows(packed)[0]
            pack_n = next(iter(row.values()))
        match = pack_n == hand_n
        lines.append(
            f"- {'MATCH' if match else 'MISMATCH'} `{name}` run_kpi={pack_n} postgres={hand_n} "
            f"status={packed.get('status')} err={packed.get('error') or packed.get('error_type') or ''}"
        )
    return lines


def conv(q: str) -> dict:
    try:
        out = run_turn(
            question=q,
            organization_id=ORG,
            user_id=USER,
            branch_id=BRANCH,
            role=ROLE,
        )
    except Exception as exc:
        return {
            "question": q,
            "status": "error",
            "kpi": None,
            "dims": None,
            "n": 0,
            "err": "EXC",
            "error": str(exc)[:400],
            "answer": "",
            "facts": "",
            "plan": [],
            "task_results": [],
        }
    trace = out.get("trace") or {}
    plan = (trace.get("plan") or {}).get("tasks") or []
    tasks = trace.get("task_results") or []
    t0 = tasks[0] if tasks else {}
    task0 = plan[0] if plan and isinstance(plan[0], dict) else {}
    return {
        "question": q,
        "status": t0.get("status"),
        "kpi": t0.get("kpi_id") or task0.get("kpi"),
        "dims": task0.get("dimensions") or ([task0.get("dimension")] if task0.get("dimension") else None),
        "n": t0.get("row_count") or 0,
        "err": t0.get("error_type"),
        "error": (t0.get("error") or "")[:400],
        "answer": (out.get("answer") or "")[:400],
        "facts": (out.get("facts") or "")[:500],
        "plan": [
            {k: x.get(k) for k in ("kpi", "dimension", "dimensions", "time", "scope", "goal")}
            for x in plan
            if isinstance(x, dict)
        ],
        "task_results": tasks,
        "grounded": trace.get("grounded"),
        "retrieved": trace.get("retrieved_kpis"),
        "log_path": out.get("log_path"),
    }


def main() -> None:
    if not DSN:
        raise SystemExit("DATABASE_URL missing")
    catalog = merge_effective(ORG)
    kpis = catalog.get("kpis") or {}
    recs: list[dict] = []
    rows: list[str] = [
        "# Campaign NL + KPI coverage",
        f"Generated: {datetime.now(timezone.utc).isoformat()}",
        f"Identity: org `{ORG}`, branch `{BRANCH}`, user `{USER}`, role `{ROLE}` (admin)",
        "Path: `test_streamlit/campaign` → `reports_analytics_agent_campaign_v2`",
        "",
    ]

    rows.append("## 1. Certified `run_kpi` vs Postgres (all KPIs × dimensions × 1/7/30d)")
    fail_m = 0
    total_m = 0
    for kpi_id, meta in kpis.items():
        dims = [None] + list(meta.get("allowed_dimensions") or [])
        for dim in dims:
            for window, wlabel in WINDOWS:
                total_m += 1
                res = run_kpi(
                    kpi_id,
                    organization_id=ORG,
                    user_id=USER,
                    branch_id=BRANCH,
                    role=ROLE,
                    scope_level="org",
                    time_window=window,
                    dimensions=[dim] if dim else None,
                    dsn=DSN,
                )
                ok = _ok(res)
                if not ok:
                    fail_m += 1
                mark = "OK" if ok else "FAIL"
                n = len(_rows(res))
                sample = _rows(res)[:2]
                err = (res.get("error") or "")[:160]
                rows.append(
                    f"- {mark} `{kpi_id}` dim=`{dim or '-'}` win=`{wlabel}` "
                    f"status={res.get('status')} rows={n} err={res.get('error_type') or ''} {err}"
                )
                recs.append(
                    {
                        "kind": "run_kpi",
                        "kpi": kpi_id,
                        "dim": dim,
                        "window": window,
                        "status": res.get("status"),
                        "error": res.get("error"),
                        "error_type": res.get("error_type"),
                        "n": n,
                        "sample": sample,
                    }
                )
                print(mark, kpi_id, dim, wlabel, res.get("status"), n, flush=True)
    rows.append(f"**matrix_fails={fail_m}/{total_m}**")
    rows.append("")
    report_path = OUT / "nl_coverage_report.md"
    report_path.write_text("\n".join(rows) + "\n")

    rows.append("## 2. Independent Postgres logic vs `run_kpi`")
    rows.extend(independent_t1(DSN))
    rows.append("")
    report_path.write_text("\n".join(rows) + "\n")
    print("section2_done", flush=True)

    rows.append("## 3. Natural language via Streamlit pack turn")
    rows.append("Each certified KPI is asked for last 1 / 7 / 30 days. One preferred dimension is asked on the 7-day window when allowed.")
    rows.append("")
    kpi_miss = 0
    nl_fail = 0
    nl_n = 0
    for kpi_id, stem in KPI_NL.items():
        if kpi_id not in kpis:
            rows.append(f"- SKIP `{kpi_id}` not in catalog")
            continue
        meta = kpis[kpi_id]
        allowed = [str(d) for d in (meta.get("allowed_dimensions") or [])]
        pref = next((d for d in NL_DIM_PREF if d in allowed), None)
        for window, wlabel in WINDOWS:
            q = f"{stem} in the {window}?"
            nl_n += 1
            r = conv(q)
            recs.append({"kind": "nl", "expect": kpi_id, "window": window, "dim": None, **r})
            hit = r["kpi"] == kpi_id
            if not hit:
                kpi_miss += 1
            if r["status"] not in {"ok", "success"}:
                nl_fail += 1
            mark = "HIT" if hit and r["status"] in {"ok", "success"} else (
                "OK_OTHER" if r["status"] in {"ok", "success"} else "FAIL"
            )
            rows.append(
                f"- {mark} expect=`{kpi_id}` got=`{r['kpi']}` win=`{wlabel}` n={r['n']} "
                f"err={r['err']} dims={r['dims']} | {q}"
            )
            rows.append(f"  - ans={(r['answer'] or '').replace(chr(10), ' ')[:240]}")
            print("nl", mark, kpi_id, r["kpi"], wlabel, r["status"], flush=True)
            report_path.write_text("\n".join(rows) + "\n")
        if pref:
            q = f"{stem} in the last 7 days by {pref}"
            nl_n += 1
            r = conv(q)
            recs.append({"kind": "nl_dim", "expect": kpi_id, "window": "last 7 days", "dim": pref, **r})
            got_dims = [str(x).lower() for x in (r.get("dims") or []) if x]
            dim_hit = pref in got_dims or (r.get("n") or 0) > 1
            if r["status"] not in {"ok", "success"}:
                nl_fail += 1
                mark = "FAIL"
            elif r["kpi"] == kpi_id and pref in got_dims:
                mark = "CERT_DIM"
            elif dim_hit:
                mark = "GROUPED"
            else:
                mark = "NO_DIM"
            rows.append(
                f"- {mark} `{kpi_id}` want_dim=`{pref}` got_kpi=`{r['kpi']}` got_dims=`{got_dims}` "
                f"n={r['n']} err={r['err']} | {q}"
            )
            rows.append(f"  - ans={(r['answer'] or '').replace(chr(10), ' ')[:240]}")
            print("nl_dim", mark, kpi_id, pref, r["kpi"], flush=True)
            report_path.write_text("\n".join(rows) + "\n")

    # Inventory NL (not campaigns_ran)
    q = "How many campaigns are there?"
    r = conv(q)
    recs.append({"kind": "nl_inventory", "expect": None, **r})
    rows.append(f"- INV got_kpi=`{r['kpi']}` n={r['n']} err={r['err']} | {q}")
    rows.append(f"  - ans={(r['answer'] or '').replace(chr(10), ' ')[:240]}")
    rows.append(f"  - facts={(r.get('facts') or '').replace(chr(10), ' ')[:240]}")
    rows.append("")
    rows.append(f"**nl_kpi_id_misses={kpi_miss}  nl_exec_fails={nl_fail}  nl_questions≈{nl_n}**")
    rows.append("")

    (OUT / "nl_coverage.json").write_text(json.dumps(recs, default=str, indent=2))
    report_path.write_text("\n".join(rows) + "\n")
    print("done", "matrix_fail", fail_m, "nl_miss", kpi_miss, "nl_fail", nl_fail, flush=True)


if __name__ == "__main__":
    main()
