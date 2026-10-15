import pytest
from src.naming import (constraint_name, make_database_name, quote_db,
                        safe_property_name)


def test_underscore_is_stripped_not_preserved():
    # "org_123" would be ILLEGAL as a Neo4j database name.
    assert make_database_name("org", "123") == "org123"
    assert "_" not in make_database_name("or_g", "1_2_3")


def test_uuid_dashes_stripped():
    assert make_database_name("org", "a1b2c3d4-0000-1111-2222-333344445555") == \
        "orga1b2c3d4000011112222333344445555"


def test_lowercased():
    assert make_database_name("ORG", "A1B2") == "orga1b2"


def test_must_start_with_letter():
    with pytest.raises(ValueError, match="start with a letter"):
        make_database_name("123", "abc")


def test_too_short():
    with pytest.raises(ValueError, match="length out of range"):
        make_database_name("o", "1")


def test_overflow_uses_hash_suffix_not_truncation():
    long_id = "a" * 200
    name = make_database_name("org", long_id)
    assert len(name) == 63
    # Deterministic across calls -- the database must resolve identically on restart.
    assert name == make_database_name("org", long_id)


def test_overflow_ids_sharing_a_prefix_do_not_collide():
    # Plain truncation (as the build spec suggested) would map these to ONE
    # database and silently merge two tenants' graphs.
    a = make_database_name("org", "x" * 100 + "aaaa")
    b = make_database_name("org", "x" * 100 + "bbbb")
    assert a != b


def test_reserved_names_rejected():
    with pytest.raises(ValueError, match="reserved"):
        make_database_name("sys", "tem")


def test_empty_id_rejected():
    with pytest.raises(ValueError):
        make_database_name("org", "---")


def test_quote_db():
    assert quote_db("orga1b2") == "`orga1b2`"
    with pytest.raises(ValueError):
        quote_db("bad`name")


def test_safe_property_name_blocks_injection():
    # A property name is interpolated into Cypher (it cannot be parameterised),
    # so every character that could break out of the backticks must be neutralised.
    out = safe_property_name("attr_x`} REMOVE n.y //")
    assert out.startswith("attr_x")
    assert not (set(out) - set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_"))
    for dangerous in ("`", ".", " ", "/", "}"):
        assert dangerous not in out


def test_constraint_name_stable():
    assert constraint_name("Contact", "contact_id") == "contact_contact_id"
