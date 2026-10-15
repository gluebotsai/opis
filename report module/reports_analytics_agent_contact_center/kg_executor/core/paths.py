"""KG product files live only under pack `product/kg`."""

from __future__ import annotations

from pathlib import Path

PACK_ROOT = Path(__file__).resolve().parents[2]
KG_DIR = PACK_ROOT / "product" / "kg"
