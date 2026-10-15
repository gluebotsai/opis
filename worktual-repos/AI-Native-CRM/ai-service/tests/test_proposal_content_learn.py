from tests._load_agent_module import load_agent_module
import asyncio
import json

case_study = load_agent_module("proposal_corpus_case_study_agent.py")
synthesize = load_agent_module("proposal_playbook_synthesize_agent.py")
generate_section = load_agent_module("proposal_generate_section_agent.py")
content_qa = load_agent_module("proposal_content_qa_agent.py")


def test_case_study_heuristic_reads_proposal_sections():
    out = case_study._heuristic(
        {
            "requirement": {"fullText": "Need CRM integration for 50 seats."},
            "proposal": {
                "fullText": "We propose CRM with integrations " + ("prose " * 2000),
                "pageCount": 8,
                "sections": [
                    {"key": "scope", "title": "Scope", "body": "Fifty seats of CRM."},
                ],
            },
        }
    )
    assert out["sectionAnalysis"][0]["sectionKey"] == "scope"
    assert out["lengthAnalysis"]["proposalPageCount"] == 8
    assert out["lengthAnalysis"]["requirementWordCount"] > 0
    assert out["lengthAnalysis"]["proposalWordCount"] > 1500


def test_case_study_canonicalizes_heading_keys():
    out = case_study._heuristic(
        {
            "requirement": {"fullText": "Need a contact centre."},
            "proposal": {
                "fullText": "Overview of the contact centre.",
                "sections": [
                    {
                        "key": "Executive Summary",
                        "title": "Executive Summary",
                        "body": "We propose CCaaS.",
                    }
                ],
            },
        }
    )
    assert out["sectionAnalysis"][0]["sectionKey"] == "overview"


def test_case_study_backfills_sections_the_llm_skipped():
    """LLM only analyzes the overview; code must still cover the table
    section and the closing note so downstream length-planning never treats
    them as zero learned signal (this was the real blocker behind 4 of 7
    broken keys, not a slugging problem)."""
    proposal = {
        "fullText": "Full proposal text. " * 50,
        "pageCount": 4,
        "sections": [
            {
                "id": "s1",
                "heading": "Overview",
                "kind": "prose",
                "blocks": [{"kind": "prose", "text": "We propose CCaaS."}],
            },
            {
                "id": "s2",
                "heading": "Comparison of Options",
                "kind": "table",
                "blocks": [{"kind": "table", "table_id": "t1"}],
            },
            {
                "id": "s3",
                "heading": "Note for Vbike",
                "kind": "prose",
                "blocks": [{"kind": "prose", "text": "Thank you, Vbike team."}],
            },
        ],
        "tables": [
            {
                "id": "t1",
                "title": "Comparison",
                "headers": ["Item", "Requested", "Recommended"],
                "rows": [["Seats", "50", "60"]],
            }
        ],
    }

    async def fake_generate_ai_text(**_kwargs):
        return json.dumps(
            {
                "sectionAnalysis": [
                    {
                        "sectionKey": "overview",
                        "sourceRequirementRefs": ["seats"],
                        "wordCount": 40,
                        "toneRegister": "consultative",
                        "specificityLevel": "high",
                        "provenance": "paraphrased_from_brd",
                        "elaborationSignal": "expanded",
                    }
                ],
                "lengthAnalysis": {
                    "requirementWordCount": 6,
                    "requirementComplexityScore": 0.4,
                    "proposalPageCount": 4,
                    "proposalWordCount": 300,
                },
            }
        )

    case_study.is_ai_configured = lambda: True
    case_study.generate_ai_text = fake_generate_ai_text
    out = asyncio.run(
        case_study.run(
            {
                "requirement": {"fullText": "Need CCaaS with 50 seats."},
                "proposal": proposal,
            }
        )
    )
    assert out["source"] == "ai"
    rows = {row["sectionKey"]: row for row in out["sectionAnalysis"]}
    # "Note for Vbike" generalizes to note_for_client via the dedicated
    # note_for_* normalization rule (proposal_section_keys.py), not a
    # one-off alias for this customer's name.
    assert set(rows) == {"overview", "comparison_of_options", "note_for_client"}
    assert rows["overview"]["source"] == "llm"
    assert rows["comparison_of_options"]["source"] == "heuristic_backfill"
    assert rows["comparison_of_options"]["wordCount"] > 0
    assert rows["note_for_client"]["source"] == "heuristic_backfill"


def test_synthesize_canonicalizes_spec_keys():
    mapped = synthesize.specs_to_map(
        [{"key": "cover_and_overview", "purpose": "intro", "targetWordRange": [40, 120]}]
    )
    assert "overview" in mapped
    assert "cover_and_overview" not in mapped


def test_case_study_does_not_keep_sparse_pdf_page_count():
    measured = case_study.measure_proposal_length(
        {"fullText": "Need a contact centre."},
        {"fullText": "Logo page. " * 20, "pageCount": 11},
    )
    assert measured["proposalPageCount"] == 1
    assert measured["requirementWordCount"] == 4


def test_synthesize_specs_to_map_accepts_list():
    mapped = synthesize.specs_to_map(
        [{"key": "scope", "purpose": "scope", "targetWordRange": [80, 200]}]
    )
    assert "scope" in mapped
    nested = synthesize.specs_to_map(
        {"sectionSpecs": {"overview": {"purpose": "intro", "targetWordRange": [40, 120]}}}
    )
    assert "overview" in nested


def test_synthesize_is_append_ready_json():
    out = synthesize._heuristic(
        [
            {
                "id": "cs1",
                "sectionAnalysis": [
                    {
                        "sectionKey": "scope",
                        "wordCount": 220,
                        "toneRegister": "consultative",
                        "specificityLevel": "high",
                    }
                ],
            },
            {
                "id": "cs2",
                "sectionAnalysis": [
                    {
                        "sectionKey": "scope",
                        "wordCount": 280,
                        "toneRegister": "formal",
                        "specificityLevel": "high",
                    }
                ],
            },
        ]
    )
    assert "scope" in out["sectionSpecs"]
    assert out["lengthModel"]["coefficients"]["perThousandWords"] == 1.2
    assert out["varianceLog"]["scope"]["wordMin"] == 220
    assert out["varianceLog"]["scope"]["wordMax"] == 280


def test_generate_section_offline_is_heuristic():
    generate_section.proposal_gemini_configured = lambda: False
    generate_section.is_ai_configured = lambda: False
    out = asyncio.run(
        generate_section.run(
            {"sectionKey": "scope", "heading": "Scope", "requirementText": "50 seats"}
        )
    )
    assert out["source"] == "heuristic"
    assert out["section"]["key"] == "scope"
    assert out["section"]["body"]


def test_generate_section_uses_schema_json():
    captured: dict = {}

    class _Draft:
        def model_dump(self):
            return {
                "key": "scope",
                "heading": "Scope",
                "body": ("Positron needs a contact-centre workflow. " * 40).strip(),
                "kind": "prose",
                "tableRows": [],
            }

    async def fake_generate_json(_prompt, _schema, **kwargs):
        captured["thinking_level"] = kwargs.get("thinking_level")
        captured["schema"] = getattr(_schema, "__name__", str(_schema))
        captured["extra"] = kwargs.get("extra_text") or ""
        captured["prompt"] = _prompt
        return _Draft()

    generate_section.proposal_gemini_configured = lambda: True
    generate_section.generate_json = fake_generate_json
    out = asyncio.run(
        generate_section.run(
            {
                "sectionKey": "scope",
                "heading": "Scope",
                "targetWords": 175,
                "requirementText": "Positron BRD for CCaaS.",
            }
        )
    )
    assert out["source"] == "ai"
    assert captured.get("thinking_level") == "low"
    assert captured.get("schema") == "SectionDraft"
    assert "Positron" in out["section"]["body"]
    assert len(out["section"]["body"].split()) > 80


def test_generate_section_asks_for_table_rows_when_table_spec():
    captured: dict = {}

    class _Draft:
        def model_dump(self):
            return {
                "key": "inclusions",
                "heading": "Inclusions",
                "body": ("The inclusions for this Positron engagement follow the BRD. " * 20).strip(),
                "kind": "mixed",
                "tableRows": [
                    {"cells": ["Proactive Contact Centre", "As requested", "Included"]},
                ],
            }

    async def fake_generate_json(_prompt, _schema, **kwargs):
        captured["prompt"] = _prompt
        captured["extra"] = kwargs.get("extra_text") or ""
        return _Draft()

    generate_section.proposal_gemini_configured = lambda: True
    generate_section.generate_json = fake_generate_json
    out = asyncio.run(
        generate_section.run(
            {
                "sectionKey": "inclusions",
                "heading": "Inclusions",
                "targetWords": 120,
                "requirementText": "Positron needs a contact centre.",
                "tableSpec": {
                    "shape": "grid",
                    "columns": ["Item", "Requested", "Recommended"],
                },
            }
        )
    )
    assert out["source"] == "ai"
    assert "tableRows" in captured.get("prompt", "")
    assert "Item" in captured.get("extra", "")
    assert out["section"]["tableRows"][0]["cells"][0] == "Proactive Contact Centre"


def test_content_qa_offline_does_not_fail_sections():
    content_qa.is_ai_configured = lambda: False
    out = asyncio.run(
        content_qa.run(
            {
                "sectionSpecs": {"scope": {"purpose": "scope"}},
                "sections": [{"key": "scope", "body": "Hello"}],
            }
        )
    )
    assert out["source"] == "heuristic"
    assert out["failedSectionKeys"] == []


if __name__ == "__main__":
    test_case_study_heuristic_reads_proposal_sections()
    test_case_study_backfills_sections_the_llm_skipped()
    test_case_study_does_not_keep_sparse_pdf_page_count()
    test_synthesize_specs_to_map_accepts_list()
    test_synthesize_is_append_ready_json()
    test_generate_section_offline_is_heuristic()
    test_generate_section_uses_schema_json()
    test_generate_section_asks_for_table_rows_when_table_spec()
    test_content_qa_offline_does_not_fail_sections()
    print("test_proposal_content_learn.py ok")
