from app.mcp.servers.contact import (
    coerce_is_active,
    group_same_name_contacts,
    match_contacts_by_query,
    meaningful_field_changes,
    phones_equivalent,
)


def test_coerce_is_active_accepts_labels() -> None:
    assert coerce_is_active(False) is False
    assert coerce_is_active("Inactive") is False
    assert coerce_is_active("Active") is True
    assert coerce_is_active("") is None


def test_phones_equivalent_ignores_country_prefix() -> None:
    assert phones_equivalent("9007788990", "919007788990") is True
    assert phones_equivalent("+91 90077 88990", "9007788990") is True
    assert phones_equivalent("9007788990", "9005566778") is False


def test_match_contacts_by_full_name_and_reversed_tokens() -> None:
    candidates = [
        {"fullName": "Sanju Ravi", "primaryEmail": "sanju@worktual.local"},
        {"fullName": "Kavya Flowtest", "primaryEmail": "kavya@worktual.local"},
    ]
    matches = match_contacts_by_query(candidates, None, "Sanju Ravi")
    assert [contact["primaryEmail"] for contact in matches] == ["sanju@worktual.local"]

    reversed_matches = match_contacts_by_query(candidates, None, "Ravi Sanju")
    assert [contact["primaryEmail"] for contact in reversed_matches] == ["sanju@worktual.local"]


def test_match_contacts_keeps_same_name_people_for_email_confirm() -> None:
    candidates = [
        {"fullName": "Sanju Ravi", "primaryEmail": "sanju@worktual.local"},
        {"fullName": "Sanju Ravi", "primaryEmail": "sanju.ops@worktual.local"},
    ]
    matches = match_contacts_by_query(candidates, None, "Sanju Ravi")
    assert [contact["primaryEmail"] for contact in matches] == [
        "sanju@worktual.local",
        "sanju.ops@worktual.local",
    ]
    email_match = match_contacts_by_query(candidates, "sanju.ops@worktual.local", None)
    assert [contact["primaryEmail"] for contact in email_match] == ["sanju.ops@worktual.local"]


def test_group_same_name_contacts_returns_email_options() -> None:
    grouped = group_same_name_contacts(
        [
            {"fullName": "Sanju Ravi", "primaryEmail": "sanju@worktual.local"},
            {"fullName": "Sanju Ravi", "primaryEmail": "sanju.ops@worktual.local"},
            {"fullName": "Kavya Flowtest", "primaryEmail": "kavya@worktual.local"},
        ]
    )
    assert len(grouped) == 1
    assert grouped[0]["name"] == "Sanju Ravi"
    assert [contact["primaryEmail"] for contact in grouped[0]["contacts"]] == [
        "sanju@worktual.local",
        "sanju.ops@worktual.local",
    ]


def test_meaningful_field_changes_drops_equivalent_phone_prefix() -> None:
    patch = meaningful_field_changes(
        {
            "city": "Chennai",
            "primaryPhone": "9007788990",
            "isActive": True,
        },
        {
            "city": "Bengaluru",
            "primaryPhone": "919007788990",
            "isActive": "Active",
        },
    )
    assert patch == {"city": "Bengaluru"}
