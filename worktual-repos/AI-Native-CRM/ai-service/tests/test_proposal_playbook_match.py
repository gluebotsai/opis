from app.agents.proposal_playbook_match_agent import _floor_match_confidence


def test_single_playbook_is_not_near_zero():
    assert _floor_match_confidence(0.1, playbook_count=1) >= 0.7


def test_retrieve_score_floors_multi_playbook():
    assert _floor_match_confidence(0.1, playbook_count=3, retrieve_score=0.4) >= 0.4
