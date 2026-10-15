import re

with open("src/config_loader.py", "r") as f:
    content = f.read()

content = content.replace(
    "key_column: str | None = None",
    "key_column: str | None = None\n    synthesize_key: str | None = None"
)

old_norm = """        m.key_column = spec["key"] if isinstance(spec["key"], str) else spec["key"]["name"]"""
new_norm = """        m.key_column = spec["key"] if isinstance(spec["key"], str) else spec["key"]["name"]
        m.synthesize_key = spec.get("synthesize_key")"""

content = content.replace(old_norm, new_norm)

with open("src/config_loader.py", "w") as f:
    f.write(content)

with open("src/router.py", "r") as f:
    content = f.read()

old_router = """        if m.mode == "node":
            key = row.get(m.key_column)
            if key is None:
                return Quarantined("missing_key", f"column {m.key_column!r} is null")"""

new_router = """        if m.mode == "node":
            if m.synthesize_key:
                try:
                    # Treat row as a dict; fallback to empty string if a part is null
                    safe_row = {k: (v if v is not None else "") for k, v in row.items()}
                    key = m.synthesize_key.format(**safe_row)
                    row[m.key_column] = key
                except KeyError:
                    return Quarantined("missing_synthesize_parts", f"cannot format {m.synthesize_key}")
            else:
                key = row.get(m.key_column)
            if key is None:
                return Quarantined("missing_key", f"column {m.key_column!r} is null")"""

content = content.replace(old_router, new_router)

with open("src/router.py", "w") as f:
    f.write(content)

with open("src/backfill.py", "r") as f:
    content = f.read()

old_pk = """    def _primary_key_column(m) -> str | None:
        if m.mode == "node":
            return m.key_column"""

new_pk = """    def _primary_key_column(m) -> str | None:
        if m.synthesize_key:
            return None
        if m.mode == "node":
            return m.key_column"""

content = content.replace(old_pk, new_pk)

# Also fix the _backfill_table logic in backfill.py to synthesize the key!
# Wait, backfill.py directly calls router.route()!
# router.route() expects `message = {"payload": {"after": row}}`.
# router.route() unpacks the row and THEN applies synthesize_key itself!
# So backfill.py doesn't need to synthesize anything for the payload, router does it.

with open("src/backfill.py", "w") as f:
    f.write(content)

