from __future__ import annotations

import pytest

from sql_agent.catalog import load_catalog
from sql_agent.planner import SqlPlanner


@pytest.fixture(scope="session")
def catalog():
    return load_catalog()


@pytest.fixture(scope="session")
def planner(catalog):
    return SqlPlanner(catalog)
