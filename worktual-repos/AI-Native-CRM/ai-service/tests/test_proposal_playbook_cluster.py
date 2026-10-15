from app.agents.proposal_playbook_cluster_agent import _heuristic_clusters, _normalize


def test_heuristic_keeps_similar_pdfs_together():
    clusters = _heuristic_clusters(
        [
            {"itemId": "a", "coverStyle": "left", "pricingShape": "line_items"},
            {"itemId": "b", "coverStyle": "left", "pricingShape": "line_items"},
        ]
    )
    assert len(clusters) == 1
    assert clusters[0]["proposalItemIds"] == ["a", "b"]


def test_heuristic_splits_mixed_styles():
    clusters = _heuristic_clusters(
        [
            {"itemId": "purity", "coverStyle": "left", "pricingShape": "line_items"},
            {"itemId": "orange", "coverStyle": "banner", "pricingShape": "tiered"},
        ]
    )
    assert len(clusters) == 2


def test_normalize_assigns_leftovers():
    out = _normalize(
        [{"name": "A", "tags": ["left"], "proposalItemIds": ["a"]}],
        ["a", "b"],
    )
    assert set(out[0]["proposalItemIds"]) == {"a", "b"}
