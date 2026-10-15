from reports_analytics_agent_CRM_B2B.core.grounding import extract_numbers_from_text, verify_grounding

def test_extract_numbers():
    text = "We have 42 deals worth $150,000.50 with a 65.5% win rate."
    numbers = extract_numbers_from_text(text)
    assert 42.0 in numbers
    assert 150000.50 in numbers
    assert 65.5 in numbers

def test_verify_grounding_valid():
    text = "Total pipeline is $150,000 across 25 deals."
    grounded = [150000.0, 25.0]
    is_grounded, ungrounded = verify_grounding(text, grounded)
    assert is_grounded
    assert len(ungrounded) == 0

def test_verify_grounding_hallucination():
    text = "We achieved $999,999 revenue."
    grounded = [150000.0, 25.0]
    is_grounded, ungrounded = verify_grounding(text, grounded)
    assert not is_grounded
    assert 999999.0 in ungrounded
