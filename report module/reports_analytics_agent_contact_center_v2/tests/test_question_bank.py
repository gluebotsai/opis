"""Deterministic question bank for the Contact Center SQL engine. No Domain."""

from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

PACK = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACK.parent))

from reports_analytics_agent_contact_center_v2.core.grounding import check_answer
from reports_analytics_agent_contact_center_v2.core.loop import LoopState
from reports_analytics_agent_contact_center_v2.core.sql.run_kpi import run_kpi
from reports_analytics_agent_contact_center_v2.core.sql.run_sql import run_sql
from reports_analytics_agent_contact_center_v2.core.sql.views import cte_body
from reports_analytics_agent_contact_center_v2.core.examples import load_sql_examples, pick_sql_examples
from reports_analytics_agent_contact_center_v2.core.loader import PRODUCT_DIR, merge_effective
from reports_analytics_agent_contact_center_v2.core.time import resolve_expression

ORG = 1012
ADMIN_USER = 1
AGENT_USER = 1
DSN = os.environ.get("DATABASE_URL")


def _load_env() -> None:
    env = Path("/home/vectone/Uday/report module/.env")
    if not env.exists() or os.environ.get("DATABASE_URL"):
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    global DSN
    DSN = os.environ.get("DATABASE_URL")


_load_env()


class OfflineContractTests(unittest.TestCase):
    def test_time_utc_week_monday(self) -> None:
        b = resolve_expression("this week")
        self.assertIsNotNone(b.start)
        assert b.start is not None
        self.assertEqual(b.start.weekday(), 0)

    def test_all_time_has_no_date_window(self) -> None:
        for phrase in ("all time", "overall", ""):
            bounds = resolve_expression(phrase)
            self.assertIsNone(bounds.start)
            self.assertIsNone(bounds.end)

    def test_the_last_n_days_is_a_window(self) -> None:
        bounds = resolve_expression("the last 7 days")
        self.assertIsNotNone(bounds.start)
        self.assertIsNotNone(bounds.end)

    def test_last_n_days_is_today_plus_previous_n_minus_one(self) -> None:
        now = datetime(2026, 10, 9, 17, 30, tzinfo=timezone.utc)
        bounds = resolve_expression("last 7 days", now=now)
        self.assertEqual(bounds.start, datetime(2026, 10, 3, tzinfo=timezone.utc))
        self.assertEqual(bounds.end, datetime(2026, 10, 10, tzinfo=timezone.utc))
        self.assertIn("today + previous 6", bounds.echo)
        one = resolve_expression("past 1 day", now=now)
        self.assertEqual(one.start, datetime(2026, 10, 9, tzinfo=timezone.utc))
        self.assertEqual(one.end, datetime(2026, 10, 10, tzinfo=timezone.utc))
        hours = resolve_expression("last 3 hours", now=now)
        self.assertEqual(hours.start, datetime(2026, 10, 9, 14, 30, tzinfo=timezone.utc))
        self.assertEqual(hours.end, now)
        months = resolve_expression("last 3 months", now=now)
        self.assertEqual(months.start, datetime(2026, 8, 1, tzinfo=timezone.utc))
        self.assertEqual(months.end, datetime(2026, 11, 1, tzinfo=timezone.utc))

    def test_transferred_list_example_uses_clock_not_resolution_code(self) -> None:
        picked = pick_sql_examples("list the conversations that were transferred", load_sql_examples(), top_k=3)
        sql = "\n".join(str(x.get("sql") or "") for x in picked).lower()
        self.assertIn("transferred_at is not null", sql)
        self.assertNotIn("resolution_code", sql)

    def test_duration_kpis_return_minutes(self) -> None:
        kpis = merge_effective()["kpis"]
        seconds = [
            kid
            for kid, card in kpis.items()
            if str(card.get("unit") or "").lower() in {"second", "seconds"}
        ]
        self.assertEqual(seconds, [])
        for kid in ("avg_handle_time", "avg_first_response", "asa", "avg_hold_time"):
            self.assertEqual(kpis[kid]["unit"], "minutes")
            sql = (PRODUCT_DIR / "sql" / f"{kid}.sql").read_text()
            self.assertIn("/ 60", sql)
        first = (PRODUCT_DIR / "sql" / "avg_first_response.sql").read_text()
        self.assertIn("COALESCE(conversations.queued_at, conversations.created_at)", first)
        self.assertNotIn("first_response_at - conversations.assigned_at", first)
        asa = (PRODUCT_DIR / "sql" / "asa.sql").read_text()
        self.assertIn("AS asa_n", asa)
        self.assertIn("FILTER", asa)

    def test_rate_templates_are_null_safe_for_all_time(self) -> None:
        for kid, num_clock in (
            ("resolution_rate", "resolved_at"),
            ("transfer_rate", "transferred_at"),
        ):
            sql = (PRODUCT_DIR / "sql" / f"{kid}.sql").read_text()
            self.assertIn("CAST(:start AS timestamptz) IS NULL", sql, kid)
            self.assertIn("CAST(:end AS timestamptz) IS NULL", sql, kid)
            self.assertIn(num_clock, sql)

    def test_deny_is_never_retried(self) -> None:
        loop = LoopState()
        loop.record_attempt()
        self.assertIsNone(loop.should_retry({"status": "error", "error_type": "DENY"}))
        loop.record_error({"error_type": "DENY", "error": "scope_denied"})
        self.assertEqual(loop.should_retry({"status": "error", "error_type": "REPAIR"}), "REPAIR")

    def test_person_names_are_not_invented_dimensions(self) -> None:
        from reports_analytics_agent_contact_center_v2.core.sql.templates import (
            alias_dimension,
            apply_slice_leftovers,
            partition_slice,
        )

        self.assertIsNone(alias_dimension("Bharathi"))
        self.assertIsNone(alias_dimension("Raghu"))
        self.assertEqual(alias_dimension("channel"), "channel")
        card = merge_effective()["kpis"]["avg_handle_time"]
        dims, leftovers = partition_slice(["Bharathi", "Raghu", "channel"], card, kpi_id="avg_handle_time")
        self.assertEqual(dims, ["channel"])
        self.assertEqual(leftovers, ["Bharathi", "Raghu"])
        dims, filters, mentions = apply_slice_leftovers(
            leftovers, card, dims=dims, filters={}
        )
        self.assertIn("agent", dims)
        self.assertEqual(mentions, ["Bharathi", "Raghu"])
        self.assertNotIn("agent", filters)
        compiled = run_kpi(
            "avg_handle_time",
            organization_id=ORG,
            user_id=ADMIN_USER,
            role="admin",
            time_window="last 7 days",
            dimensions=["agent"],
            filters={"agent": ["Bharathi", "Raghu"]},
        )
        self.assertEqual(compiled.get("status"), "compiled")
        self.assertIn("GROUP BY", compiled.get("sql") or "")
        self.assertNotIn("['Bharathi'", str(compiled.get("sql") or ""))

    def test_neighbour_phrases_retrieve_the_right_card(self) -> None:
        from reports_analytics_agent_contact_center_v2.core.context import pick_metric_ids

        kpis = merge_effective()["kpis"]
        cases = [
            ("conversation count by channel", "total"),
            ("how many calls last week", "call_count"),
            ("first reply sla last 7 days", "first_reply_sla"),
            ("busy hours last 7 days", "busy_hours"),
            ("how many agents are ready now", "ready_agents"),
        ]
        for goal, expected in cases:
            picked = pick_metric_ids(goal, kpis, role="admin", top_k=8)
            self.assertIn(expected, picked[:3], f"{goal} -> {picked}")
            self.assertEqual(picked[0], expected, f"{goal} first card {picked[0]}")
        monthly = pick_metric_ids("average handled per month", kpis, role="admin", top_k=8)
        self.assertIn("avg_monthly_handled", monthly[:3], monthly)

    def test_conversations_cte_skips_catalog_only_columns(self) -> None:
        body = cte_body("conversations", "admin")
        self.assertNotIn("provider_thread_id", body)
        self.assertIn("src.channel", body)
        self.assertIn("src.handler", body)
        self.assertIn("src.queue_name", body)


@unittest.skipUnless(DSN, "DATABASE_URL not set")
class EngineContractTests(unittest.TestCase):
    def test_unknown_kpi(self) -> None:
        out = run_kpi("not_a_kpi", organization_id=ORG, user_id=ADMIN_USER, role="admin")
        self.assertEqual(out["error_type"], "REPLAN")

    def test_unknown_filter_refused(self) -> None:
        # HITL-rejected filter must not be appended as WHERE.
        out = run_kpi(
            "handled",
            organization_id=ORG,
            user_id=ADMIN_USER,
            role="admin",
            time_window="last 7 days",
            filters={"lifecycle_state": "open"},
        )
        self.assertEqual(out["status"], "error")
        self.assertEqual(out["error_type"], "REPAIR")
        self.assertIn("unknown filter", out["error"])

    def test_unknown_dimension_refused(self) -> None:
        out = run_kpi(
            "handled",
            organization_id=ORG,
            user_id=ADMIN_USER,
            role="admin",
            time_window="last 7 days",
            dimensions=["shift"],
        )
        self.assertEqual(out["status"], "error")
        self.assertEqual(out["error_type"], "REPAIR")
        self.assertIn("unknown dimension", out["error"])

    def test_agent_org_denied(self) -> None:
        out = run_kpi(
            "total",
            organization_id=ORG,
            user_id=AGENT_USER,
            role="agent",
            scope_level="org",
            time_window="last 7 days",
        )
        self.assertEqual(out["error_type"], "DENY")

    def test_physical_table_denied(self) -> None:
        out = run_sql(
            "SELECT count(*) FROM ccass.conversations",
            organization_id=ORG,
            user_id=ADMIN_USER,
            role="admin",
        )
        self.assertEqual(out["status"], "error")
        self.assertIn(out["error_type"], {"DENY", "REPAIR"})


@unittest.skipUnless(DSN, "DATABASE_URL not set")
class QuestionBankTests(unittest.TestCase):
    def test_neighbour_total_vs_handled(self) -> None:
        total = run_kpi(
            "total",
            organization_id=ORG,
            user_id=ADMIN_USER,
            role="admin",
            time_window="last 30 days",
            dsn=DSN,
        )
        handled = run_kpi(
            "handled",
            organization_id=ORG,
            user_id=ADMIN_USER,
            role="admin",
            time_window="last 30 days",
            dsn=DSN,
        )
        self.assertEqual(total["status"], "ok", total.get("error"))
        self.assertEqual(handled["status"], "ok", handled.get("error"))
        self.assertNotEqual(total["sql"], handled["sql"])
        t = (total["rows"] or [{}])[0].get("total")
        h = (handled["rows"] or [{}])[0].get("handled")
        self.assertIsNotNone(t)
        self.assertIsNotNone(h)

    def test_user_word_status_is_conversation_status(self) -> None:
        out = run_kpi(
            "total",
            organization_id=ORG,
            user_id=ADMIN_USER,
            role="admin",
            time_window="last 30 days",
            dimensions=["conversation.status"],
            dsn=DSN,
        )
        self.assertEqual(out["status"], "ok", out.get("error"))
        self.assertTrue(out["rows"] == [] or "conversation_status" in out["rows"][0])

    def test_joined_queue_filter_stays_run_kpi(self) -> None:
        out = run_kpi(
            "total",
            organization_id=ORG,
            user_id=ADMIN_USER,
            role="admin",
            time_window="last 30 days",
            filters={"queue": "__no_such_queue__"},
            dsn=DSN,
        )
        self.assertNotIn("unknown filter", out.get("error") or "")
        self.assertNotEqual(out.get("error_type"), "REPAIR")
        if out["status"] == "ok":
            n = (out["rows"] or [{}])[0].get("total", 0)
            self.assertEqual(int(n or 0), 0)
        else:
            self.assertEqual(out["error_type"], "REPLAN")
            self.assertIn("queue", (out.get("error") or "").lower())

    def test_list_is_not_count(self) -> None:
        out = run_sql(
            "SELECT customer_name, channel, status, queue_name FROM rpt.conversations "
            "ORDER BY created_at DESC LIMIT 5",
            organization_id=ORG,
            user_id=ADMIN_USER,
            role="admin",
            dsn=DSN,
        )
        self.assertEqual(out["status"], "ok", out.get("error"))
        self.assertTrue(out.get("certified") is False)
        if out["rows"]:
            self.assertIn("customer_name", out["rows"][0])
            self.assertNotIn("count", {k.lower() for k in out["rows"][0]})

    def test_dimension_channel_groups(self) -> None:
        out = run_kpi(
            "total",
            organization_id=ORG,
            user_id=ADMIN_USER,
            role="admin",
            time_window="last 30 days",
            dimensions=["channel"],
            dsn=DSN,
        )
        self.assertEqual(out["status"], "ok", out.get("error"))
        if out["rows"]:
            self.assertIn("channel", out["rows"][0])

    def test_month_dimension_and_monthly_average(self) -> None:
        kpis = merge_effective()["kpis"]
        self.assertIn("month", kpis["handled"]["allowed_dimensions"])
        self.assertIn("week", kpis["handled"]["allowed_dimensions"])
        self.assertNotIn("month", kpis["avg_monthly_handled"]["allowed_dimensions"])
        compiled = run_kpi(
            "handled",
            organization_id=ORG,
            user_id=ADMIN_USER,
            role="admin",
            time_window="all time",
            dimensions=["month"],
        )
        self.assertEqual(compiled.get("status"), "compiled", compiled.get("error"))
        sql = (compiled.get("sql") or "").lower()
        self.assertIn("date_trunc", sql)
        self.assertIn("month", sql)
        monthly = run_kpi(
            "avg_monthly_handled",
            organization_id=ORG,
            user_id=ADMIN_USER,
            role="admin",
            time_window="all time",
            dsn=DSN,
        )
        self.assertEqual(monthly["status"], "ok", monthly.get("error"))
        row = (monthly["rows"] or [{}])[0]
        self.assertIn("avg_monthly_handled", row)
        self.assertGreater(float(row["avg_monthly_handled"] or 0), 0)

    def test_child_grain_group_by_uses_joined_or_src_columns(self) -> None:
        cases = [
            ("avg_messages_per_conversation", "channel", "all time"),
            ("failed_send_rate", "channel", "all time"),
            ("offer_accept_rate", "channel", "all time"),
            ("offers_ringing", "channel", "now"),
            ("bot_grounded_rate", "channel", "all time"),
            ("copilot_acceptance_rate", "channel", "all time"),
            ("missed_rate", "channel", "all time"),
            ("ready_agents", "presence_state", "now"),
            ("logged_in_agents", "presence_state", "now"),
        ]
        for kid, dim, window in cases:
            out = run_kpi(
                kid,
                organization_id=ORG,
                user_id=ADMIN_USER,
                role="admin",
                time_window=window,
                dimensions=[dim],
                dsn=DSN,
            )
            self.assertEqual(out.get("status"), "ok", (kid, dim, out.get("error")))
            self.assertNotIn("no SQL expression", str(out.get("error") or ""))
        hold = run_kpi(
            "avg_hold_time",
            organization_id=ORG,
            user_id=ADMIN_USER,
            role="admin",
            time_window="all time",
            dimensions=["channel"],
            dsn=DSN,
        )
        self.assertEqual(hold.get("status"), "error", hold)
        self.assertIn("not allowed", str(hold.get("error") or "").lower())
        hold_ok = run_kpi(
            "avg_hold_time",
            organization_id=ORG,
            user_id=ADMIN_USER,
            role="admin",
            time_window="all time",
            dsn=DSN,
        )
        self.assertEqual(hold_ok.get("status"), "ok", hold_ok.get("error"))
        cards = merge_effective()["kpis"]
        leftover = {
            "avg_messages_per_conversation": "all time",
            "failed_send_rate": "all time",
            "offer_accept_rate": "all time",
            "offers_ringing": "now",
            "bot_grounded_rate": "all time",
            "copilot_acceptance_rate": "all time",
            "missed_rate": "all time",
            "ready_agents": "now",
            "logged_in_agents": "now",
            "avg_hold_time": "all time",
        }
        for kid, window in leftover.items():
            for dim in cards[kid].get("allowed_dimensions") or []:
                compiled = run_kpi(
                    kid,
                    organization_id=ORG,
                    user_id=ADMIN_USER,
                    role="admin",
                    time_window=window,
                    dimensions=[dim],
                )
                self.assertEqual(
                    compiled.get("status"),
                    "compiled",
                    (kid, dim, compiled.get("error")),
                )

    def test_all_time_resolution_and_transfer_rate(self) -> None:
        for kid, num_k, den_k in (
            ("resolution_rate", "resolved_n", "handled_n"),
            ("transfer_rate", "transferred_n", "handled_n"),
        ):
            out = run_kpi(
                kid,
                organization_id=ORG,
                user_id=ADMIN_USER,
                role="admin",
                time_window="all time",
                dsn=DSN,
            )
            self.assertEqual(out["status"], "ok", (kid, out.get("error")))
            row = (out["rows"] or [{}])[0]
            self.assertIn(num_k, row)
            self.assertIn(den_k, row)
            self.assertIn("rate_pct", row)
            if (row.get(den_k) or 0) > 0:
                self.assertIsNotNone(row.get("rate_pct"), kid)

    def test_reopen_rate_two_counts(self) -> None:
        out = run_kpi(
            "reopen_rate",
            organization_id=ORG,
            user_id=ADMIN_USER,
            role="admin",
            time_window="last 30 days",
            dsn=DSN,
        )
        self.assertEqual(out["status"], "ok", out.get("error"))
        row = (out["rows"] or [{}])[0]
        self.assertIn("reopen_n", row)
        self.assertIn("resolved_n", row)
        self.assertIn("rate_pct", row)

    def test_live_waiting_skips_window(self) -> None:
        out = run_kpi(
            "waiting",
            organization_id=ORG,
            user_id=ADMIN_USER,
            role="admin",
            time_window="last 7 days",
            dsn=DSN,
        )
        self.assertEqual(out["status"], "ok", out.get("error"))
        self.assertEqual(out.get("time_echo"), "live (no date window)")

    def test_call_count_not_cdr(self) -> None:
        out = run_kpi(
            "call_count",
            organization_id=ORG,
            user_id=ADMIN_USER,
            role="admin",
            time_window="last 30 days",
            dsn=DSN,
        )
        self.assertEqual(out["status"], "ok", out.get("error"))
        self.assertIn("channel = 'call'", out["sql"].replace('"', ""))

    def test_grounding_facts_contain_row_numbers(self) -> None:
        out = run_kpi(
            "total",
            organization_id=ORG,
            user_id=ADMIN_USER,
            role="admin",
            time_window="last 7 days",
            dsn=DSN,
        )
        self.assertEqual(out["status"], "ok", out.get("error"))
        n = int((out["rows"] or [{}])[0].get("total") or 0)
        facts = f"certified: true\nrow 1: total={n}"
        g = check_answer(f"There were {n} conversations.", facts)
        self.assertTrue(g.grounded, g.ungrounded)


@unittest.skipUnless(DSN, "DATABASE_URL not set")
class CombinationSmokeTests(unittest.TestCase):
    """Phase 5: no dim, each dim on total, each filter on total."""

    def test_total_no_dimension(self) -> None:
        out = run_kpi(
            "total",
            organization_id=ORG,
            user_id=ADMIN_USER,
            role="admin",
            time_window="last 7 days",
            dsn=DSN,
        )
        self.assertEqual(out["status"], "ok", out.get("error"))

    def test_total_each_core_dimension(self) -> None:
        for dim in ["channel", "queue", "agent", "handler", "conversation_status"]:
            with self.subTest(dim=dim):
                out = run_kpi(
                    "total",
                    organization_id=ORG,
                    user_id=ADMIN_USER,
                    role="admin",
                    time_window="last 7 days",
                    dimensions=[dim],
                    dsn=DSN,
                )
                self.assertEqual(out["status"], "ok", f"{dim}: {out.get('error')}")

    def test_total_each_core_filter(self) -> None:
        samples = {
            "channel": "call",
            "conversation_status": "closed",
            "handler": "Agent",
            "priority": 1,
        }
        for name, value in samples.items():
            with self.subTest(filter=name):
                out = run_kpi(
                    "total",
                    organization_id=ORG,
                    user_id=ADMIN_USER,
                    role="admin",
                    time_window="last 7 days",
                    filters={name: value},
                    dsn=DSN,
                )
                self.assertEqual(out["status"], "ok", f"{name}: {out.get('error')}")

    def test_occupancy_compiles(self) -> None:
        out = run_kpi(
            "occupancy",
            organization_id=ORG,
            user_id=ADMIN_USER,
            role="admin",
            time_window="last 7 days",
            dsn=DSN,
        )
        self.assertEqual(out["status"], "ok", out.get("error"))

    def test_missed_rate_has_denominator(self) -> None:
        out = run_kpi(
            "missed_rate",
            organization_id=ORG,
            user_id=ADMIN_USER,
            role="admin",
            time_window="last 30 days",
            dsn=DSN,
        )
        self.assertEqual(out["status"], "ok", out.get("error"))
        row = (out["rows"] or [{}])[0]
        self.assertIn("missed_n", row)
        self.assertIn("total_n", row)

    def test_present_days_compiles(self) -> None:
        out = run_kpi(
            "present_days",
            organization_id=ORG,
            user_id=ADMIN_USER,
            role="admin",
            time_window="last 7 days",
            dsn=DSN,
        )
        self.assertEqual(out["status"], "ok", out.get("error"))

    def test_assignment_kpis_use_reason_not_reason_label(self) -> None:
        for kpi in ("offer_accept_rate", "offers_ringing"):
            with self.subTest(kpi=kpi):
                out = run_kpi(
                    kpi,
                    organization_id=ORG,
                    user_id=ADMIN_USER,
                    role="admin",
                    time_window="last 7 days",
                    dsn=DSN,
                )
                self.assertEqual(out["status"], "ok", f"{kpi}: {out.get('error')}")
                self.assertNotIn("reason_label", out["sql"])

    def test_callback_task_status_slot(self) -> None:
        out = run_kpi(
            "callback_count",
            organization_id=ORG,
            user_id=ADMIN_USER,
            role="admin",
            time_window="last 30 days",
            filters={"task_status": "open"},
            dsn=DSN,
        )
        self.assertEqual(out["status"], "ok", out.get("error"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
