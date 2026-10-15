"""Official Google Product Taxonomy — secondary id space only.

We do NOT use unofficial Python matchers. Google category ids are looked up
from Shopify's integrations.all_mappings when possible; this module parses the
official taxonomy-with-ids.en-US.txt for validation and path→id resolution.
"""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

STEWARD_ROOT = Path(__file__).resolve().parent.parent
GOOGLE_PATH = STEWARD_ROOT / "taxonomies" / "google" / "taxonomy-with-ids.en-US.txt"

_LINE_RE = re.compile(r"^(\d+)\s+-\s+(.+)$")


@lru_cache(maxsize=1)
def _load_index() -> tuple[dict[str, int], dict[int, str]]:
    by_path: dict[str, int] = {}
    by_id: dict[int, str] = {}
    if not GOOGLE_PATH.exists():
        return by_path, by_id
    with GOOGLE_PATH.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or line.startswith("Google"):
                continue
            m = _LINE_RE.match(line)
            if not m:
                continue
            gid, path = int(m.group(1)), m.group(2).strip()
            by_path[path.lower()] = gid
            by_id[gid] = path
    return by_path, by_id


def id_for_path(path: str) -> int | None:
    by_path, _ = _load_index()
    return by_path.get(path.strip().lower())


def path_for_id(gid: int | str) -> str | None:
    _, by_id = _load_index()
    try:
        return by_id.get(int(gid))
    except (TypeError, ValueError):
        return None


def validate_google_id(gid: str | int) -> bool:
    _, by_id = _load_index()
    try:
        return int(gid) in by_id
    except (TypeError, ValueError):
        return False
