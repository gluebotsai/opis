from app.agents.proposal_corpus_structure_agent import (
    _min_sections,
    _normalize_sections,
    _page_text_blob,
)


def test_requirement_outline_allows_one_section():
    assert _min_sections("requirement") == 1
    assert _min_sections("proposal") == 2


def test_page_text_blob_ignores_page_html():
    blob = _page_text_blob(
        [
            {
                "n": 1,
                "text": "Scope and objectives",
                "pageHtml": "<div class='pdf-text'>" + ("x" * 20_000) + "</div>",
            }
        ],
        "",
    )
    assert "Scope and objectives" in blob
    assert "pdf-text" not in blob
    assert len(blob) < 5_000


def test_normalize_sections_drops_page_n_placeholders():
    out = _normalize_sections(
        [
            {"key": "scope", "title": "Scope"},
            {"key": "section_2", "title": "Page 2"},
            "bad",
        ]
    )
    assert [s["key"] for s in out] == ["scope"]
