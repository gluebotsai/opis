import os, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# Env vars referenced by connections.yaml. Set before any ConfigLoader import.
for k, v in {
    "PG_HOST": "localhost", "PG_PORT": "5432", "PG_DATABASE": "cdc", "PG_USER": "cdc",
    "PG_PASSWORD": "pw", "KAFKA_BOOTSTRAP": "localhost:9092",
    "NEO4J_URI": "bolt://192.168.11.25:7687", "NEO4J_USER": "neo4j",
    "NEO4J_PASSWORD": "pw",
}.items():
    os.environ.setdefault(k, v)

import pytest
from src.config_loader import ConfigLoader
from src.registry import Organisation


@pytest.fixture(scope="session")
def loader():
    return ConfigLoader(ROOT / "config")


@pytest.fixture
def org_a():
    o = Organisation(tenant_id="tenant-alpha", organization_id="a1b2c3d4",
                     database="orga1b2c3d4", instance="instance-1", status="active",
                     provisioned=True, products={"crm", "ticketing"})
    return o


@pytest.fixture
def org_b():
    return Organisation(tenant_id="tenant-beta", organization_id="b5e6f7a8",
                        database="orgb5e6f7a8", instance="instance-1", status="active",
                        provisioned=True, products={"crm", "ticketing", "ccaas"})


@pytest.fixture
def registry(org_a, org_b):
    from tests.fakes import FakeRegistry
    return FakeRegistry([org_a, org_b])


@pytest.fixture
def router(loader, registry):
    from src.router import Router
    return Router(loader, registry, "cdc", "accounts.organisations")
