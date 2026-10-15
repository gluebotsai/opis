"""Neo4j database naming.  Spec section 2.1.

Neo4j database name rules:
  - ASCII alphanumerics, dots and dashes only.  NO underscores.
  - Must start with an ASCII letter.
  - Cannot end with a dot or dash.
  - 3-63 characters.
  - Case-insensitive, normalised to lowercase.

We emit alphanumerics only -- no dots, no dashes -- which sidesteps the
"a dash is legal in the name but illegal in unquoted Cypher" trap entirely.
``quote_db`` is still applied everywhere so that the invariant holds even if
a future prefix policy reintroduces dashes.
"""

import hashlib
import re

MIN_LEN = 3
MAX_LEN = 63
_HASH_LEN = 8

# System-reserved and pipeline-reserved names that must never be handed to a tenant.
RESERVED_NAMES = frozenset({"system", "neo4j", "cdcmeta"})


def make_database_name(prefix: str, organization_id: str) -> str:
    """Derive a legal Neo4j database name from a prefix and an organisation id.

    On overflow past 63 characters the id portion is truncated and an 8-hex-char
    SHA-1 of the *original* organisation id is appended.  Plain truncation (as the
    build spec suggested) is unsafe: two UUIDs sharing a long prefix would collide
    onto the same database name and silently merge two tenants' graphs -- the exact
    failure this architecture exists to prevent.  The digest makes collision
    negligible while keeping the mapping deterministic across restarts.
    """
    clean_prefix = re.sub(r"[^a-z0-9]", "", str(prefix).lower())
    clean_id = re.sub(r"[^a-z0-9]", "", str(organization_id).lower())

    if not clean_prefix:
        raise ValueError(
            f"prefix {prefix!r} contains no alphanumeric characters; "
            "a database name must start with a letter"
        )
    if not clean_id:
        raise ValueError(
            f"organization_id {organization_id!r} contains no alphanumeric characters"
        )

    name = f"{clean_prefix}{clean_id}"

    if len(name) > MAX_LEN:
        digest = hashlib.sha1(str(organization_id).encode("utf-8")).hexdigest()[:_HASH_LEN]
        keep = MAX_LEN - len(clean_prefix) - _HASH_LEN
        if keep < 1:
            raise ValueError(
                f"prefix {prefix!r} is too long to leave room for an id "
                f"(max prefix length is {MAX_LEN - _HASH_LEN - 1})"
            )
        name = f"{clean_prefix}{clean_id[:keep]}{digest}"

    if not name[0].isalpha():
        raise ValueError(f"database name must start with a letter: {name}")
    if not (MIN_LEN <= len(name) <= MAX_LEN):
        raise ValueError(f"database name length out of range ({MIN_LEN}-{MAX_LEN}): {name}")
    if name in RESERVED_NAMES:
        raise ValueError(f"database name {name!r} is reserved")

    return name


def quote_db(name: str) -> str:
    """Backtick-quote a database name for use in DDL.

    Always applied, even when the name contains no dash, so that DDL construction
    has exactly one code path.
    """
    if "`" in name:
        raise ValueError(f"illegal backtick in database name: {name!r}")
    return f"`{name}`"


def safe_property_name(raw: str) -> str:
    """Sanitise a dynamically-derived property name for literal Cypher embedding.

    Used by ``properties_on`` REMOVE, where the property name comes from a data
    row and Cypher cannot parameterise a property key.  Anything outside
    [A-Za-z0-9_] becomes an underscore, so no data value can inject Cypher.
    """
    cleaned = re.sub(r"[^A-Za-z0-9_]", "_", str(raw))
    if not cleaned:
        raise ValueError(f"property name {raw!r} sanitises to an empty string")
    return cleaned


def constraint_name(label: str, key: str) -> str:
    """Deterministic, idempotent-safe constraint name."""
    return safe_property_name(f"{label}_{key}").lower()
