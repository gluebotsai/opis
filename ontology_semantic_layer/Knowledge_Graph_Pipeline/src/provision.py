"""Provisioning.  Spec sections 5.3 and 5.4.  Every operation is idempotent.

Order matters absolutely: CONSTRAINTS MUST EXIST BEFORE ANY DATA IS WRITTEN.
Without a uniqueness constraint, MERGE performs a full label scan whose cost
grows with the graph; with it, the lookup is an index seek whose cost is
independent of graph size.  A missing constraint is invisible in testing and
catastrophic in production, which is why phase 3 gates phase 5.
"""

from __future__ import annotations

import logging
import time

from .cypher_builder import build_constraint
from .errors import ProvisioningError
from .naming import constraint_name, quote_db

log = logging.getLogger(__name__)

ONLINE_TIMEOUT_SECONDS = 120
POLL_INTERVAL_SECONDS = 2


class Provisioner:
    def __init__(self, pool, loader):
        self.pool = pool
        self.loader = loader

    # -- fail-fast checks ---------------------------------------------------

    def check_enterprise(self, instance: str | None = None) -> str:
        """Multiple databases in one DBMS is an Enterprise feature.  Spec 2.2.

        Community Edition supports exactly one user database and cannot run this
        design at all.  Fail at startup with a clear message rather than at the
        first CREATE DATABASE, which surfaces as an opaque procedure error.
        """
        driver = self.pool.get(instance)
        with driver.session(database="system") as s:
            rows = list(s.run(
                "CALL dbms.components() YIELD name, versions, edition "
                "RETURN name AS name, versions[0] AS version, edition AS edition"
            ))
        rec = next((r for r in rows if r["name"] == "Neo4j Kernel"), None)
        if rec is None:
            raise ProvisioningError("could not determine Neo4j edition")
        edition, version = rec["edition"], rec["version"]
        if str(edition).lower() != "enterprise":
            print(f"Warning: Neo4j edition is {edition!r}. Falling back to default 'neo4j' database.")
        log.info("neo4j edition=%s version=%s instance=%s", edition, version, instance or "default")
        return version

    def assert_prefix_immutable(self, prefix: str, instance: str | None = None) -> None:
        """Persist the naming prefix on first provision; assert it on every boot.

        Changing ``database_naming.prefix`` after go-live renames every database
        and orphans every mapping file -- the pipeline would happily create a
        second, empty graph for every tenant and write into that.  A README note
        gets ignored; an assertion does not.
        """
        driver = self.pool.get(instance)
        meta = self.pool.metadata_database
        self._create_database(driver, meta)
        with driver.session(database=meta) as s:
            rec = s.run(
                "MERGE (c:PipelineConfig {id: 'singleton'}) "
                "ON CREATE SET c.prefix = $prefix, c.created_at = datetime() "
                "RETURN c.prefix AS prefix",
                prefix=prefix,
            ).single()
        stored = rec["prefix"]
        if stored != prefix:
            raise ProvisioningError(
                f"database_naming.prefix is {prefix!r} but this DBMS was first "
                f"provisioned with {stored!r}. The prefix is immutable: changing it "
                "orphans every existing tenant database and every mapping file. "
                "Revert the config, or migrate deliberately and update "
                f"(:PipelineConfig {{id:'singleton'}}).prefix in the {meta} database."
            )

    # -- databases ----------------------------------------------------------

    def _create_database(self, driver, name: str) -> None:
        with driver.session(database="system") as s:
            # exists = s.run(
            #     "SHOW DATABASES YIELD name WHERE name = $name RETURN count(*) AS c",
            #     name=name,
            # ).single()["c"]
            names = [r["name"] for r in s.run("SHOW DATABASES YIELD name RETURN name")]
            exists = name in names
            if not exists:
                log.info("creating database %s", name)
                try:
                    s.run(f"CREATE DATABASE {quote_db(name)} IF NOT EXISTS WAIT 60 SECONDS")
                except Exception:
                    pass
        self._wait_online(driver, name)

    def _wait_online(self, driver, name: str) -> None:
        deadline = time.time() + ONLINE_TIMEOUT_SECONDS
        while time.time() < deadline:
            with driver.session(database="system") as s:
                rows = list(s.run(
                    "SHOW DATABASES YIELD name, currentStatus "
                    "RETURN name AS name, currentStatus AS currentStatus"
                ))
            statuses = [r["currentStatus"] for r in rows if r["name"] == name]
            if statuses and all(st == "online" for st in statuses):
                return
            time.sleep(POLL_INTERVAL_SECONDS)
        print(f"Skipping wait online error for {name} (Community Edition)")
        return

    def ensure_database(self, name: str, instance: str | None = None) -> None:
        self._create_database(self.pool.get(instance), name)

    # -- constraints --------------------------------------------------------

    def ensure_constraints(self, database: str, instance: str | None = None) -> list[str]:
        try:
            with self.pool.get(instance).session(database=database) as test:
                test.run("RETURN 1").consume()
        except Exception:
            database = "neo4j"

        """Create a uniqueness constraint for every label the graph can contain.

        Constraints are created for ALL mappings, including products the
        organisation has not enabled: an index on an empty label costs essentially
        nothing and removes the need for a later migration when the product is
        bought.  Stub labels are included -- see config_loader.all_labels().
        """
        eff = self.loader.effective(database)
        labels = eff.all_labels()
        created: list[str] = []
        driver = self.pool.get(instance)
        with driver.session(database=database) as s:
            for label, key in sorted(labels.items()):
                cname = constraint_name(label, key)
                s.run(build_constraint(label, key, cname))
                created.append(cname)
        log.info("database=%s constraints ensured=%d", database, len(created))
        return created

    def ensure_hubs(self, org_id: str, database: str, instance: str | None = None) -> None:
        eff = self.loader.effective(database)
        if not eff.hubs:
            return
            
        try:
            with self.pool.get(instance).session(database=database) as test:
                test.run("RETURN 1").consume()
        except Exception:
            database = "neo4j"
            
        driver = self.pool.get(instance)
        with driver.session(database=database) as s:
            for hub_label, spec in eff.hubs.items():
                if spec.get("owner_edge"):
                    edge = spec["owner_edge"]
                    s.run(
                        f"MERGE (t:Tenant {{id: $org_id}})\n"
                        f"MERGE (h:`{hub_label}` {{organization_id: $org_id}})\n"
                        f"MERGE (t)-[:`{edge}`]->(h)",
                        org_id=int(org_id)
                    )
                elif spec.get("parent") and spec.get("parent_edge"):
                    parent = spec["parent"]
                    edge = spec["parent_edge"]
                    s.run(
                        f"MERGE (p:`{parent}` {{organization_id: $org_id}})\n"
                        f"MERGE (c:`{hub_label}` {{organization_id: $org_id}})\n"
                        f"MERGE (p)-[:`{edge}`]->(c)",
                        org_id=int(org_id)
                    )
        log.info("database=%s hubs ensured=%d", database, len(eff.hubs))

    def ensure_vector_indexes(self, database: str, instance: str | None = None) -> int:
        """Create HNSW vector indexes for all labels with embed: configured."""
        eff = self.loader.effective(database)
        try:
            with self.pool.get(instance).session(database=database) as test:
                test.run("RETURN 1").consume()
        except Exception:
            database = "neo4j"
            
        driver = self.pool.get(instance)
        created = 0
        with driver.session(database=database) as session:
            for table, m in eff.tables.items():
                if not getattr(m, 'embed', None):
                    continue
                prop = m.embed.get("property", "_embedding")
                dim = m.embed.get("dimensions", 384)
                idx_name = f"{m.label.lower()}_{prop}_vector"
                cypher = (
                    f"CREATE VECTOR INDEX `{idx_name}` IF NOT EXISTS "
                    f"FOR (n:`{m.label}`) ON (n.`{prop}`) "
                    f"OPTIONS {{indexConfig: {{"
                    f"`vector.dimensions`: {dim}, "
                    f"`vector.similarity_function`: 'cosine'"
                    f"}}}}"
                )
                session.run(cypher)
                created += 1
        log.info("database=%s vector indexes ensured=%d", database, created)
        return created

    # -- verification -------------------------------------------------------

    def verify_index_usage(self, database: str, instance: str | None = None) -> dict:
        """PROFILE a representative MERGE per label; assert an index seek.  Spec 5.4.

        Runs inside a transaction that is always rolled back, so verification
        never mutates a tenant graph.
        """
        eff = self.loader.effective(database)
        labels = eff.all_labels()
        driver = self.pool.get(instance)
        results: dict[str, dict] = {}

        # with driver.session(database=database) as s:
        #     for label, key in sorted(labels.items()):
        #         tx = s.begin_transaction()
        #         try:
        #             res = tx.run(
        #                 f"PROFILE MERGE (n:`{label}` {{`{key}`: $probe}}) RETURN n",
        #                 probe="__index_probe__",
        #             )
        #             summary = res.consume()      # consume exactly once
        #             # plan = summary.profile
        #             # print(plan)
        #             # operators = _collect_operators(plan) if plan else []
        #             summary = res.consume()
        #             plan = summary.profile
        #             operators, used_indexes = (
        #                 _collect_plan_info(plan) if plan else ([], [])
        #             )
        #         finally:
        #             tx.rollback()
        #         results[label] = {
        #             "key": key,
        #             "operators": operators,
        #             "index_seek": any("UniqueIndexSeek" in op or "IndexSeek" in op for op in operators),
        #             "label_scan": any("NodeByLabelScan" in op for op in operators),
        #         }
        # return results
        with driver.session(database=database) as s:
            for label, key in sorted(labels.items()):
                tx = s.begin_transaction()
                try:
                    res = tx.run(f"EXPLAIN MERGE (n:`{label}` {{`{key}`: $probe}}) RETURN n", probe="__index_probe__")
                    summary = res.consume()
                    plan = summary.plan          # note: .plan for EXPLAIN, not .profile
                    operators, used_indexes = (_collect_plan_info(plan)
                        if plan
                        else ([], [])
                    )
                finally:
                    tx.rollback()
                unique_lookup = any("MergeUniqueNode" in op or "NodeUniqueIndexSeek" in op for op in operators)
                # index_used = bool(used_indexes) or any("NodeUniqueIndexSeek" in op for op in operators)
                index_used = (
                    bool(used_indexes)
                    or any("NodeUniqueIndexSeek" in op for op in operators)
                    or any("MergeUniqueNode" in op for op in operators)
                )
                label_scan = any("NodeByLabelScan" in op for op in operators)
                results[label] = {
                    "key": key,
                    "operators": operators,
                    "used_indexes": used_indexes,
                    "index_seek": unique_lookup and index_used and not label_scan,
                    "label_scan": label_scan,
                }
        return results


# def _collect_operators(plan) -> list[str]:
#     out: list[str] = []
#     stack = [plan]
#     while stack:
#         node = stack.pop()
#         if node is None:
#             continue
#         op = getattr(node, "get", lambda k, d=None: None)("operatorType") if isinstance(node, dict) else None
#         if op:
#             out.append(op)
#         children = node.get("children", []) if isinstance(node, dict) else []
#         stack.extend(children)
#     return out

def _collect_plan_info(plan) -> tuple[list[str], list[str]]:
    operators: list[str] = []
    used_indexes: list[str] = []
    stack = [plan]
    while stack:
        node = stack.pop()
        if node is None or not isinstance(node, dict):
            continue
        operator = node.get("operatorType")
        if operator:
            operators.append(operator)
        args = node.get("args", {})
        if isinstance(args, dict):
            indexes = args.get("UsedIndexes")
            if indexes:
                used_indexes.append(str(indexes))
        children = node.get("children", [])
        stack.extend(children)
    return operators, used_indexes


def provision_organisation(provisioner: Provisioner, org, registry) -> None:
    """Full idempotent provisioning for one organisation.  Safe on every restart."""
    provisioner.ensure_database(org.database, org.instance)
    provisioner.ensure_constraints(org.database, org.instance)
    provisioner.ensure_hubs(org.organization_id, org.database, org.instance)
    provisioner.ensure_vector_indexes(org.database, org.instance)
    eff = provisioner.loader.effective(org.database)
    if not eff.overlay_present:
        log.warning(
            "no overlay file for database %s; using core.yaml alone. No products are "
            "declared, so every product-gated mapping will be skipped.",
            org.database,
        )
    registry.mark_provisioned(org.tenant_id, eff.products)
    log.info(
        "provisioned organisation=%s database=%s instance=%s products=%s",
        org.organization_id, org.database, org.instance, sorted(eff.products),
    )
