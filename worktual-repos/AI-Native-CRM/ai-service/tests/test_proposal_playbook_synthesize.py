from app.agents.proposal_playbook_qa_agent import _rule_gate
from app.agents.proposal_playbook_synthesize_agent import _heuristic


def test_heuristic_builds_section_specs_from_case_studies():
    out = _heuristic(
        [
            {
                "id": "cs1",
                "sectionAnalysis": [
                    {
                        "sectionKey": "technical_approach",
                        "wordCount": 400,
                        "toneRegister": "consultative",
                        "specificityLevel": "high",
                    }
                ],
            }
        ]
    )
    assert "technical_approach" in out["sectionSpecs"]
    assert out["lengthModel"]["coefficients"]["intercept"] == 4
    assert out["varianceLog"]["technical_approach"]["wordMax"] == 400


def test_rule_gate_requires_skeleton_and_complete_css():
    pattern = (
        "Open with the requested solution heading, then a comparison table "
        "and a closing scope note for the current customer."
    )
    css = (
        ".proposal-blueprint{font-family:Arial;font-size:12px;padding:16mm}"
        ".proposal-blueprint .bp-cover-title{font-size:24px;font-weight:700}"
        ".proposal-blueprint .bp-h2{font-size:14px;font-weight:700}"
        ".proposal-blueprint .bp-table th{padding:8px;background:#0f2942}"
    )
    html = (
        '<div class="bp-playbook-root">'
        '<header class="bp-playbook-cover"><h1 class="bp-cover-title">{{documentTitle}}</h1></header>'
        '<section data-slot="requested_solution"></section>'
        '<section data-slot="one_time_charges"></section>'
        '<section data-slot="assumptions"></section>'
        "</div>"
    )
    ok, score, reasons = _rule_gate(
        {
            "sections": [
                {"key": "requested_solution", "title": "Requested Solution", "contentPattern": pattern},
                {"key": "one_time_charges", "title": "One-time charges", "contentPattern": pattern},
                {"key": "assumptions", "title": "Assumptions", "contentPattern": pattern},
            ],
            "format": {
                "source": "gemini_design",
                "headingColor": "#0f2942",
            },
            "blueprint": {"html": html, "css": css},
        }
    )
    assert ok is True
    assert score >= 0.7
    assert reasons == []

    fail_ok, _, fail_reasons = _rule_gate(
        {
            "sections": [
                {"key": "requested_solution", "title": "Requested Solution", "contentPattern": pattern},
                {"key": "one_time_charges", "title": "One-time charges", "contentPattern": pattern},
                {"key": "assumptions", "title": "Assumptions", "contentPattern": pattern},
            ],
            "format": {
                "source": "gemini_design",
                "headingColor": "#0f2942",
            },
            "blueprint": {"html": "", "css": ".proposal-blueprint{font-size:11px}"},
        }
    )
    assert fail_ok is False
    assert any("skeleton" in r.lower() or "css" in r.lower() for r in fail_reasons)
