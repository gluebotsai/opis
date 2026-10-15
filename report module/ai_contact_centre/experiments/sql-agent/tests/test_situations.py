from sql_agent.dql import DqlError, validate_dql
from sql_agent.glossary import expand_query
from sql_agent.joins import join_path
from sql_agent.repair import repair_sql
from sql_agent.search import search_catalog
from sql_agent.wrap import summarize_rows, wrap_preview_and_summary


def test_spelling_handel_time_is_certified(planner):
    plan = planner.plan("average handel time")
    assert plan["trust"] == "certified"
    assert plan["metric"]["id"] == "avg_handle_time"
    assert "avg_handle_seconds" in plan["sql"]
    assert plan["expansion"]["fuzzy_hits"] or plan["expansion"]["glossary_hits"]


def test_transfers_and_sla_questions_stay_certified(planner):
    transfers = planner.plan("how many transferred")
    assert transfers["trust"] == "certified"
    assert transfers["metric"]["id"] == "transfers"
    first = planner.plan("first response time")
    assert first["trust"] == "certified"
    assert first["metric"]["id"] == "avg_first_response"
    sla = planner.plan("response SLA")
    assert sla["trust"] == "certified"
    assert sla["metric"]["id"] == "response_sla_60s"


def test_spelling_whatsap_finds_channel(catalog):
    expansion = expand_query("whatsap volume last week", catalog)
    assert "whatsapp" in expansion["tokens"]
    search = search_catalog("whatsap handled conversations", catalog)
    table_names = [item["name"] for item in search["tables"]]
    assert "ccass.conversations" in table_names


def test_chanel_column_repair(catalog):
    repaired = repair_sql(
        "SELECT chanel, COUNT(*) AS n FROM ccass.conversatons GROUP BY chanel",
        catalog,
    )
    assert repaired["changed"] is True
    joined = repaired["repaired"].casefold()
    assert "channel" in joined
    assert "ccass.conversations" in joined


def test_multi_join_disposition_by_queue(planner):
    plan = planner.plan("disposition mix by queue")
    assert plan["trust"] in {"certified", "generated"}
    names = {table["name"] for table in plan["tables"]}
    assert "ccass.conversations" in names
    assert "ccass.queues" in names
    assert "ccass.dispositions" in names
    sql = plan["sql"]
    assert "JOIN" in sql.upper()
    assert "DISTINCT ON" in sql.upper()
    path = plan["join_path"]
    assert path["ok"] is True
    assert len(path["steps"]) >= 2


def test_three_hop_sla_policy_path(catalog):
    path = join_path(
        ["ccass.conversations", "ccass.sla_policies"],
        catalog,
    )
    assert path["ok"] is True
    via = {step["to"] for step in path["steps"]} | {step["from"] for step in path["steps"]}
    assert "ccass.conversation_sla_state" in via
    assert "ccass.sla_policies" in via


def test_metric_miss_agent_messages_uses_gold_sql(planner):
    plan = planner.plan("how many agent messages per channel")
    assert plan["trust"] == "generated"
    assert plan["sql"]
    assert "sender_type" in plan["sql"]
    assert "'agent'" in plan["sql"]
    assert "ccass.conversation_messages" in plan["sql"]
    names = {table["name"] for table in plan["tables"]}
    assert "ccass.conversation_messages" in names
    assert "ccass.conversations" in names


def test_yesterday_chat_count_is_volume_not_webchat(catalog, planner):
    expansion = expand_query("waht is yesterday chat count", catalog)
    tokens = set(expansion["tokens"])
    assert "whatsapp" not in tokens
    assert "webchat" not in tokens
    assert "conversations" in tokens
    plan = planner.plan("waht is yesterday chat count")
    assert plan["trust"] == "certified"
    assert plan["metric"]["id"] == "conversations_handled"
    assert "GROUP BY" not in plan["sql"].upper()


def test_agents_by_channel_uses_agent_names(planner):
    plan = planner.plan("which agents handled more numbef chats channel wise")
    assert plan["trust"] == "generated"
    sql = plan["sql"].casefold()
    assert "ccass.agents" in sql
    assert "display_name" in sql
    assert "channel" in sql
    assert "group by" in sql
    names = {table["name"] for table in plan["tables"]}
    assert "ccass.agents" in names
    assert "ccass.conversations" in names


def test_aht_by_channel_does_not_lock_overall_kpi(planner):
    overall = planner.plan("average handel time last month")
    assert overall["trust"] == "certified"
    assert overall["metric"]["id"] == "avg_handle_time"
    by_channel = planner.plan("average handle time by channel last month")
    assert by_channel["trust"] == "generated"
    sql = by_channel["sql"].casefold()
    assert "group by" in sql
    assert "channel" in sql
    assert "avg_handle_seconds" in sql


def test_last_month_and_daily_questions_keep_catalog_sql(planner):
    daily = planner.plan("daily handled trend last month")
    assert daily["trust"] == "certified"
    assert daily["metric"]["id"] == "daily_handled_trend"
    assert "DATE_TRUNC" in daily["sql"].upper()
    by_day = planner.plan("one line per channel by day last month")
    assert by_day["trust"] == "generated"
    assert "channel" in by_day["sql"].casefold()
    assert "DATE_TRUNC" in by_day["sql"].upper()
    queue = planner.plan("disposition mix by queue last month")
    assert queue["trust"] == "generated"
    names = {table["name"] for table in queue["tables"]}
    assert "ccass.queues" in names
    assert "ccass.dispositions" in names


def test_overflow_wrap_includes_total_and_limit(catalog):
    wrapped = wrap_preview_and_summary(
        "SELECT channel, COUNT(*) AS n FROM ccass.conversations GROUP BY channel",
        catalog,
        limit=50,
    )
    assert wrapped["preview_limit"] == 50
    assert "__total_matched_rows" in wrapped["execute_sql"]
    assert "LIMIT 50" in wrapped["execute_sql"]
    summary = summarize_rows(
        [
            {"__total_matched_rows": 1200, "channel": "webchat", "n": 800},
            {"__total_matched_rows": 1200, "channel": "email", "n": 400},
        ]
    )
    assert summary["total_matched_rows"] == 1200
    assert summary["truncated"] is True
    assert "webchat" in {row["channel"] for row in summary["preview"]}


def test_dql_rejects_insert(catalog):
    try:
        validate_dql("INSERT INTO ccass.conversations (channel) VALUES ('webchat')", catalog)
        raise AssertionError("expected DqlError")
    except DqlError as error:
        assert "INSERT" in str(error)


def test_dql_rejects_unknown_table(catalog):
    try:
        validate_dql("SELECT id FROM ccass.secrets", catalog)
        raise AssertionError("expected DqlError")
    except DqlError as error:
        assert "allowlist" in str(error).casefold()


def test_dql_rejects_message_body(catalog):
    try:
        validate_dql("SELECT body FROM ccass.conversation_messages", catalog)
        raise AssertionError("expected DqlError")
    except DqlError as error:
        assert "blocked" in str(error).casefold()


def test_preview_prepare_ok(planner):
    plan = planner.plan("channel mix")
    assert plan["trust"] == "certified"
    assert plan["execute"]["ok"] is True
    assert plan["execute"]["preview_limit"] == 50


def test_catalog_loads_all_tables(catalog):
    assert len(catalog.tables) >= 20
    assert "ccass.conversations" in catalog.tables
    assert "cdp.interactions" in catalog.tables
    assert catalog.metrics
    assert catalog.examples
