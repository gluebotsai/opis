"""sql_guard tests.

Static tests always run. Database tests run when RPT_TEST_DSN points at a TEST database
loaded with tests/pg/schema.sql + tests/golden/seed.sql. Every DB test runs inside a
transaction that is rolled back.

Seed facts used below (org 900001):
  staff: 91001 admin, 91002 agent, 91003 resolver, 91004 inactive agent
  queues: 92001 (A: members 91002, 91003), 92002 (B: member 91002)
  tickets: 8 in org 900001 (T1-T5 queue A, T6-T8 queue B), 1 in org 900002
  resolver 91003 is resolver on T4, T5, T7
"""

from __future__ import annotations

import os

import pytest

from reports_analytics_agent_ticketing.core.sql_guard import GuardError, guard_sql

ORG = 900001
ADMIN, AGENT, RESOLVER, OTHER_AGENT = 91001, 91002, 91003, 91004
QA, QB = 92001, 92002
DSN = os.environ.get("RPT_TEST_DSN")


def g(sql, role="admin", user=ADMIN, queues=(QA, QB), params=None, **kw):
    return guard_sql(
        sql, role=role, organization_id=ORG, user_id=user,
        queue_ids=list(queues), params=params or {}, **kw,
    )


# --------------------------------------------------------------------------- rejections

@pytest.mark.parametrize(
    "sql, fragment",
    [
        ("", "empty"),
        ("SELECT 1; DELETE FROM rpt.tickets", "exactly one"),
        ("DELETE FROM rpt.tickets", "Only SELECT"),
        ("UPDATE rpt.tickets SET status = 'x'", "Only SELECT"),
        ("INSERT INTO rpt.tickets (id) VALUES (1)", "Only SELECT"),
        ("COPY ticketing.tickets TO '/tmp/x'", "Only SELECT"),
        ("SET statement_timeout = 0", "Only SELECT"),
        ("SELECT * INTO leak FROM rpt.tickets", "INTO"),
        ("SELECT * FROM rpt.tickets FOR UPDATE", "LOCK"),
        ("WITH RECURSIVE r AS (SELECT 1) SELECT * FROM r", "RECURSIVE"),
        ("SELECT * FROM ticketing.tickets", "ticketing.tickets is not allowed"),
        ("SELECT * FROM pg_catalog.pg_user", "not allowed"),
        ("SELECT * FROM information_schema.tables", "not allowed"),
        ("SELECT * FROM rpt.tickets t WHERE EXISTS (SELECT 1 FROM ticketing.agents)", "not allowed"),
        ("SELECT * FROM (SELECT * FROM ticketing.agents) x", "not allowed"),
        ("WITH x AS (SELECT * FROM ticketing.tickets) SELECT * FROM x", "not allowed"),
        ("SELECT pg_sleep(5) FROM rpt.tickets", "pg_sleep"),
        ("SELECT pg_catalog.pg_sleep(5) FROM rpt.tickets", "pg_sleep"),
        ("SELECT set_config('a', 'b', false) FROM rpt.tickets", "set_config"),
        ("SELECT current_setting('x') FROM rpt.tickets", "current_setting"),
        ("SELECT dblink('x', 'y') FROM rpt.tickets", "dblink"),
        ("SELECT lo_import('/etc/passwd') FROM rpt.tickets", "lo_import"),
        ("SELECT * FROM rpt.tickets WHERE created_at >= :start", "was not provided"),
        ("SELECT * FROM rpt.tickets WHERE organization_id = :_org_id", "reserved"),
        ("SELECT * FROM rpt.tickets WHERE id = ?", "named parameters"),
        ("WITH rpt_x AS (SELECT 1) SELECT * FROM rpt.tickets", "reserved"),
        ("SELECT * FROM rpt_tickets", "reserved"),
        ("SELECT t.no_such_col FROM rpt.tickets t", "not in rpt.tickets"),
        ("SELECT * FROM rpt.nope", "not available"),
        ("SELECT 1", "at least one rpt"),
        ("SELEC status FROM rpt.tickets", "parse"),
    ],
)
def test_rejects(sql, fragment):
    with pytest.raises(GuardError) as err:
        g(sql)
    assert fragment.lower() in str(err.value).lower()


def test_resolver_has_no_agents_view():
    with pytest.raises(GuardError, match="not available"):
        g("SELECT * FROM rpt.agents", role="resolver", user=RESOLVER, queues=[QA])


def test_resolver_has_no_customers_or_queues():
    for view in ("customers", "queues", "queue_members", "kb_articles", "recommendations"):
        with pytest.raises(GuardError, match="not available"):
            g(f"SELECT * FROM rpt.{view}", role="resolver", user=RESOLVER, queues=[QA])


def test_agent_has_no_queue_ticket_counts():
    with pytest.raises(GuardError, match="not available"):
        g("SELECT * FROM rpt.queue_ticket_counts", role="agent", user=AGENT, queues=[QA])


def test_agent_cannot_select_hidden_meta():
    with pytest.raises(GuardError, match="not in rpt.audit_events"):
        g("SELECT a.meta FROM rpt.audit_events a", role="agent", user=AGENT, queues=[QA])


def test_reserved_param_names_rejected_from_runtime():
    with pytest.raises(GuardError, match="reserved"):
        g("SELECT * FROM rpt.tickets", params={"_org_id": 1})


# --------------------------------------------------------------------------- rewriting

def test_output_uses_scoped_ctes_and_bound_params():
    out = g("SELECT t.status FROM rpt.tickets t JOIN rpt.ticket_facts f ON f.ticket_id = t.id")
    assert "rpt." not in out.sql.replace("rpt_", "")
    assert "rpt_tickets AS (" in out.sql and "rpt_ticket_facts AS (" in out.sql
    assert "%(_org_id)s" in out.sql
    assert str(ORG) not in out.sql  # never pasted
    assert out.params["_org_id"] == ORG
    assert out.views == ["tickets", "ticket_facts"]


def test_row_cap_added_and_lowered():
    assert g("SELECT * FROM rpt.tickets").sql.rstrip().endswith("LIMIT 500")
    assert g("SELECT * FROM rpt.tickets LIMIT 100000").sql.rstrip().endswith("LIMIT 500")
    assert g("SELECT * FROM rpt.tickets LIMIT 5").sql.rstrip().endswith("LIMIT 5")


def test_comments_are_dropped():
    out = g("SELECT /* x */ status FROM rpt.tickets -- y")
    assert "/*" not in out.sql and "--" not in out.sql


def test_percent_is_escaped_for_driver():
    out = g("SELECT * FROM rpt.tickets WHERE customer_name ILIKE '%acme%'")
    assert "'%%acme%%'" in out.sql


# --------------------------------------------------------------------------- database

db = pytest.mark.skipif(not DSN, reason="set RPT_TEST_DSN to a test database")


@pytest.fixture
def conn():
    import psycopg

    with psycopg.connect(DSN, autocommit=False) as c:
        yield c
        c.rollback()


def run(conn, sql, role="admin", user=ADMIN, queues=(QA, QB), params=None):
    out = g(sql, role=role, user=user, queues=queues, params=params)
    with conn.cursor() as cur:
        cur.execute(out.sql, out.params)
        cols = [d.name for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


@db
def test_tenant_isolation(conn):
    assert run(conn, "SELECT COUNT(*) AS n FROM rpt.tickets")[0]["n"] == 8


@db
def test_ticket_lookup_by_number(conn):
    rows = run(conn, "SELECT ticket_number, status FROM rpt.tickets WHERE ticket_number = '#G5'")
    assert rows == [{"ticket_number": "#G5", "status": "Resolved"}]


@db
def test_ilike_and_modulo_run(conn):
    rows = run(conn, "SELECT COUNT(*) AS n, MAX(id % 2) AS m FROM rpt.tickets WHERE customer_name ILIKE '%acme%'")
    assert rows[0]["n"] == 6


@db
def test_params_bind(conn):
    rows = run(
        conn,
        "SELECT COUNT(*) AS n FROM rpt.tickets WHERE created_at >= :start AND created_at < :end",
        params={"start": "2026-09-01T00:00:00+00:00", "end": "2026-09-01T13:00:00+00:00"},
    )
    assert rows[0]["n"] == 3  # T1 10:00, T2 11:00, T3 12:00


@db
def test_bare_view_name_and_qualified_columns(conn):
    rows = run(conn, "SELECT rpt.tickets.status, COUNT(*) AS n FROM tickets GROUP BY 1 ORDER BY 1")
    assert sum(r["n"] for r in rows) == 8


@db
def test_own_cte_and_join_with_facts(conn):
    rows = run(
        conn,
        """
        WITH resolved AS (
          SELECT f.resolution_hours FROM rpt.tickets t
          JOIN rpt.ticket_facts f ON f.ticket_id = t.id
          WHERE f.resolution_hours IS NOT NULL
        )
        SELECT COUNT(*) AS n, ROUND(AVG(resolution_hours)::numeric, 1) AS avg_h FROM resolved
        """,
    )
    assert rows[0]["n"] == 2  # T5 4h, T7 4h
    assert float(rows[0]["avg_h"]) == 4.0


@db
def test_agent_scope_own_plus_queue(conn):
    rows = run(conn, "SELECT COUNT(*) AS n FROM rpt.tickets", role="agent", user=AGENT, queues=[QA])
    assert rows[0]["n"] == 7  # assigned to him (7); T8 is queue B, unassigned, not his


@db
def test_agent_masks_other_agents(conn):
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO ticketing.tickets (id, organization_id, ticket_number, status, priority,"
            " assignee_id, assignee_name, queue_id, queue_name, created_by_id, created_by_name,"
            " created_at, updated_at) VALUES (95100, %s, '#M1', 'Open', 'low', %s, 'Other Agent',"
            " %s, 'Golden Queue A', %s, 'Other Agent', now(), now())",
            (ORG, OTHER_AGENT, QA, OTHER_AGENT),
        )
    rows = run(
        conn,
        "SELECT assignee_id, assignee_name, created_by_name FROM rpt.tickets WHERE ticket_number = '#M1'",
        role="agent", user=AGENT, queues=[QA],
    )
    assert rows == [{"assignee_id": -1, "assignee_name": "Another agent", "created_by_name": "Another staff member"}]
    ranking = run(
        conn,
        "SELECT assignee_name, COUNT(*) AS n FROM rpt.tickets GROUP BY 1",
        role="agent", user=AGENT, queues=[QA],
    )
    names = {r["assignee_name"] for r in ranking}
    assert "Other Agent" not in names


@db
def test_agent_roster_is_self_plus_queue_resolvers(conn):
    rows = run(conn, "SELECT id FROM rpt.agents ORDER BY id", role="agent", user=AGENT, queues=[QA])
    assert [r["id"] for r in rows] == [AGENT, RESOLVER]


@db
def test_agent_queues_only_his(conn):
    rows = run(conn, "SELECT id FROM rpt.queues", role="agent", user=AGENT, queues=[QA])
    assert [r["id"] for r in rows] == [QA]


@db
def test_resolver_own_tickets_only(conn):
    rows = run(conn, "SELECT COUNT(*) AS n FROM rpt.tickets", role="resolver", user=RESOLVER, queues=[QA])
    assert rows[0]["n"] == 3  # T4, T5, T7


@db
def test_resolver_masks_agents_on_own_tickets(conn):
    rows = run(
        conn, "SELECT DISTINCT assignee_name FROM rpt.tickets", role="resolver", user=RESOLVER, queues=[QA]
    )
    assert {r["assignee_name"] for r in rows} == {"An agent"}


@db
def test_resolver_queue_counts_only_his_queue(conn):
    rows = run(
        conn,
        "SELECT queue_id, SUM(ticket_count) AS n FROM rpt.queue_ticket_counts GROUP BY queue_id",
        role="resolver", user=RESOLVER, queues=[QA],
    )
    assert rows == [{"queue_id": QA, "n": 5}]


@db
def test_resolver_notes_masked(conn):
    rows = run(
        conn, "SELECT author_id, author_name FROM rpt.notes", role="resolver", user=RESOLVER, queues=[QA]
    )
    assert rows == [{"author_id": -1, "author_name": "Another staff member"}]  # note on T5 by agent


@db
def test_agent_notifications_own(conn):
    rows = run(conn, "SELECT COUNT(*) AS n FROM rpt.notifications", role="agent", user=AGENT, queues=[QA])
    assert rows[0]["n"] == 2


@db
def test_empty_queue_list_is_safe(conn):
    rows = run(conn, "SELECT COUNT(*) AS n FROM rpt.queues", role="agent", user=AGENT, queues=[])
    assert rows[0]["n"] == 0


@db
def test_union_and_generate_series(conn):
    rows = run(
        conn,
        "SELECT d::date AS day FROM generate_series(TIMESTAMPTZ '2026-09-01', TIMESTAMPTZ '2026-09-03', INTERVAL '1 day') d"
        " UNION ALL SELECT created_at::date FROM rpt.tickets WHERE ticket_number = '#G1'",
    )
    assert len(rows) == 4


# --------------------------------------------------------------------------- harder escapes

@pytest.mark.parametrize(
    "sql",
    [
        'SELECT * FROM "ticketing"."tickets"',
        "SELECT * FROM rpt.tickets t, ticketing.tickets x",
        "SELECT * FROM rpt.tickets t, LATERAL pg_sleep(1)",
        "SELECT PG_SLEEP(1) FROM rpt.tickets",
        "SELECT * FROM rpt.tickets WHERE id IN (SELECT id FROM rpt.tickets UNION SELECT id FROM ticketing.tickets)",
        "SELECT (SELECT COUNT(*) FROM ticketing.tickets) AS n FROM rpt.tickets",
        "SELECT * FROM rpt.tickets WHERE status = (SELECT status FROM public.anything LIMIT 1)",
        "SELECT * FROM other_db.rpt.tickets",
        "SELECT version() FROM rpt.tickets",
        "SELECT pg_read_file('/etc/passwd') FROM rpt.tickets",
        "SELECT txid_current() FROM rpt.tickets",
        "SELECT query_to_xml('select 1', true, true, '') FROM rpt.tickets",
    ],
)
def test_rejects_harder(sql):
    with pytest.raises(GuardError):
        g(sql)


def test_resolver_cannot_subquery_agents():
    with pytest.raises(GuardError, match="not available"):
        g(
            "SELECT t.id, (SELECT a.display_name FROM rpt.agents a WHERE a.id = t.assignee_id) FROM rpt.tickets t",
            role="resolver", user=RESOLVER, queues=[QA],
        )


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT 1 AS x FROM rpt.tickets;",
        "SELECT t.* FROM rpt.tickets t",
        'SELECT * FROM "rpt"."tickets"',
        "SELECT status, ROW_NUMBER() OVER (PARTITION BY queue_id ORDER BY created_at DESC) AS rn FROM rpt.tickets",
        "SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY resolution_hours) FROM rpt.ticket_facts",
        "SELECT date_trunc('month', created_at) AS m, COUNT(*) FILTER (WHERE status = 'Open') FROM rpt.tickets GROUP BY 1",
        "SELECT meta->>'from' AS f FROM rpt.audit_events WHERE action = 'ticket.assigned'",
        "SELECT to_char(created_at, 'YYYY-MM') AS m, age(now(), created_at) FROM rpt.tickets",
    ],
)
def test_accepts_normal_analytics(sql):
    assert g(sql).sql


@db
@pytest.mark.parametrize(
    "sql",
    [
        "SELECT status, ROW_NUMBER() OVER (PARTITION BY queue_id ORDER BY created_at DESC) AS rn FROM rpt.tickets",
        "SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY resolution_hours) AS p50 FROM rpt.ticket_facts",
        "SELECT date_trunc('month', created_at) AS m, COUNT(*) FILTER (WHERE status = 'Open') AS n FROM rpt.tickets GROUP BY 1",
        "SELECT meta->>'prev_status' AS p FROM rpt.audit_events WHERE action = 'ticket.status_changed'",
        "SELECT to_char(created_at, 'YYYY-MM') AS m, age(now(), created_at) AS a FROM rpt.tickets",
        "SELECT q.queue_name, COUNT(t.id) AS n FROM rpt.queues q LEFT JOIN rpt.tickets t ON t.queue_id = q.id GROUP BY 1",
        "SELECT a.display_name, a.role FROM rpt.agents a ORDER BY 1",
        "SELECT COUNT(*) AS n FROM rpt.tickets t JOIN rpt.ticket_facts f ON f.ticket_id = t.id WHERE f.resolution_sla_missed",
    ],
)
def test_normal_analytics_execute(conn, sql):
    run(conn, sql)


@pytest.mark.parametrize(
    "fn",
    ["version()", "current_user", "session_user", "current_database()", "current_schema()",
     "gen_random_uuid()", "random()", "txid_current()", "pg_backend_pid()", "inet_server_addr()",
     "nextval('s')", "row_to_json(t)", "has_table_privilege('a', 'b')"],
)
def test_rejects_system_functions(fn):
    with pytest.raises(GuardError, match="not allowed"):
        g(f"SELECT {fn} FROM rpt.tickets t")
