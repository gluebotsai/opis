from app.agents.proposal_section_keys import (
    canonicalize_section_key,
    canonicalize_section_specs,
)


def test_exact_aliases_still_work():
    assert canonicalize_section_key("Executive Summary") == "overview"
    assert canonicalize_section_key("cover_and_overview") == "overview"
    assert canonicalize_section_key("Proposed Solution") == "requested_solution"
    assert canonicalize_section_key("Recommended Solution") == "requested_solution"
    assert canonicalize_section_key("Solution Architecture") == "architecture"
    assert canonicalize_section_key("Implementation Plan") == "rollout"


def test_containment_rule_collapses_longer_headings():
    assert (
        canonicalize_section_key("Key Considerations & Assumptions")
        == "considerations"
    )
    assert (
        canonicalize_section_key("Requested Solution & Approach")
        == "requested_solution"
    )
    assert (
        canonicalize_section_key("Recommended Solution Overview")
        == "requested_solution"
    )


def test_containment_rule_requires_a_real_word_boundary():
    # "Unrequested Solutions" contains the literal characters but not the
    # canonical key as a whole underscore-delimited word — must not collapse.
    assert canonicalize_section_key("Unrequested Solutions") == "unrequested_solutions"


def test_note_for_normalization_strips_customer_name():
    assert canonicalize_section_key("Note for Vbike") == "note_for_client"
    assert canonicalize_section_key("Note for Acme Corp") == "note_for_client"
    assert canonicalize_section_key("note_for_client") == "note_for_client"
    assert canonicalize_section_key("a_note_for_vbike") == "note_for_client"


def test_canonicalize_section_specs_maps_customer_note_key():
    specs = canonicalize_section_specs(
        {
            "sectionSpecs": {
                "a_note_for_vbike": {
                    "targetWordRange": [100, 200],
                    "purpose": "close",
                }
            }
        }
    )
    assert "note_for_client" in specs
    assert specs["note_for_client"]["targetWordRange"] == [100, 200]


if __name__ == "__main__":
    test_exact_aliases_still_work()
    test_containment_rule_collapses_longer_headings()
    test_containment_rule_requires_a_real_word_boundary()
    test_note_for_normalization_strips_customer_name()
    test_canonicalize_section_specs_maps_customer_note_key()
    print("test_proposal_section_keys.py ok")
