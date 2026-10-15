#!/usr/bin/env python3
"""Validate all 58 CCaaS metrics: API vs Postgres source tables (ccass.* / accounts.*).

Ground truth never uses marts or staging views.
"""

from __future__ import annotations

import json
import math
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

API_BASE = os.environ.get("API_BASE", "http://127.0.0.1:8765").rstrip("/")
ORG = int(os.environ.get("ORG", "1000"))
USER_ID = int(os.environ.get("USER_ID", "1001"))
AGENT = os.environ.get("AGENT", "cc.reporting")
DRIFT = float(os.environ.get("DRIFT_TOLERANCE", "0.0001"))
LATENCY_BUDGET = float(os.environ.get("LATENCY_BUDGET", "3.5"))
OUTPUT = ROOT / "scripts" / "ccaas_core_metrics_report.json"

SRC = os.environ.get("CCAAS_SOURCE_SCHEMA", "ccass")
ACC = os.environ.get("ACCOUNTS_SOURCE_SCHEMA", "accounts")
MART_SCHEMA = os.environ.get("CCAAS_MARTS_SCHEMA", "ccass_marts_aiccaas")

CH = """CASE
  WHEN lower(coalesce(channel, '')) IN ('web_chat', 'webchat') THEN 'webchat'
  WHEN lower(coalesce(channel, '')) IN ('voice', 'call') THEN 'voice'
  ELSE lower(channel)
END"""

_SCOPE_COL = {
    "conversations": "assigned_agent_id",
    "assignments": "agent_id",
    "tasks": "assigned_user_id",
}


def _visible_user_ids() -> list[str]:
    from semantic.scope import lookup_user_scope

    scope = lookup_user_scope(ORG, USER_ID, product="contact_centre")
    return [str(x) for x in (scope.visible_user_ids or [USER_ID])]


def _scope_suffix(metric_id: str, grain: str) -> tuple[str, list[Any], str]:
    from semantic.sql.agent_policy import metric_scope_mode

    mode = metric_scope_mode(metric_id, "contact_centre")
    if mode == "org":
        return "", [], "org"
    col = _SCOPE_COL[grain]
    ids = _visible_user_ids()
    placeholders = ", ".join(["%s"] * len(ids))
    return f" AND {col}::text IN ({placeholders})", ids, "assignee_or_team"


def _load_dotenv() -> None:
    env_path = ROOT / ".env"
    if not env_path.is_file():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip().strip("'\""))


@dataclass
class Row:
    metric: str
    scope: str
    api_status: int
    api_value: float | None
    source_value: float | None
    mart_value: float | None
    delta: float | None
    match: bool
    source_path: str = ""
    latency_s: float | None = None
    note: str = ""


def _pg_conn():
    import psycopg2

    _load_dotenv()
    return psycopg2.connect(
        host=os.environ["pg_host"],
        port=int(os.environ.get("pg_port", "5432")),
        user=os.environ.get("pg_user", "postgres"),
        password=os.environ.get("pg_pass", ""),
        dbname=os.environ.get("pg_db", "postgres"),
        connect_timeout=15,
    )


def _scalar(cur, sql: str, params: list[Any]) -> float | None:
    cur.execute(sql, params)
    row = cur.fetchone()
    if row is None or row[0] is None:
        return None
    return float(row[0])


def _ratio(
    cur,
    num_sql: str,
    den_sql: str,
    num_params: list[Any],
    den_params: list[Any] | None = None,
) -> float | None:
    den_params = den_params if den_params is not None else num_params
    num = _scalar(cur, num_sql, num_params)
    den = _scalar(cur, den_sql, den_params)
    if num is None or den is None or den == 0:
        return None
    return num / den


def _entitled_voice_channels() -> list[str]:
    from semantic.entitlements import load_tenant_entitlements

    raw = load_tenant_entitlements(ORG).channels_for_product("contact_centre") or []
    out: list[str] = []
    for ch in raw:
        low = str(ch).lower()
        out.append(low)
        if low == "call":
            out.append("voice")
        elif low == "voice":
            out.append("call")
    return sorted(set(out))


def _task_channel_filter() -> tuple[str, list[str]]:
    channels = _entitled_voice_channels()
    if not channels:
        return "", []
    placeholders = ", ".join(["%s"] * len(channels))
    return f" AND lower(channel) IN ({placeholders})", channels


def _channel_conv_join_filter(alias: str = "c") -> tuple[str, list[str]]:
    """Match API channel entitlement on conversation grain (staging uses voice not call)."""
    channels = _entitled_voice_channels()
    if not channels:
        return "", []
    placeholders = ", ".join(["%s"] * len(channels))
    return f" AND ({CH.replace('channel', f'{alias}.channel')}) IN ({placeholders})", channels


def api_query(metric_id: str) -> tuple[int, float | None, str, float, str, str]:
    body = {
        "organizationId": ORG,
        "userId": USER_ID,
        "product": "contact_centre",
        "agent": AGENT,
        "metrics": [metric_id],
    }
    req = urllib.request.Request(
        f"{API_BASE}/v1/semantic/query",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.loads(resp.read())
            rows = data.get("rows") or []
            val = rows[0].get(metric_id) if rows else None
            if val is not None:
                val = float(val)
            timing = data.get("_timing") or {}
            return (
                resp.status,
                val,
                "",
                time.perf_counter() - t0,
                str(timing.get("source") or data.get("source") or ""),
                str(timing.get("path") or data.get("path") or ""),
            )
    except urllib.error.HTTPError as exc:
        try:
            detail = json.loads(exc.read())
        except json.JSONDecodeError:
            detail = {"detail": exc.read().decode(errors="replace")}
        return exc.code, None, str(detail.get("detail", detail)), time.perf_counter() - t0, "", ""
    except Exception as exc:
        return 0, None, str(exc), time.perf_counter() - t0, "", ""


def ground_truth(cur, metric_id: str) -> tuple[float | None, str, str]:
    """Return (value, scope, sql_kind) from raw source tables."""
    org = [ORG]
    conv_scope, conv_ids, conv_scope_name = _scope_suffix(metric_id, "conversations")
    asg_scope, asg_ids, asg_scope_name = _scope_suffix(metric_id, "assignments")
    task_scope, task_ids, task_scope_name = _scope_suffix(metric_id, "tasks")
    c = f"{SRC}.conversations"
    a = f"{SRC}.conversation_assignments"
    s = f"{SRC}.conversation_sla_state"
    d = f"{SRC}.conversation_dispositions"
    t = f"{SRC}.conversation_transfers"
    tasks = f"{SRC}.agent_tasks"
    pres = f"{SRC}.agent_presence_history"
    cap = f"{SRC}.agent_capacity"
    cop = f"{SRC}.copilot_turns"
    tool = f"{SRC}.copilot_skill_executions"
    agt = f"{SRC}.agents"
    q = f"{ACC}.setup_ccaas_queues"
    qa = f"{ACC}.setup_ccaas_queue_agents"
    teams = f"{ACC}.setup_teams"

    ow = "organization_id = %s"

    ch_sql, ch_params = _channel_conv_join_filter("c")

    if metric_id == "total_conversations":
        sql = f"SELECT COUNT(*) FROM {c} c WHERE c.organization_id = %s{conv_scope}{ch_sql}"
        return _scalar(cur, sql, org + conv_ids + ch_params), conv_scope_name, "count"

    if metric_id == "open_conversations":
        sql = f"""SELECT COUNT(*) FROM {c} c
                  WHERE c.organization_id = %s AND c.status NOT IN ('resolved', 'closed'){conv_scope}{ch_sql}"""
        return _scalar(cur, sql, org + conv_ids + ch_params), conv_scope_name, "count"

    if metric_id == "handled_volume":
        sql = f"""SELECT COUNT(*) FROM {c} c
                  WHERE c.organization_id = %s AND (
                    c.assigned_agent_id IS NOT NULL
                    OR c.status IN ('resolved', 'closed')
                    OR c.closed_at IS NOT NULL
                  ){conv_scope}{ch_sql}"""
        return _scalar(cur, sql, org + conv_ids + ch_params), conv_scope_name, "count"

    if metric_id == "resolved_conversations_count":
        sql = f"""SELECT COUNT(*) FROM {c} c
                  WHERE c.organization_id = %s AND (
                    c.status = 'resolved' OR c.resolution_code IS NOT NULL OR c.resolved_at IS NOT NULL
                  ){conv_scope}{ch_sql}"""
        return _scalar(cur, sql, org + conv_ids + ch_params), conv_scope_name, "count"

    if metric_id == "unique_contacts_handled":
        sql = f"""SELECT COUNT(DISTINCT contact_id) FROM {c}
                  WHERE {ow} AND contact_id IS NOT NULL AND (
                    assigned_agent_id IS NOT NULL
                    OR status IN ('resolved', 'closed')
                    OR closed_at IS NOT NULL
                  ){conv_scope}"""
        return _scalar(cur, sql, org + conv_ids), conv_scope_name, "count_distinct"

    if metric_id == "handoff_conversations":
        sql = f"SELECT COUNT(*) FROM {c} WHERE {ow} AND handoff_reason IS NOT NULL{conv_scope}"
        return _scalar(cur, sql, org + conv_ids), conv_scope_name, "count"

    if metric_id == "ai_only_completed_conversations":
        sql = f"""SELECT COUNT(*) FROM {c}
                  WHERE {ow}
                    AND handoff_reason IS NULL
                    AND assigned_agent_id IS NULL
                    AND (status IN ('resolved', 'closed') OR closed_at IS NOT NULL){conv_scope}"""
        return _scalar(cur, sql, org + conv_ids), conv_scope_name, "count"

    if metric_id == "ai_containment_rate":
        return _ratio(
            cur,
            f"""SELECT COUNT(*) FROM {c}
                WHERE {ow}
                  AND handoff_reason IS NULL
                  AND assigned_agent_id IS NULL
                  AND (status IN ('resolved', 'closed') OR closed_at IS NOT NULL)""",
            f"SELECT COUNT(*) FROM {c} WHERE {ow}",
            org,
        ), "org", "ratio"

    if metric_id == "ai_handover_rate":
        ch_sql, ch_params = _channel_conv_join_filter("c")
        return _ratio(
            cur,
            f"SELECT COUNT(*) FROM {c} c WHERE c.organization_id = %s AND c.handoff_reason IS NOT NULL{conv_scope}{ch_sql}",
            f"SELECT COUNT(*) FROM {c} c WHERE c.organization_id = %s{conv_scope}{ch_sql}",
            org + conv_ids + ch_params,
        ), conv_scope_name, "ratio"

    if metric_id == "handover_rate":
        return _ratio(
            cur,
            f"SELECT COUNT(*) FROM {t} WHERE {ow}",
            f"SELECT COUNT(*) FROM {c} WHERE {ow}{conv_scope}",
            org,
            org + conv_ids,
        ), conv_scope_name, "ratio"

    if metric_id == "resolution_rate":
        ch_sql, ch_params = _channel_conv_join_filter("c")
        return _ratio(
            cur,
            f"""SELECT COUNT(*) FROM {c} c
                WHERE c.organization_id = %s AND (
                  c.status = 'resolved' OR c.resolution_code IS NOT NULL OR c.resolved_at IS NOT NULL
                ){conv_scope}{ch_sql}""",
            f"SELECT COUNT(*) FROM {c} c WHERE c.organization_id = %s{conv_scope}{ch_sql}",
            org + conv_ids + ch_params,
        ), conv_scope_name, "ratio"

    channel_volumes = {
        "webchat_volume": "webchat",
        "call_volume": "voice",
        "email_volume": "email",
        "instagram_volume": "instagram",
        "whatsapp_volume": "whatsapp",
        "facebook_volume": "facebook",
    }
    if metric_id in channel_volumes:
        ch_val = channel_volumes[metric_id]
        sql = f"""SELECT COUNT(*) FROM {c}
                  WHERE {ow} AND ({CH}) = %s{conv_scope}"""
        return _scalar(cur, sql, org + [ch_val] + conv_ids), conv_scope_name, "count"

    if metric_id == "chat_volume":
        sql = f"""SELECT COUNT(*) FROM {c}
                  WHERE {ow} AND ({CH}) != 'voice'{conv_scope}"""
        return _scalar(cur, sql, org + conv_ids), conv_scope_name, "count"

    if metric_id == "social_media_volume":
        sql = f"""SELECT COUNT(*) FROM {c}
                  WHERE {ow} AND ({CH}) IN ('whatsapp', 'instagram', 'facebook'){conv_scope}"""
        return _scalar(cur, sql, org + conv_ids), conv_scope_name, "count"

    if metric_id == "average_first_response_time":
        sql = f"""SELECT AVG(EXTRACT(EPOCH FROM (first_response_at - created_at)))::float
                  FROM {c}
                  WHERE {ow} AND first_response_at IS NOT NULL AND created_at IS NOT NULL"""
        return _scalar(cur, sql, org), "org", "avg"

    if metric_id == "average_speed_of_answer":
        sql = f"""SELECT AVG(EXTRACT(EPOCH FROM (assigned_at - queued_at)))::float
                  FROM {c}
                  WHERE {ow} AND assigned_at IS NOT NULL AND queued_at IS NOT NULL"""
        return _scalar(cur, sql, org), "org", "avg"

    if metric_id == "average_handle_time":
        sql = f"""SELECT SUM(EXTRACT(EPOCH FROM (a.ended_at - a.accepted_at)))
                       / NULLIF(COUNT(*) FILTER (
                           WHERE a.accepted_at IS NOT NULL AND a.ended_at IS NOT NULL
                         ), 0)
                  FROM {a} a
                  JOIN {c} c ON a.conversation_id = c.id AND a.organization_id = c.organization_id
                  WHERE a.organization_id = %s{asg_scope}{ch_sql.replace('c.', 'c.')}"""
        return _scalar(cur, sql, org + asg_ids + ch_params), asg_scope_name, "avg"

    if metric_id == "human_handle_seconds_sum":
        sql = f"""SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (a.ended_at - a.accepted_at))), 0)
                  FROM {a} a
                  JOIN {c} c ON a.conversation_id = c.id AND a.organization_id = c.organization_id
                  WHERE a.organization_id = %s AND a.accepted_at IS NOT NULL AND a.ended_at IS NOT NULL{asg_scope}{ch_sql.replace('c.', 'c.')}"""
        return _scalar(cur, sql, org + asg_ids + ch_params), asg_scope_name, "sum"

    if metric_id == "completed_leg_count":
        sql = f"""SELECT COUNT(*) FROM {a} a
                  JOIN {c} c ON a.conversation_id = c.id AND a.organization_id = c.organization_id
                  WHERE a.organization_id = %s AND a.accepted_at IS NOT NULL AND a.ended_at IS NOT NULL{asg_scope}{ch_sql.replace('c.', 'c.')}"""
        return _scalar(cur, sql, org + asg_ids + ch_params), asg_scope_name, "count"

    if metric_id == "total_assignments":
        sql = f"""SELECT COUNT(*) FROM {a} a
                  JOIN {c} c ON a.conversation_id = c.id AND a.organization_id = c.organization_id
                  WHERE a.organization_id = %s{asg_scope}{ch_sql.replace('c.', 'c.')}"""
        return _scalar(cur, sql, org + asg_ids + ch_params), asg_scope_name, "count"

    if metric_id == "missed_assignments":
        sql = f"""SELECT COUNT(*) FROM {a} a
                  JOIN {c} c ON a.conversation_id = c.id AND a.organization_id = c.organization_id
                  WHERE a.organization_id = %s AND lower(a.state) IN ('rejected', 'expired'){asg_scope}{ch_sql.replace('c.', 'c.')}"""
        return _scalar(cur, sql, org + asg_ids + ch_params), asg_scope_name, "count"

    if metric_id == "missed_contact_rate":
        ch_sql, ch_params = _channel_conv_join_filter("c")
        return _ratio(
            cur,
            f"""SELECT COUNT(*) FROM {a} a
                JOIN {c} c ON a.conversation_id = c.id AND a.organization_id = c.organization_id
                WHERE a.organization_id = %s AND lower(a.state) IN ('rejected', 'expired'){asg_scope}{ch_sql}""",
            f"""SELECT COUNT(*) FROM {a} a
                JOIN {c} c ON a.conversation_id = c.id AND a.organization_id = c.organization_id
                WHERE a.organization_id = %s{asg_scope}{ch_sql}""",
            org + asg_ids + ch_params,
        ), asg_scope_name, "ratio"

    if metric_id == "total_sla_states":
        return _scalar(cur, f"SELECT COUNT(*) FROM {s} WHERE {ow}", org), "org", "count"

    if metric_id == "breached_sla_count":
        sql = f"SELECT COUNT(*) FROM {s} WHERE {ow} AND breached_at IS NOT NULL"
        return _scalar(cur, sql, org), "org", "count"

    if metric_id == "sla_breach_rate":
        return _ratio(
            cur,
            f"SELECT COUNT(*) FROM {s} WHERE {ow} AND breached_at IS NOT NULL",
            f"SELECT COUNT(*) FROM {s} WHERE {ow}",
            org,
        ), "org", "ratio"

    if metric_id == "resolved_dispositions":
        sql = f"""SELECT COUNT(*) FROM {d}
                  WHERE {ow} AND lower(resolution_code) = 'resolved'"""
        return _scalar(cur, sql, org), "org", "count"

    if metric_id == "total_transfers":
        return _scalar(cur, f"SELECT COUNT(*) FROM {t} WHERE {ow}", org), "org", "count"

    if metric_id == "active_agents":
        sql = f"SELECT COUNT(*) FROM {agt} WHERE {ow} AND lower(status) = 'active'"
        return _scalar(cur, sql, org), "org", "count"

    if metric_id == "total_agents":
        return _scalar(cur, f"SELECT COUNT(*) FROM {agt} WHERE {ow}", org), "org", "count"

    if metric_id == "active_agents_setup":
        sql = f"""SELECT COUNT(*) FROM {ACC}.setup_users
                  WHERE {ow} AND lower(status) = 'active'"""
        return _scalar(cur, sql, org), "org", "count"

    if metric_id == "total_agents_setup":
        return _scalar(cur, f"SELECT COUNT(*) FROM {ACC}.setup_users WHERE {ow}", org), "org", "count"

    cap_ch, cap_ch_params = _task_channel_filter()
    if metric_id == "total_active_agent_count":
        sql = f"""SELECT COALESCE(SUM(active_count), 0) FROM {cap} WHERE {ow}{cap_ch}"""
        return _scalar(cur, sql, org + cap_ch_params), "org", "sum"

    if metric_id == "total_agent_capacity":
        sql = f"""SELECT COALESCE(SUM(max_concurrency), 0) FROM {cap} WHERE {ow}{cap_ch}"""
        return _scalar(cur, sql, org + cap_ch_params), "org", "sum"

    if metric_id == "human_agent_occupancy_rate_capacity":
        return _ratio(
            cur,
            f"SELECT COALESCE(SUM(active_count), 0) FROM {cap} WHERE {ow}{cap_ch}",
            f"SELECT COALESCE(SUM(max_concurrency), 0) FROM {cap} WHERE {ow}{cap_ch}",
            org + cap_ch_params,
        ), "org", "ratio"

    if metric_id == "handling_or_wrap_seconds":
        sql = f"""SELECT COALESCE(SUM(
                    EXTRACT(EPOCH FROM (coalesce(ended_at, now()) - started_at))
                  ), 0)
                  FROM {pres}
                  WHERE {ow} AND new_state IN ('busy', 'after_contact_work')"""
        return _scalar(cur, sql, org), "org", "sum"

    if metric_id == "logged_in_eligible_seconds":
        sql = f"""SELECT COALESCE(SUM(
                    EXTRACT(EPOCH FROM (coalesce(ended_at, now()) - started_at))
                  ), 0)
                  FROM {pres}
                  WHERE {ow} AND new_state != 'offline'"""
        return _scalar(cur, sql, org), "org", "sum"

    if metric_id == "human_agent_occupancy_rate_presence":
        return _ratio(
            cur,
            f"""SELECT COALESCE(SUM(
                    EXTRACT(EPOCH FROM (coalesce(ended_at, now()) - started_at))
                  ), 0)
                  FROM {pres}
                  WHERE {ow} AND new_state IN ('busy', 'after_contact_work')""",
            f"""SELECT COALESCE(SUM(
                    EXTRACT(EPOCH FROM (coalesce(ended_at, now()) - started_at))
                  ), 0)
                  FROM {pres}
                  WHERE {ow} AND new_state != 'offline'""",
            org,
        ), "org", "ratio"

    task_filters = {
        "open_agent_tasks": "lower(status) = 'open'",
        "callback_tasks": "lower(task_type) = 'callback'",
        "follow_up_tasks": "lower(task_type) = 'follow_up'",
        "suggestion_tasks": "lower(task_type) = 'suggestion'",
    }
    task_ch, task_ch_params = _task_channel_filter()
    if metric_id in task_filters:
        flt = task_filters[metric_id]
        sql = f"SELECT COUNT(*) FROM {tasks} WHERE {ow} AND {flt}{task_scope}{task_ch}"
        return _scalar(cur, sql, org + task_ids + task_ch_params), task_scope_name, "count"

    if metric_id == "agents_assigned_callback":
        sql = f"""SELECT COUNT(DISTINCT assigned_user_id) FROM {tasks}
                  WHERE {ow} AND lower(task_type) = 'callback'{task_scope}{task_ch}"""
        return _scalar(cur, sql, org + task_ids + task_ch_params), task_scope_name, "count_distinct"

    cop_disp = """CASE
      WHEN accepted IS TRUE AND final_text IS NOT DISTINCT FROM suggestion_text THEN 'accepted'
      WHEN accepted IS TRUE AND final_text IS DISTINCT FROM suggestion_text THEN 'modified'
      WHEN accepted IS FALSE THEN 'rejected'
      ELSE 'pending'
    END"""

    if metric_id == "agent_assist_suggestions_total":
        return _scalar(cur, f"SELECT COUNT(*) FROM {cop} WHERE {ow}", org), "org", "count"

    if metric_id == "agent_assist_accepted_or_modified":
        sql = f"""SELECT COUNT(*) FROM {cop}
                  WHERE {ow} AND ({cop_disp}) IN ('accepted', 'modified')"""
        return _scalar(cur, sql, org), "org", "count"

    if metric_id == "agent_assist_modified":
        sql = f"SELECT COUNT(*) FROM {cop} WHERE {ow} AND ({cop_disp}) = 'modified'"
        return _scalar(cur, sql, org), "org", "count"

    if metric_id == "agent_assist_adoption_rate":
        return _ratio(
            cur,
            f"""SELECT COUNT(*) FROM {cop}
                WHERE {ow} AND ({cop_disp}) IN ('accepted', 'modified')""",
            f"SELECT COUNT(*) FROM {cop} WHERE {ow}",
            org,
        ), "org", "ratio"

    if metric_id == "agent_assist_modification_rate":
        return _ratio(
            cur,
            f"SELECT COUNT(*) FROM {cop} WHERE {ow} AND ({cop_disp}) = 'modified'",
            f"""SELECT COUNT(*) FROM {cop}
                WHERE {ow} AND ({cop_disp}) IN ('accepted', 'modified')""",
            org,
        ), "org", "ratio"

    if metric_id == "tool_executions_total":
        sql = f"""SELECT COUNT(*) FROM {tool}
                  WHERE {ow} AND lower(status) IN ('succeeded', 'failed', 'cancelled')"""
        return _scalar(cur, sql, org), "org", "count"

    if metric_id == "tool_executions_succeeded":
        sql = f"SELECT COUNT(*) FROM {tool} WHERE {ow} AND lower(status) = 'succeeded'"
        return _scalar(cur, sql, org), "org", "count"

    if metric_id == "tool_success_rate":
        return _ratio(
            cur,
            f"""SELECT COUNT(*) FROM {tool}
                WHERE {ow} AND lower(status) = 'succeeded'""",
            f"""SELECT COUNT(*) FROM {tool}
                WHERE {ow} AND lower(status) IN ('succeeded', 'failed', 'cancelled')""",
            org,
        ), "org", "ratio"

    if metric_id == "total_queues_configured":
        return _scalar(cur, f"SELECT COUNT(*) FROM {q} WHERE {ow}", org), "org", "count"

    if metric_id == "total_queue_agent_assignments":
        sql = f"""SELECT COUNT(*) FROM {qa} qa
                  JOIN {q} q ON qa.queue_id = q.id
                  WHERE q.organization_id = %s"""
        return _scalar(cur, sql, org), "org", "count"

    if metric_id == "total_teams":
        return _scalar(cur, f"SELECT COUNT(*) FROM {teams} WHERE {ow}", org), "org", "count"

    raise ValueError(f"no source SQL for {metric_id}")


def mart_probe(cur, metric_id: str) -> float | None:
    """Secondary non-blocking mart check."""
    org = [ORG]
    try:
        if metric_id == "total_conversations":
            return _scalar(
                cur,
                f"SELECT COUNT(*) FROM {MART_SCHEMA}.mart_conversations WHERE organization_id = %s",
                org,
            )
        if metric_id == "open_conversations":
            return _scalar(
                cur,
                f"""SELECT COUNT(*) FROM {MART_SCHEMA}.mart_conversations
                    WHERE organization_id = %s AND is_open = true""",
                org,
            )
    except Exception:
        return None
    return None


def _close(a: float | None, b: float | None, tol: float = DRIFT) -> bool:
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    if math.isnan(a) and math.isnan(b):
        return True
    return abs(a - b) <= max(tol, abs(b) * 1e-6)


def main() -> int:
    from semantic.ownership import list_certified_for_source

    _load_dotenv()
    metrics = sorted(list_certified_for_source("aiccaas"))
    print(f"CCaaS core metrics — API {API_BASE} org={ORG} agent={AGENT}")
    print(f"Ground truth: {SRC}.* / {ACC}.* ({len(metrics)} metrics)\n")

    try:
        conn = _pg_conn()
    except Exception as exc:
        print(f"Postgres connect failed: {exc}")
        return 1

    results: list[Row] = []
    passed = failed = 0

    with conn:
        cur = conn.cursor()
        for mid in metrics:
            status, api_val, err, latency, source_path, path = api_query(mid)
            try:
                src_val, scope, _kind = ground_truth(cur, mid)
            except Exception as exc:
                src_val, scope = None, "?"
                err = f"source: {exc}"

            mart_val = mart_probe(cur, mid)
            proxy = mid in {
                "ai_containment_rate",
                "agent_assist_adoption_rate",
                "agent_assist_modification_rate",
                "ai_handover_rate",
                "handover_rate",
            }
            tol = 0.05 if proxy else DRIFT

            if status != 200:
                match = False
                note = err[:160] if err else f"HTTP {status}"
                failed += 1
            elif src_val is None and api_val is None:
                match = True
                note = "both null"
                passed += 1
            elif src_val is None and api_val == 0 and (
                mid.endswith("_rate") or mid == "human_agent_occupancy_rate_presence"
            ):
                match = True
                note = "api default_zero (no source intervals)"
                passed += 1
            elif src_val is None or api_val is None:
                match = False
                note = "one side null"
                failed += 1
            else:
                match = _close(api_val, src_val, tol)
                delta = api_val - src_val
                note = f"delta={delta:.6g}"
                if proxy:
                    note += " (proxy tol 5%)"
                if match:
                    passed += 1
                else:
                    failed += 1

            delta = None
            if api_val is not None and src_val is not None:
                delta = api_val - src_val

            fast_path = source_path == "sql_template" or path == "sql_template"
            if status == 200 and not fast_path:
                note += f"; path={source_path or path or 'unknown'}"

            row = Row(
                metric=mid,
                scope=scope,
                api_status=status,
                api_value=api_val,
                source_value=src_val,
                mart_value=mart_val,
                delta=delta,
                match=match,
                source_path=source_path or path,
                latency_s=latency,
                note=note,
            )
            results.append(row)
            mark = "PASS" if row.match else "FAIL"
            print(
                f"  {mark}  {mid:42s} api={row.api_value!s:>12} src={row.source_value!s:>12}  {row.note}"
            )

    report = {
        "api": API_BASE,
        "org": ORG,
        "agent": AGENT,
        "ground_truth": f"{SRC}.* / {ACC}.*",
        "passed": passed,
        "failed": failed,
        "metrics": [r.__dict__ for r in results],
    }
    OUTPUT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\n{passed}/{len(metrics)} matched. Report: {OUTPUT}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
