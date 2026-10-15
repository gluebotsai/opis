from app.agents.proposal_layout import infer_content_template


def _sections_by_key(template):
    return {s["key"]: s for s in template["sections"]}


def test_spec_rows_table_grounds_comparison_kind():
    """A real >=2x2 comparison matrix in instance.tables[] is spec_rows."""
    instance = {
        "cover": {},
        "sections": [
            {
                "id": "what_we_compare",
                "heading": "What We Compare",
                "kind": "table",
                "blocks": [{"kind": "table", "table_id": "cmp"}],
            }
        ],
        "tables": [
            {
                "id": "cmp",
                "title": "Comparison",
                "headers": ["Dimension", "Requested", "Recommended"],
                "rows": [["Seats", "50", "60"], ["Channels", "Voice", "Voice+Chat"]],
            }
        ],
    }
    template = infer_content_template([instance])
    sections = _sections_by_key(template)
    spec = sections["what_we_compare"]["tableSpec"]
    assert spec["comparisonKind"] == "spec_rows"
    assert spec["columns"] == ["Dimension", "Requested", "Recommended"]


def test_thin_table_grounds_comparison_kind_as_narrative():
    """A one-row/one-column table is not a real comparison grid."""
    instance = {
        "cover": {},
        "sections": [
            {
                "id": "why_ai_native_wins",
                "heading": "Why AI-Native Wins",
                "kind": "mixed",
                "blocks": [{"kind": "table", "table_id": "thin"}],
            }
        ],
        "tables": [
            {
                "id": "thin",
                "title": "Divider",
                "headers": ["Point"],
                "rows": [["Faster time to value"]],
            }
        ],
    }
    template = infer_content_template([instance])
    sections = _sections_by_key(template)
    spec = sections["why_ai_native_wins"]["tableSpec"]
    assert spec["comparisonKind"] == "narrative"


def test_prose_section_with_no_table_defaults_to_narrative():
    instance = {
        "cover": {},
        "sections": [
            {
                "id": "why_ai_native_wins",
                "heading": "Why AI-Native Wins",
                "kind": "mixed",
                "blocks": [{"kind": "prose", "text": "Reasons this wins, no table."}],
            }
        ],
        "tables": [],
    }
    template = infer_content_template([instance])
    sections = _sections_by_key(template)
    spec = sections["why_ai_native_wins"]["tableSpec"]
    assert spec["comparisonKind"] == "narrative"


if __name__ == "__main__":
    test_spec_rows_table_grounds_comparison_kind()
    test_thin_table_grounds_comparison_kind_as_narrative()
    test_prose_section_with_no_table_defaults_to_narrative()
    print("test_proposal_layout_table_shape.py ok")
