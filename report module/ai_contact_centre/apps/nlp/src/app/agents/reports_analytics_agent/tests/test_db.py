"""Pack DSN hygiene: product Prisma URLs must still connect."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.db import connect_dsn


class ConnectDsnTests(unittest.TestCase):
    def test_drops_prisma_schema_keeps_libpq(self) -> None:
        raw = "postgresql://u:p@h:5432/db?schema=ccass&sslmode=require&connection_limit=5"
        out = connect_dsn(raw)
        self.assertNotIn("schema=", out)
        self.assertNotIn("connection_limit=", out)
        self.assertIn("sslmode=require", out)
        self.assertIn("postgresql://u:p@h:5432/db", out)

    def test_plain_dsn_unchanged(self) -> None:
        raw = "postgresql://u:p@h:5432/db"
        self.assertEqual(connect_dsn(raw), raw)


if __name__ == "__main__":
    unittest.main()
