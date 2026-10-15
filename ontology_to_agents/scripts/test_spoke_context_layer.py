#!/usr/bin/env python3
"""End-to-end tests: ontology slice + semantic layer + Context Layer API for spokes."""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any

BASE = "http://127.0.0.1:8765"

HUB_FULL_PRODUCTS = ["contact_centre", "ticketing", "crm", "campaign"]


def spoke_product(agent: str) -> str:
    if agent.startswith("cc."):
        return "ccaas"
    if agent.startswith("tk."):
        return "ticketing"
    if agent.startswith("crm.") or agent == "crm-agent":
        return "crm"
    if agent.startswith("camp."):
        return "campaign"
    if agent == "cdp.profile":
        return "cdp"
    return "crm"


def enrich(body: dict, path: str) -> dict:
    """Add required product/products to API request bodies."""
    out = dict(body)
    if path.endswith("/hub"):
        if "products" not in out:
            out["products"] = HUB_FULL_PRODUCTS
        return out
    if "product" not in out and "products" not in out:
        agent = out.get("agent") or ""
        preset = out.get("preset") or ""
        if preset.startswith("cc."):
            out["product"] = "ccaas"
        elif preset.startswith("tk."):
            out["product"] = "ticketing"
        elif preset.startswith("crm."):
            out["product"] = "crm"
        elif preset.startswith("camp."):
            out["product"] = "campaign"
        elif agent:
            out["product"] = spoke_product(agent)
        elif out.get("modules"):
            out["product"] = "crm"
    return out


@dataclass
class Results:
    passed: int = 0
    failed: int = 0
    errors: list[str] = field(default_factory=list)

    def ok(self, name: str) -> None:
        self.passed += 1
        print(f"  PASS  {name}")

    def fail(self, name: str, detail: str) -> None:
        self.failed += 1
        self.errors.append(f"{name}: {detail}")
        print(f"  FAIL  {name} — {detail}")


def http(
    method: str,
    path: str,
    body: dict | None = None,
    *,
    enrich_body: bool = True,
) -> tuple[int, Any]:
    if enrich_body and body is not None and (
        path.endswith("/slice") or path.endswith("/hub")
    ):
        body = enrich(body, path)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        BASE + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = raw
        return e.code, payload


def test_api_infra(r: Results) -> None:
    print("\n=== API infrastructure ===")
    code, body = http("GET", "/health")
    if code == 200 and body == {"status": "ok"}:
        r.ok("GET /health")
    else:
        r.fail("GET /health", f"{code} {body}")

    code, body = http("GET", "/")
    if (
        code == 200
        and body.get("spoke_endpoint") == "POST /v1/ontology/slice"
        and body.get("hub_endpoint") == "POST /v1/ontology/hub"
        and body.get("semantic_endpoint") == "POST /v1/semantic/query"
    ):
        r.ok("GET / service identity (three endpoints)")
    else:
        r.fail("GET /", str(body))

    code, body = http("GET", "/v1/version")
    if code == 200 and body.get("ontology_version"):
        r.ok("GET /v1/version")
    else:
        r.fail("GET /v1/version", str(body))


def test_xor_validation(r: Results) -> None:
    print("\n=== XOR validation (exactly one selector) ===")
    for payload, label in [
        ({"organizationId": 1000}, "none"),
        ({"organizationId": 1000, "agent": "x", "preset": "y"}, "two"),
        ({"organizationId": 1000, "modules": []}, "empty modules"),
    ]:
        code, body = http("POST", "/v1/ontology/slice", payload)
        if code in (400, 422):
            r.ok(f"reject {label} selector → {code}")
        else:
            r.fail(f"reject {label} selector", f"expected 400/422 got {code}")


def test_tenant_resolution(r: Results) -> None:
    print("\n=== Tenant resolution (org + organizationId) ===")
    code, body = http(
        "POST",
        "/v1/ontology/slice",
        {"organizationId": 1000, "agent": "crm.deals"},
    )
    if code == 200 and body.get("tenant") == "org1000":
        r.ok("org1000 from organizationId=1000")
    else:
        r.fail("tenant org1000", f"{code} {body}")

    code, body = http(
        "POST",
        "/v1/ontology/slice",
        {"organizationId": 9999, "agent": "crm.deals"},
    )
    if code == 400 and "org9999" in str(body):
        r.ok("missing tenant org9999 → 400")
    else:
        r.fail("missing tenant", f"{code} {body}")


def test_spoke_selectors(r: Results) -> None:
    print("\n=== Spoke selectors: agent / preset / modules ===")
    cases = [
        ("agent", {"organizationId": 1000, "agent": "crm.deals"}),
        ("preset", {"organizationId": 1000, "preset": "cc.ai_support"}),
        ("modules", {"organizationId": 1000, "modules": ["identity", "ticket"]}),
    ]
    for kind, payload in cases:
        code, body = http("POST", "/v1/ontology/slice", payload)
        if code != 200:
            r.fail(f"slice by {kind}", f"{code} {body}")
            continue
        if "prompt" in body and body["prompt"].startswith("Ontology"):
            r.ok(f"slice by {kind} returns prompt")
        else:
            r.fail(f"slice by {kind}", "missing prompt")


def test_spoke_products(r: Results) -> None:
    print("\n=== All spokes: compact prompt smoke ===")
    agents = [
        ("CC", "cc.ai_support"),
        ("CC reporting", "cc.reporting"),
        ("TK", "ticket_lifecycle_executor"),
        ("TK super", "tk.super"),
        ("CRM", "crm.deals"),
        ("CRM reports", "crm.reports"),
        ("Campaign", "camp.reports"),
    ]
    for label, agent in agents:
        code, body = http(
            "POST",
            "/v1/ontology/slice",
            {"organizationId": 1000, "agent": agent},
        )
        if code != 200:
            r.fail(label, f"{code}")
            continue
        prompt = body.get("prompt", "")
        lines = len(prompt.splitlines())
        if lines < 200 and "wt:" in prompt:
            r.ok(f"{label} ({agent}) — {lines} lines")
        else:
            r.fail(label, f"prompt too large or missing wt: ({lines} lines)")

    code, body = http(
        "POST",
        "/v1/ontology/hub",
        {"organizationId": 1000, "products": HUB_FULL_PRODUCTS},
    )
    if code == 200:
        prompt = body.get("prompt", "")
        if prompt.startswith("Ontology") and "wt:" in prompt:
            r.ok(f"Hub (/hub) — {len(prompt.splitlines())} lines")
        else:
            r.fail("Hub (/hub)", "missing prompt")
    else:
        r.fail("Hub (/hub)", f"{code}")


def test_response_formats(r: Results) -> None:
    print("\n=== Response formats ===")
    code, body = http(
        "POST",
        "/v1/ontology/slice",
        {"organizationId": 1000, "agent": "crm.deals", "format": "prompt"},
    )
    keys = set(body.keys())
    if code == 200 and keys <= {"organizationId", "tenant", "version", "prompt"}:
        r.ok("format=prompt minimal keys")
    else:
        r.fail("format=prompt", f"keys={keys}")

    code, body = http(
        "POST",
        "/v1/ontology/slice",
        {"organizationId": 1000, "agent": "crm.deals", "format": "debug"},
    )
    if code == 200 and "resolved_modules" in body and "core" in body["resolved_modules"]:
        r.ok("format=debug includes resolved_modules")
    else:
        r.fail("format=debug", str(body))

    code, body = http(
        "POST",
        "/v1/ontology/slice",
        {"organizationId": 1000, "agent": "crm.deals", "format": "json"},
    )
    if code == 200 and "slice" in body and "classes" in body["slice"]:
        r.ok("format=json full slice")
    else:
        r.fail("format=json", str(body))


def test_tenant_overlay(r: Results) -> None:
    print("\n=== Tenant overlay (saas_b2b labels) ===")
    code, body = http(
        "POST",
        "/v1/ontology/slice",
        {"organizationId": 1000, "agent": "crm.deals"},
    )
    prompt = body.get("prompt", "")
    if "Prospect" in prompt:
        r.ok("org1000 label Prospect on Customer")
    else:
        r.fail("tenant labels", "Prospect not in prompt")


def test_unknown_selector(r: Results) -> None:
    print("\n=== Unknown agent / preset / module ===")
    code, _ = http(
        "POST",
        "/v1/ontology/slice",
        {"organizationId": 1000, "agent": "not.a.real.agent", "product": "crm"},
    )
    if code == 400:
        r.ok("unknown agent → 400")
    else:
        r.fail("unknown agent", f"code {code}")

    code, _ = http(
        "POST",
        "/v1/ontology/slice",
        {"organizationId": 1000, "preset": "not.a.preset", "product": "ccaas"},
    )
    if code == 400:
        r.ok("unknown preset → 400")
    else:
        r.fail("unknown preset", f"code {code}")

    code, _ = http(
        "POST",
        "/v1/ontology/slice",
        {"organizationId": 1000, "modules": ["not_a_module"], "product": "crm"},
    )
    if code == 400:
        r.ok("unknown module → 400")
    else:
        r.fail("unknown module", f"code {code}")


def test_library(r: Results) -> None:
    print("\n=== Library: ontology.slice ===")
    from ontology.slice import (
        fetch_ontology_slice,
        list_agents,
        list_modules,
        list_presets,
    )

    if len(list_agents()) >= 20:
        r.ok(f"list_agents ({len(list_agents())} agents)")
    else:
        r.fail("list_agents", str(len(list_agents())))

    if len(list_modules()) >= 30:
        r.ok(f"list_modules ({len(list_modules())} modules)")
    else:
        r.fail("list_modules", str(len(list_modules())))

    if len(list_presets()) >= 20:
        r.ok(f"list_presets ({len(list_presets())} presets)")
    else:
        r.fail("list_presets", str(len(list_presets())))

    pack = fetch_ontology_slice(
        agent="ticket_lifecycle_executor", tenant="org1000", product="ticketing"
    )
    prompt = pack.as_prompt()
    if "wt:Ticket" in pack.class_ids() and "entities:" in prompt and "SupportCase" in prompt:
        r.ok("fetch by agent + tenant + product")
    else:
        r.fail("fetch by agent", str(pack.class_ids()))

    pack = fetch_ontology_slice(
        modules=["cdp", "identity"], tenant="org1000", product="cdp"
    )
    if "wt:IdentityKey" in pack.class_ids():
        r.ok("fetch by modules + cdp spine")
    else:
        r.fail("fetch by modules", str(pack.class_ids()))


def test_semantic_layer(r: Results) -> None:
    print("\n=== Semantic layer: metric certification ===")
    from semantic.lookup import get_metric_schema, is_certified, list_certified

    certified = list_certified()
    if len(certified) >= 300:
        r.ok(f"list_certified ({len(certified)} metrics)")
    else:
        r.fail("list_certified", f"only {len(certified)}")

    for mid in ["average_handle_time", "open_tickets_metric", "won_deal_rate"]:
        if is_certified(mid):
            r.ok(f"certified {mid}")
        else:
            r.fail(f"certified {mid}", "not certified")

    if not is_certified("totally_fake_metric"):
        r.ok("reject fake metric id")
    else:
        r.fail("fake metric", "should not be certified")

    try:
        get_metric_schema("average_handle_time")
        r.ok("get_metric_schema returns row")
    except ValueError as e:
        r.fail("get_metric_schema", str(e))

    # Metrics in prompt should be subset speakable via registry
    from ontology.slice import fetch_ontology_slice

    pack = fetch_ontology_slice(
        agent="cc.reporting", tenant="org1000", product="ccaas"
    )
    _, _, _, metrics, _, _ = pack._view("compact")
    if metrics:
        bad = [m for m in metrics if not is_certified(m)]
        if not bad:
            r.ok(f"cc.reporting prompt metrics all certified ({len(metrics)} ids)")
        else:
            r.fail("prompt metrics certified", f"uncertified: {bad[:5]}")
    else:
        r.ok("cc.reporting metrics allowlisted (may be empty in compact)")


def test_hub_entitlements(r: Results) -> None:
    print("\n=== Hub entitlement products (org 1008: CCaaS + CRM) ===")
    payload = {
        "organizationId": 1008,
        "products": ["contact_centre", "crm"],
        "format": "debug",
    }
    code, body = http("POST", "/v1/ontology/hub", payload)
    if code != 200:
        r.fail("hub CC+CRM", f"{code} {body}")
        return
    prompt = body.get("prompt", "")
    mods = body.get("resolved_modules") or []
    if "wt:Deal" in prompt and "wt:Customer" in prompt:
        r.ok("hub CC+CRM includes Deal and Customer")
    else:
        r.fail("hub CC+CRM types", "missing Deal or Customer")
    if "wt:Campaign" not in prompt:
        r.ok("hub CC+CRM excludes Campaign (CRM does not imply campaign)")
    else:
        r.fail("hub CC+CRM campaign leak", "wt:Campaign in prompt")
    if "wt:Ticket" not in prompt:
        r.ok("hub CC+CRM excludes Ticket (ticketing not purchased)")
    else:
        r.fail("hub CC+CRM ticket leak", "wt:Ticket in prompt")
    if "campaign_core" not in mods and "ticket" not in mods:
        r.ok("hub modules exclude campaign_core and ticket")
    else:
        r.fail("hub modules leak", str(mods))
    # no duplicate Customer lines in Types section
    types_block = prompt.split("Types")[1].split("Relations")[0] if "Types" in prompt else ""
    customer_lines = [ln for ln in types_block.splitlines() if ln.strip().startswith("- wt:Customer")]
    if len(customer_lines) == 1:
        r.ok("single wt:Customer line in prompt (no duplicate context)")
    else:
        r.fail("duplicate Customer", f"{len(customer_lines)} lines")

    code2, body2 = http(
        "POST",
        "/v1/ontology/hub",
        {
            "organizationId": 1008,
            "products": ["contact_centre", "crm", "campaign"],
            "format": "debug",
        },
    )
    if code2 == 200 and "wt:Campaign" in body2.get("prompt", ""):
        r.ok("hub with campaign product includes wt:Campaign")
    else:
        r.fail("hub with campaign", str(body2))

    code3, _ = http(
        "POST",
        "/v1/ontology/hub",
        {"organizationId": 1008, "products": []},
        enrich_body=False,
    )
    if code3 in (400, 422):
        r.ok("hub empty products → rejected")
    else:
        r.fail("hub empty products", f"code {code3}")

    code4, _ = http(
        "POST",
        "/v1/ontology/hub",
        {
            "organizationId": 1008,
            "products": ["not_a_product"],
        },
    )
    if code4 == 400:
        r.ok("hub unknown product → 400")
    else:
        r.fail("hub unknown product", f"code {code4}")

    code5, _ = http(
        "POST",
        "/v1/ontology/slice",
        {
            "organizationId": 1008,
            "agent": "crm.deals",
            "product": "crm",
            "products": ["campaign"],
        },
        enrich_body=False,
    )
    if code5 in (400, 422):
        r.ok("spoke rejects products list")
    else:
        r.fail("spoke with products list", f"code {code5}")

    code6, _ = http(
        "POST",
        "/v1/ontology/slice",
        {"organizationId": 1008, "agent": "crm.deals", "product": "ccaas"},
        enrich_body=False,
    )
    if code6 == 400:
        r.ok("agent/product mismatch → 400")
    else:
        r.fail("agent/product mismatch", f"code {code6}")

    code7, _ = http(
        "POST",
        "/v1/ontology/slice",
        {"organizationId": 1008, "agent": "crm.deals"},
        enrich_body=False,
    )
    if code7 in (400, 422):
        r.ok("spoke without product → rejected")
    else:
        r.fail("spoke without product", f"code {code7}")

    code8, _ = http(
        "POST",
        "/v1/ontology/hub",
        {"organizationId": 1008},
        enrich_body=False,
    )
    if code8 in (400, 422):
        r.ok("hub without products → rejected")
    else:
        r.fail("hub without products", f"code {code8}")

    code_hub_slice, _ = http(
        "POST",
        "/v1/ontology/slice",
        {
            "organizationId": 1008,
            "agent": "hub.orchestrator",
            "product": "crm",
        },
        enrich_body=False,
    )
    if code_hub_slice in (400, 422):
        r.ok("hub.orchestrator rejected on /slice")
    else:
        r.fail("hub on slice", f"code {code_hub_slice}")

    # ccaas alias on hub list
    code9, body9 = http(
        "POST",
        "/v1/ontology/hub",
        {
            "organizationId": 1008,
            "products": ["ccaas", "crm"],
            "format": "debug",
        },
    )
    if code9 == 200 and "wt:Interaction" in body9.get("prompt", ""):
        r.ok("hub accepts ccaas alias")
    else:
        r.fail("hub ccaas alias", str(body9))

    # library dedupe: class ids unique
    from ontology.slice import fetch_ontology_slice

    pack = fetch_ontology_slice(
        agent="hub.orchestrator",
        tenant="org1008",
        products=["contact_centre", "crm"],
    )
    ids = pack.class_ids()
    if len(ids) == len(set(ids)):
        r.ok("hub legal slice class ids deduped")
    else:
        r.fail("class id duplicates", f"{len(ids)} vs {len(set(ids))}")


def test_metric_policy_prompt(r: Results) -> None:
    print("\n=== Metric policy lines in compact prompt ===")
    code, body = http(
        "POST",
        "/v1/ontology/slice",
        {"organizationId": 1000, "agent": "crm.deals"},
    )
    prompt = body.get("prompt", "")
    if code == 200 and "ask_semantic" in prompt and "when:" in prompt:
        r.ok("crm.deals prompt includes metric policy (when/not)")
    else:
        r.fail("metric policy prompt", f"code={code}")


def test_semantic_query_gateway(r: Results) -> None:
    print("\n=== Semantic query gateway ===")
    base = {
        "organizationId": 1000,
        "userId": 1,
        "product": "crm",
        "agent": "crm.deals",
        "metrics": ["won_deal_rate"],
    }
    code, body = http("POST", "/v1/semantic/query", base, enrich_body=False)
    if code in (200, 503):
        r.ok(f"semantic query accepted or MF unavailable ({code})")
    else:
        r.fail("semantic query base", f"{code} {body}")

    code2, _ = http(
        "POST",
        "/v1/semantic/query",
        {**base, "metrics": ["totally_fake_metric"]},
        enrich_body=False,
    )
    if code2 == 400:
        r.ok("reject uncertified metric")
    else:
        r.fail("uncertified metric", f"code {code2}")

    code3, _ = http(
        "POST",
        "/v1/semantic/query",
        {**base, "metrics": ["open_tickets_metric"]},
        enrich_body=False,
    )
    if code3 == 400:
        r.ok("reject metric not on agent allowlist")
    else:
        r.fail("allowlist", f"code {code3}")

    code4, _ = http(
        "POST",
        "/v1/semantic/query",
        {
            **base,
            "group_by": ["not_a_real_dimension"],
        },
        enrich_body=False,
    )
    if code4 == 400:
        r.ok("reject unknown group_by dim")
    else:
        r.fail("group_by dim", f"code {code4}")


def test_ontology_rules(r: Results) -> None:
    print("\n=== Ontology rules (one Customer, compact allowlist) ===")
    from ontology.slice import fetch_ontology_slice

    cc = fetch_ontology_slice(
        agent="cc.ai_support", tenant="org1000", product="ccaas"
    )
    tk = fetch_ontology_slice(
        agent="ticket_lifecycle_executor", tenant="org1000", product="ticketing"
    )
    cc_ids = set(cc.class_ids())
    tk_ids = set(tk.class_ids())
    if "wt:Customer" in cc_ids and "wt:Customer" in tk_ids:
        r.ok("one wt:Customer across CC and TK")
    else:
        r.fail("wt:Customer", f"cc={cc_ids} tk={tk_ids}")

    if "wt:Ticket" in cc_ids and "wt:Ticket" in tk_ids:
        r.ok("one wt:Ticket across CC and TK")
    else:
        r.fail("wt:Ticket", "missing in cc or tk")

    crm = fetch_ontology_slice(
        agent="crm.deals", tenant="org1000", product="crm"
    )
    prompt = crm.as_prompt()
    if "entities:" in prompt and len(prompt.splitlines()) < 120:
        r.ok("crm.deals compact data YAML (<120 lines)")
    else:
        r.fail("crm.deals compact", f"{len(prompt.splitlines())} lines")

    hub = fetch_ontology_slice(
        agent="hub.orchestrator",
        tenant="org1000",
        products=["contact_centre", "ticketing", "crm", "campaign"],
    )
    hub_prompt = hub.as_prompt()
    if "SupportCase" in hub_prompt and "Opportunity" in hub_prompt:
        r.ok("hub orchestrator unions product graph labels")
    else:
        r.fail("hub graph union", hub_prompt[:200])


def main() -> int:
    print("Context Layer + Ontology + Semantic — spoke test suite")
    print(f"API base: {BASE}")

    code, _ = http("GET", "/health")
    if code != 200:
        print("\nERROR: API not running. Start with:")
        print('  ./scripts/run_context_layer_api.sh')
        return 1

    r = Results()
    test_api_infra(r)
    test_xor_validation(r)
    test_tenant_resolution(r)
    test_spoke_selectors(r)
    test_spoke_products(r)
    test_response_formats(r)
    test_tenant_overlay(r)
    test_unknown_selector(r)
    test_library(r)
    test_semantic_layer(r)
    test_hub_entitlements(r)
    test_metric_policy_prompt(r)
    test_semantic_query_gateway(r)
    test_ontology_rules(r)

    print("\n" + "=" * 60)
    print(f"PASSED: {r.passed}  FAILED: {r.failed}")
    if r.errors:
        print("\nFailures:")
        for e in r.errors:
            print(f"  - {e}")
    return 1 if r.failed else 0


if __name__ == "__main__":
    sys.exit(main())
