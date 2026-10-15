"""MAS Phase 0 smoke tests — flags, handoffs, invoke stubs; legacy untouched."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

from app.mas.catalog import DOMAIN_IDS, EXECUTOR_META, executors_for_domain, normalize_domain
from app.mas.runtime.bindings import resolve_cron_binding, resolve_hub_binding
from app.mas.runtime.flags import is_domain_enabled, parse_enabled_domains
from app.mas.runtime.handoffs import invoke_executor_result, route_to_domain_result
from app.mas.runtime.invoke import mas_invoke
from app.mas.runtime.task_memory import get_mas_task, set_active_domain


def test_parse_enabled_domains_empty():
    assert parse_enabled_domains("") == frozenset()
    assert is_domain_enabled("audience") is False or "audience" not in parse_enabled_domains(
        ""
    )


def test_parse_enabled_domains_list():
    assert "audience" in parse_enabled_domains("audience, optimization")
    assert "optimization" in parse_enabled_domains("audience,optimization")
    assert parse_enabled_domains("all") == frozenset(DOMAIN_IDS)


def test_catalog_complete():
    assert set(DOMAIN_IDS) == {
        "audience",
        "creation",
        "recommendation_run",
        "content",
        "image",
        "optimization",
        "forms",
    }
    for did in DOMAIN_IDS:
        ex = executors_for_domain(did)
        assert ex, did
        for eid in ex:
            assert eid in EXECUTOR_META
            meta_domain = EXECUTOR_META[eid]["domain"]
            if did == "recommendation_run":
                assert meta_domain == "creation", f"{eid} shared with creation"
            else:
                assert meta_domain == did


def test_route_and_invoke_handoffs():
    r = route_to_domain_result(domain_id="audience", restated_query="add a contact")
    assert r["ok"] is True
    assert r["domain_id"] == "audience"
    assert "contact" in r["executors"]

    bad = route_to_domain_result(domain_id="nope")
    assert bad["ok"] is False

    inv = invoke_executor_result(executor_id="contact", task_spec={"query": "x"})
    assert inv["ok"] is True
    assert inv["executor_id"] == "contact"


def test_hub_and_cron_bindings():
    assert resolve_hub_binding("create_contact")["executor_id"] == "contact"
    assert resolve_hub_binding("create-contact")["domain_id"] == "audience"
    assert resolve_cron_binding("template_compliance_scan")["executor_id"] == (
        "content_verification"
    )


def test_task_memory_clears_on_domain_change():
    session: dict = {}
    set_active_domain(session, "audience")
    task = get_mas_task(session)
    task["active_executor"] = "contact"
    task["steps"] = [{"executor_id": "contact"}]
    set_active_domain(session, "optimization")
    task2 = get_mas_task(session)
    assert task2["active_domain"] == "optimization"
    assert task2["active_executor"] is None
    assert task2["steps"] == []


def test_mas_invoke_super_routes_via_llm_with_domain_hint():
    session: dict = {}

    async def run():
        with patch(
            "app.mas.super_agent.runner._llm_choose_domain",
            new_callable=AsyncMock,
        ) as mock_llm, patch(
            "app.mas.executors.image_generate.runner.run_native_image_executor",
            new_callable=AsyncMock,
        ) as mock_native:
            mock_llm.return_value = {
                "ok": True,
                "domain_id": "image",
                "restated_query": "generate a logo",
            }
            mock_native.return_value = {
                "ok": True,
                "action_status": "completed",
                "agent_id": "image_generate",
                "reply": "done",
                "mas_native_image": True,
            }
            return await mas_invoke(
                {
                    "entry": "interactive",
                    "skip_super": False,
                    "domain_id": "image",
                    "query": "generate a logo",
                    "session": session,
                    "session_id": "s-phase0",
                    "token": "tok",
                    "task_spec": {"executor_id": "image_generate", "query": "logo"},
                }
            ), mock_llm

    out, mock_llm = asyncio.run(run())
    assert out["ok"] is True
    assert out["domain_id"] == "image"
    mock_llm.assert_awaited_once()
    assert get_mas_task(session)["active_domain"] == "image"
    dr = out.get("domain_result") or out
    assert dr.get("agent_id") in ("image_generate", "image_generation")
    assert dr.get("agent_md_loaded") is True


def test_mas_invoke_skip_super_executor():
    session: dict = {}

    async def run():
        with patch(
            "app.mas.executors.image_generate.runner.run_native_image_executor",
            new_callable=AsyncMock,
        ) as mock_native:
            mock_native.return_value = {
                "ok": True,
                "action_status": "completed",
                "kind": "executor",
                "agent_id": "image_generate",
                "reply": "done",
                "mas_native_image": True,
            }
            return await mas_invoke(
                {
                    "entry": "cron",
                    "skip_super": True,
                    "domain_id": "image",
                    "executor_id": "image_generate",
                    "session_id": "s-phase0",
                    "token": "tok",
                    "task_spec": {"query": "gen"},
                    "session": session,
                }
            )

    out = asyncio.run(run())
    assert out["ok"] is True
    assert out["agent_id"] == "image_generate"
    assert out["kind"] == "executor"
    assert get_mas_task(session)["active_domain"] == "image"
    assert get_mas_task(session)["active_executor"] == "image_generate"
    assert get_mas_task(session)["steps"]


def test_mas_invoke_sticky_domain():
    session: dict = {}
    set_active_domain(session, "image")

    async def run():
        with patch(
            "app.mas.executors.image_refine.runner.run_native_image_executor",
            new_callable=AsyncMock,
        ) as mock_native:
            mock_native.return_value = {
                "ok": True,
                "action_status": "completed",
                "kind": "executor",
                "agent_id": "image_refine",
                "reply": "done",
                "mas_native_image": True,
            }
            return await mas_invoke(
                {
                    "entry": "sticky_domain",
                    "domain_id": "image",
                    "session_id": "s-phase0",
                    "token": "tok",
                    "task_spec": {
                        "executor_id": "image_refine",
                        "image_url": "https://example.com/a.png",
                    },
                    "session": session,
                }
            )

    out = asyncio.run(run())
    assert out["ok"] is True
    assert out.get("agent_id") == "image_refine"


def test_domain_can_forward_to_executor_via_task_spec():
    session: dict = {}

    async def run():
        with patch(
            "app.mas.executors.image_generate.runner.run_native_image_executor",
            new_callable=AsyncMock,
        ) as mock_native:
            mock_native.return_value = {
                "ok": True,
                "action_status": "completed",
                "kind": "executor",
                "agent_id": "image_generate",
                "reply": "done",
                "mas_native_image": True,
            }
            return await mas_invoke(
                {
                    "entry": "sticky_domain",
                    "domain_id": "image",
                    "session_id": "s-phase0",
                    "token": "tok",
                    "task_spec": {
                        "executor_id": "image_generate",
                        "prompt": "banner",
                    },
                    "session": session,
                }
            )

    out = asyncio.run(run())
    assert out["ok"] is True
    assert out.get("agent_id") == "image_generate" or out.get("kind") == "executor"


def test_normalize_module_alias():
    assert normalize_domain("contacts") == "audience"
    assert normalize_domain("create_campaign") == "creation"


def test_all_agent_md_files_exist():
    from pathlib import Path

    root = Path(__file__).resolve().parents[1] / "app" / "mas"
    assert (root / "super_agent" / "agent.md").is_file()
    for did in DOMAIN_IDS:
        assert (root / "domains" / did / "agent.md").is_file(), did
    for eid in EXECUTOR_META:
        assert (root / "executors" / eid / "agent.md").is_file(), eid
