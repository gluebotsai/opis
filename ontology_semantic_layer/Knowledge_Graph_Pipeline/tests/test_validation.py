import shutil
from pathlib import Path

import pytest

from src.config_loader import ConfigLoader
from src.errors import ConfigError
from src.validation import validate_all

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture
def cfg(tmp_path):
    """A writable copy of the real config, so tests can corrupt it."""
    dst = tmp_path / "config"
    shutil.copytree(ROOT / "config", dst)
    return dst


def errors_for(cfg) -> list[str]:
    return validate_all(ConfigLoader(cfg)).errors


def write_overlay(cfg, name: str, body: str) -> None:
    (cfg / "mappings" / f"{name}.yaml").write_text(body)


def test_shipped_config_is_valid(cfg):
    """The config we ship must pass the validator we ship. The build spec's own
    _TEMPLATE declared a HOLDS -> Policy relationship while its check 5 required
    every target_label to be a core label; Policy was neither. stub_labels fixes it."""
    report = validate_all(ConfigLoader(cfg))
    assert report.errors == []


def test_template_is_excluded_from_validation(cfg):
    assert (cfg / "mappings" / "_TEMPLATE.yaml").exists()
    assert validate_all(ConfigLoader(cfg)).errors == []


# --- check 1 ---------------------------------------------------------------

def test_extends_unknown_table(cfg):
    write_overlay(cfg, "orgtest01", """
database: orgtest01
organization_id: "test01"
products: [crm]
extends:
  crm.nonexistent:
    extra_labels: [X]
""")
    assert any("not declared in core.yaml" in e for e in errors_for(cfg))


# --- check 2 ---------------------------------------------------------------

@pytest.mark.parametrize("field,value", [("key", "other_id"), ("label", "Other"),
                                         ("mode", "node")])
def test_overlay_cannot_redeclare_identity(cfg, field, value):
    write_overlay(cfg, "orgtest02", f"""
database: orgtest02
organization_id: "test02"
products: [crm]
extends:
  crm.contacts:
    {field}: {value}
""")
    assert any(f"declares '{field}'" in e for e in errors_for(cfg))


# --- checks 3, 4, 11, 12 ---------------------------------------------------

def test_custom_property_needs_a_type(cfg):
    write_overlay(cfg, "orgtest03", """
database: orgtest03
organization_id: "test03"
products: [crm]
extends:
  crm.contacts:
    custom_properties:
      - {name: untyped}
""")
    assert any("must declare a 'type'" in e for e in errors_for(cfg))


def test_unknown_property_type_rejected(cfg):
    write_overlay(cfg, "orgtest04", """
database: orgtest04
organization_id: "test04"
products: [crm]
extends:
  crm.contacts:
    custom_properties:
      - {name: x, type: blob}
""")
    assert any("allowed types" in e for e in errors_for(cfg))


def test_decimal_without_scale_rejected(cfg):
    """NUMERIC with no scale modifier has arbitrary scale; storing it as minor
    units is impossible without an explicit declaration."""
    write_overlay(cfg, "orgtest05", """
database: orgtest05
organization_id: "test05"
products: [crm]
extends:
  crm.contacts:
    custom_properties:
      - {name: premium, type: decimal}
""")
    assert any("declares no 'scale'" in e for e in errors_for(cfg))


def test_absurd_scale_rejected_for_int64_overflow(cfg):
    write_overlay(cfg, "orgtest06", """
database: orgtest06
organization_id: "test06"
products: [crm]
extends:
  crm.contacts:
    custom_properties:
      - {name: premium, type: decimal, scale: 25}
""")
    assert any("64-bit range" in e for e in errors_for(cfg))


def test_high_scale_warns_but_passes(cfg):
    write_overlay(cfg, "orgtest07", """
database: orgtest07
organization_id: "test07"
products: [crm]
extends:
  crm.contacts:
    custom_properties:
      - {name: fx_rate, type: decimal, scale: 8}
""")
    report = validate_all(ConfigLoader(cfg))
    assert report.errors == []
    assert any("fx_rate" in w for w in report.warnings)


def test_scale_on_a_non_decimal_rejected(cfg):
    write_overlay(cfg, "orgtest08", """
database: orgtest08
organization_id: "test08"
products: [crm]
extends:
  crm.contacts:
    custom_properties:
      - {name: x, type: integer, scale: 2}
""")
    assert any("only meaningful for decimal" in e for e in errors_for(cfg))


def test_duplicate_custom_property(cfg):
    write_overlay(cfg, "orgtest09", """
database: orgtest09
organization_id: "test09"
products: [crm]
extends:
  crm.contacts:
    custom_properties:
      - {name: dup, type: string}
      - {name: dup, type: integer}
""")
    assert any("declared twice" in e for e in errors_for(cfg))


# --- check 5 ---------------------------------------------------------------

def test_relationship_to_an_undeclared_label(cfg):
    write_overlay(cfg, "orgtest10", """
database: orgtest10
organization_id: "test10"
products: [crm]
extends:
  crm.contacts:
    relationships:
      - {type: LINKED_TO, direction: out, target_label: Ghost, target_key: ghost_id,
         from_column: ghost_id}
""")
    assert any("Ghost" in e for e in errors_for(cfg))


def test_stub_label_satisfies_the_target_label_check(cfg):
    """Policy has no node mapping; it is a stub. The relationship must still validate."""
    write_overlay(cfg, "orgtest11", """
database: orgtest11
organization_id: "test11"
products: [crm]
extends:
  crm.contacts:
    relationships:
      - {type: HOLDS, direction: out, target_label: Policy, target_key: policy_id,
         from_column: policy_id}
""")
    assert errors_for(cfg) == []


def test_overlay_cannot_redefine_a_core_relationship_type(cfg):
    write_overlay(cfg, "orgtest12", """
database: orgtest12
organization_id: "test12"
products: [crm]
extends:
  crm.contacts:
    relationships:
      - {type: BELONGS_TO, direction: out, target_label: Account,
         target_key: account_id, from_column: other_id}
""")
    assert any("already defined in core" in e for e in errors_for(cfg))


# --- checks 9, 10, 16 ------------------------------------------------------

def test_filename_must_match_the_database_field(cfg):
    write_overlay(cfg, "orgtest13", """
database: orgdifferent
organization_id: "test13"
products: [crm]
""")
    assert any("these must match" in e for e in errors_for(cfg))


def test_unquoted_numeric_organisation_id_rejected(cfg):
    """YAML coerces bare 12345 to an integer, which silently breaks string lookups."""
    write_overlay(cfg, "orgtest14", """
database: orgtest14
organization_id: 12345
products: [crm]
""")
    errs = errors_for(cfg)
    assert any("Quote it" in e and "int" in e for e in errs)


def test_unquoted_yes_organisation_id_becomes_a_boolean(cfg):
    write_overlay(cfg, "orgtest15", """
database: orgtest15
organization_id: yes
products: [crm]
""")
    assert any("bool" in e for e in errors_for(cfg))


def test_filename_with_an_underscore_rejected(cfg):
    write_overlay(cfg, "org_test16", """
database: org_test16
organization_id: "test16"
products: [crm]
""")
    assert any("not a legal Neo4j database name" in e for e in errors_for(cfg))


# --- check 8 ---------------------------------------------------------------

def test_missing_raw_file(cfg):
    write_overlay(cfg, "orgtest17", """
database: orgtest17
organization_id: "test17"
products: [crm]
raw:
  crm.contacts: mappings/raw/absent.cypher
""")
    assert any("raw Cypher file not found" in e for e in errors_for(cfg))


def test_raw_file_without_batch_token(cfg):
    (cfg / "mappings" / "raw" / "bad.cypher").write_text("MATCH (n) RETURN n")
    write_overlay(cfg, "orgtest18", """
database: orgtest18
organization_id: "test18"
products: [crm]
raw:
  crm.contacts: mappings/raw/bad.cypher
""")
    assert any("$batch" in e for e in errors_for(cfg))


def test_valid_raw_file_accepted(cfg):
    (cfg / "mappings" / "raw" / "ok.cypher").write_text(
        "UNWIND $batch AS e MERGE (n:Contact {contact_id: e.key})")
    write_overlay(cfg, "orgtest19", """
database: orgtest19
organization_id: "test19"
products: [crm]
raw:
  crm.contacts: mappings/raw/ok.cypher
""")
    assert errors_for(cfg) == []


# --- checks 7, 13, 14 ------------------------------------------------------

def test_properties_on_without_prefix_rejected(cfg):
    core = cfg / "mappings" / "core.yaml"
    core.write_text(core.read_text().replace("    prefix: attr_ ", "    prefix: '' "))
    core.write_text(core.read_text().replace("prefix: attr_", "prefix: ''"))
    assert any("requires a non-empty 'prefix'" in e for e in errors_for(cfg))


def test_stub_label_disagreeing_with_node_label_key_rejected(cfg):
    core = cfg / "mappings" / "core.yaml"
    core.write_text(core.read_text().replace(
        "  Account:\n    key: account_id", "  Contact:\n    key: wrong_id"))
    assert any("disagrees with the node mapping" in e for e in errors_for(cfg))


# --- merge semantics -------------------------------------------------------

def test_overlay_adds_without_touching_core(loader):
    core_contacts = loader.core_tables["crm.contacts"]
    a = loader.effective("orga1b2c3d4").tables["crm.contacts"]
    b = loader.effective("orgb5e6f7a8").tables["crm.contacts"]
    assert a.label == b.label == core_contacts.label
    assert a.key == b.key == core_contacts.key
    assert a.extra_labels == ["Customer", "Policyholder"]
    assert b.extra_labels == ["Shopper"]
    assert core_contacts.extra_labels == []      # core must not be mutated


def test_missing_overlay_falls_back_to_core_alone(loader):
    eff = loader.effective("orgnosuchdb")
    assert eff.overlay_present is False
    assert eff.products == set()
    assert "crm.contacts" in eff.tables


def test_missing_env_var_fails_only_when_that_section_is_read(tmp_path, monkeypatch):
    """${VAR} is expanded per section, not at load time. An offline command must
    not demand a database password it will never use."""
    shutil.copytree(ROOT / "config", tmp_path / "config")
    monkeypatch.delenv("PG_PASSWORD", raising=False)
    loader = ConfigLoader(tmp_path / "config")          # constructing is fine
    with pytest.raises(ConfigError, match="PG_PASSWORD"):
        loader.section("postgres")                      # reading it is not


def test_offline_commands_work_with_an_empty_environment(tmp_path, monkeypatch):
    """validate and dry-run must run in a bare checkout with no .env at all."""
    from src.cypher_builder import build_all
    shutil.copytree(ROOT / "config", tmp_path / "config")
    for var in ("PG_HOST", "PG_PORT", "PG_DATABASE", "PG_USER", "PG_PASSWORD",
                "KAFKA_BOOTSTRAP", "NEO4J_URI", "NEO4J_USER", "NEO4J_PASSWORD"):
        monkeypatch.delenv(var, raising=False)
    loader = ConfigLoader(tmp_path / "config")
    assert validate_all(loader).errors == []            # validate
    eff = loader.effective("orga1b2c3d4")               # dry-run
    for m in eff.tables.values():
        assert build_all(m)
    assert loader.prefix == "org"                       # naming needs no secrets


def test_all_labels_includes_stubs(loader):
    labels = loader.effective("orga1b2c3d4").all_labels()
    assert labels["Contact"] == "contact_id"     # node label
    assert labels["Tag"] == "tag_id"             # stub label
    assert labels["Policy"] == "policy_id"       # stub, referenced only by an overlay
