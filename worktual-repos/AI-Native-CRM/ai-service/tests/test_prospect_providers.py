"""Unit tests for prospect provider merge + fixture search."""

from __future__ import annotations

import pytest

from app.providers.fixtures import fixture_candidates, use_fixture_key
from app.providers.prospect_types import merge_candidates
from app.providers import search_providers
from app.agents import prospect_qualify_agent, prospect_search_agent


def test_use_fixture_key():
    assert use_fixture_key("__fixture__")
    assert use_fixture_key("fixture")
    assert not use_fixture_key("real-secret-key")


def test_merge_candidates_dedupes_email_and_unions_sources():
    a = [
        {
            "firstName": "A",
            "lastName": "One",
            "email": "a@acme.com",
            "companyName": "Acme",
            "companyDomain": "acme.com",
            "sourcesFoundIn": ["apollo"],
        }
    ]
    b = [
        {
            "firstName": "A",
            "lastName": "One",
            "email": "a@acme.com",
            "title": "VP Sales",
            "companyName": "Acme",
            "companyDomain": "acme.com",
            "technographics": ["salesforce"],
            "sourcesFoundIn": ["builtwith"],
        }
    ]
    merged = merge_candidates([a, b])
    assert len(merged) == 1
    assert set(merged[0]["sourcesFoundIn"]) == {"apollo", "builtwith"}
    assert merged[0]["title"] == "VP Sales"
    assert "salesforce" in (merged[0].get("technographics") or [])


@pytest.mark.asyncio
async def test_search_providers_multi_source_fixtures():
    candidates, used, errors = await search_providers(
        sources=["apollo", "builtwith"],
        credentials={
            "apollo": {"apiKey": "__fixture__", "settings": None},
            "builtwith": {"apiKey": "__fixture__", "settings": None},
        },
        criteria={"industries": ["IT services"], "geos": ["IN"]},
        fetch_limit=5,
    )
    assert "apollo" in used
    assert "builtwith" in used
    assert len(candidates) >= 5
    assert errors == []


@pytest.mark.asyncio
async def test_prospect_search_agent_run():
    out = await prospect_search_agent.run(
        {
            "jobId": "test-job",
            "sources": ["apollo", "zoominfo"],
            "credentials": [
                {"provider": "apollo", "apiKey": "__fixture__"},
                {"provider": "zoominfo", "apiKey": "__fixture__"},
            ],
            "criteria": {"industries": ["SaaS"], "geos": ["US"]},
            "fetchLimit": 6,
            "limit": 6,
        }
    )
    assert out["ok"] is True
    assert out["count"] >= 1
    assert set(out["sourcesUsed"]) >= {"apollo", "zoominfo"}


@pytest.mark.asyncio
async def test_prospect_qualify_heuristic_ranks():
    cands = fixture_candidates(
        "apollo",
        {"industries": ["IT services"], "geos": ["IN"], "technographics": ["salesforce"]},
        8,
    )
    out = await prospect_qualify_agent.run(
        {
            "jobId": "q1",
            "candidates": cands,
            "limit": 3,
            "icp": {
                "targetIndustries": ["IT services"],
                "serviceableGeos": ["IN"],
            },
            "competitors": ["salesforce"],
        }
    )
    assert out["ok"] is True
    assert out["count"] == 3
    assert all("qualifyReasons" in c for c in out["candidates"])
