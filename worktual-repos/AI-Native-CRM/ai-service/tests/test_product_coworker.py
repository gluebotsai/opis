"""Product co-worker intent routing — create vs edit vs search."""

from __future__ import annotations

from app.agents.product_coworker_agent import (
    _wants_create,
    _wants_edit,
    products_heuristic,
    resolve_product_match,
)


def test_want_to_edit_is_not_create():
    assert _wants_edit("i want to edit product")
    assert not _wants_create("i want to edit product")
    assert not _wants_create("edit product")


def test_create_phrases_still_match():
    assert _wants_create("create a new product")
    assert _wants_create("help me create a product")
    assert _wants_create("add a product")
    assert not _wants_create("i want to edit product")


def test_add_field_is_update_not_create():
    assert _wants_edit("add a price")
    assert not _wants_create("add a price")
    assert _wants_edit("add a sku")
    assert not _wants_create("add a sku")
    assert _wants_create("create a product")
    r = products_heuristic(
        "add a price",
        {"module": "product", "surface": "list"},
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert not any(
        p.get("name") == "set_workspace" and (p.get("args") or {}).get("mode") == "create"
        for p in props
    )


def test_insert_product_opens_create():
    r = products_heuristic(
        "insert product",
        {"module": "product", "surface": "list"},
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props and props[0]["name"] == "set_workspace"
    assert props[0]["args"]["mode"] == "create"
    assert "name" in r["assistantText"].lower()


def test_edit_asks_which_product():
    r = products_heuristic("i want to edit product", {"module": "product", "surface": "list"})
    assert r and r["ok"]
    assert "which product" in r["assistantText"].lower()
    assert not r.get("toolProposals")


def test_edit_with_name_opens_unique_match():
    catalog = {
        "products": [
            {"id": "p1", "name": "Pro Plan", "sku": "PRO-1", "price": "99"},
        ]
    }
    r = products_heuristic(
        "edit product pro plan",
        {"module": "product", "surface": "list"},
        catalog=catalog,
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props and props[0]["name"] == "set_workspace"
    assert props[0]["args"]["mode"] == "detail"
    assert props[0]["args"]["entityId"] == "p1"


def test_delete_asks_which_product():
    r = products_heuristic("delete product", {"module": "product", "surface": "list"})
    assert r and r["ok"]
    assert "which product" in r["assistantText"].lower()


def test_delete_followup_opens_for_confirm():
    catalog = {
        "products": [{"id": "p1", "name": "Pro Plan", "sku": "PRO-1", "price": "99"}]
    }
    messages = [
        {"role": "user", "text": "delete product"},
        {
            "role": "assistant",
            "text": "Which product would you like to delete? Share a name or SKU.",
        },
        {"role": "user", "text": "pro plan"},
    ]
    r = products_heuristic(
        "pro plan",
        {"module": "product", "surface": "list"},
        messages=messages,
        catalog=catalog,
    )
    assert r and r["ok"]
    assert "remove" in r["assistantText"].lower()
    props = r.get("toolProposals") or []
    assert props[0]["args"]["entityId"] == "p1"


def test_delete_this_product_on_detail_executes():
    catalog = {
        "products": [{"id": "p1", "name": "Pro Plan", "sku": "PRO-1", "price": "99"}]
    }
    messages = [
        {
            "role": "assistant",
            "text": "I found **Pro Plan**. Want me to remove it permanently?",
        },
        {"role": "user", "text": "delete this product"},
    ]
    r = products_heuristic(
        "delete this product",
        {"module": "product", "surface": "detail", "entityId": "p1"},
        messages=messages,
        catalog=catalog,
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props[0]["name"] == "propose_delete_product"
    assert props[0]["args"]["productId"] == "p1"
    assert props[0]["args"]["auto"] is True


def test_price_update_on_detail_proposes_tool():
    r = products_heuristic(
        "price to 99",
        {"module": "product", "surface": "detail", "entityId": "p1"},
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props[0]["name"] == "propose_update_product"
    assert props[0]["args"]["price"] == "99"


def test_resolve_sku_match():
    hit = resolve_product_match(
        {"products": [{"id": "p1", "name": "Pro Plan", "sku": "PRO-1"}]},
        "PRO-1",
    )
    assert hit and hit["id"] == "p1"


def test_memory_first_delete_product_without_this_keyword():
    r = products_heuristic(
        "delete",
        {"module": "product", "surface": "detail", "entityId": "p1"},
        catalog={"products": [{"id": "p1", "name": "Pro"}]},
    )
    assert r and r["ok"]
    props = r.get("toolProposals") or []
    assert props[0]["name"] == "propose_delete_product"
    assert props[0]["args"]["productId"] == "p1"
