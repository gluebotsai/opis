from app.agents.proposal_playbook_freeze_agent import _display_section_title
from app.agents.proposal_render_html import render_skeleton_html


def test_display_section_title_strips_regex() -> None:
    assert _display_section_title("^Overview$") == "Overview"
    assert (
        _display_section_title("^Requested Solution — As specified by the.*")
        == "Requested Solution"
    )
    assert _display_section_title("Considerations") == "Considerations"


def test_skeleton_cover_uses_gold_document_title_not_product_scope() -> None:
    html = render_skeleton_html(
        {"sections": []},
        theme_css="",
        gold_cover={
            "brand": "WORKTUAL",
            "title": "Commercial Proposal",
            "product_tags": ["Proactive Contact Centre", "Cognitive CDP"],
            "tag_layout": "centered_wrap",
            "meta_rows": [],
        },
    )
    assert "Commercial Proposal" in html
    assert "{{dealTitle}}" not in html
    assert "bp-cover-title" in html
    assert "data-slot-tags" in html
    assert "{{productScope}}" not in html


def test_skeleton_cover_tokenizes_gold_meta_rows() -> None:
    html = render_skeleton_html(
        {"sections": []},
        theme_css="",
        gold_cover={
            "title": "Commercial Proposal",
            "meta_rows": [
                {"label": "Client", "value": "VBike"},
                {"label": "Document", "value": "Commercial Proposal"},
                {"label": "Validity", "value": "This quote is valid for 14 days only"},
            ],
        },
    )
    assert "cover-meta" in html
    assert "{{customerName}}" in html
    assert "VBike" not in html
    assert "14 days" in html
