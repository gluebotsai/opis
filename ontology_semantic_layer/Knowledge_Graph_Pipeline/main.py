#!/usr/bin/env python3
"""cdc-pipeline -- PostgreSQL -> Neo4j multi-tenant CDC pipeline.

    python main.py validate                     validate config, exit 0/1
    python main.py dry-run [--org <id>]         print generated Cypher per table
    python main.py preflight                    check PostgreSQL prerequisites
    python main.py provision --all | --org <id>
    python main.py verify-indexes --org <id>
    python main.py run                          start the consumer
    python main.py backfill --org <id> [--product <p>] [--table <t>]
    python main.py replay-quarantine --date <YYYY-MM-DD>
    python main.py steward scan --org <id> [--apply]
    python main.py steward eval --org <id>
    python main.py steward approve --org <id> --proposal <path>

Heavy drivers (neo4j, psycopg, confluent-kafka) are imported lazily inside the
commands that need them, so `validate` and `dry-run` run in a bare checkout.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from src.config_loader import ConfigLoader              # noqa: E402
from src.errors import ConfigError                      # noqa: E402


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def setup_logging(level: str = "INFO") -> None:
    import os
    import logging.handlers
    os.makedirs("logs", exist_ok=True)
    handler = logging.StreamHandler(sys.stdout)
    
    # Rotate at midnight, keep the last 2 days to save disk space
    file_handler = logging.handlers.TimedRotatingFileHandler(
        "logs/pipeline.log", when="midnight", interval=1, backupCount=2
    )
    
    # Dedicated error log handler as requested
    error_handler = logging.FileHandler("logs/error.log")
    error_handler.setLevel(logging.ERROR)
    
    formatter = JsonFormatter()
    handler.setFormatter(formatter)
    file_handler.setFormatter(formatter)
    error_handler.setFormatter(formatter)
    
    logging.basicConfig(level=getattr(logging, level.upper(), logging.INFO),
                        handlers=[handler, file_handler, error_handler], force=True)



# --------------------------------------------------------------------------
# shared construction
# --------------------------------------------------------------------------

def _load(args) -> ConfigLoader:
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass
    
    neo4j_overrides = {}
    if getattr(args, "neo4j_uri", None): neo4j_overrides["uri"] = args.neo4j_uri
    if getattr(args, "neo4j_user", None): neo4j_overrides["user"] = args.neo4j_user
    if getattr(args, "neo4j_password", None): neo4j_overrides["password"] = args.neo4j_password
    
    overrides = {"neo4j": neo4j_overrides} if neo4j_overrides else None
    
    domain_overlay = getattr(args, "domain_overlay", None)
    
    return ConfigLoader(args.config, overrides=overrides, domain_overlay=domain_overlay)



def _pg_factory(loader):
    import psycopg
    pg = loader.section("postgres")

    def factory():
        return psycopg.connect(
            host=pg["host"], port=pg.get("port", 5432), dbname=pg["database"],
            user=pg["user"], password=pg["password"],
        )
    return factory


def _build_runtime(loader, load_registry: bool = True):
    from src.drivers import DriverPool
    from src.metrics import Metrics
    from src.provision import Provisioner
    from src.quarantine import Quarantine
    from src.registry import Registry
    from src.router import Router
    from src.tenant_resolver import TenantResolver
    from src.writer import Writer

    pool = DriverPool(loader.section("neo4j"))
    metrics = Metrics()
    registry = Registry(loader.prefix, loader.section("control_plane"), pool.default_instance)
    provisioner = Provisioner(pool, loader)
    cp = loader.section("control_plane")
    tenant_column = cp.get("tenant_column", "tenant_id")
    pg_factory = _pg_factory(loader)
    
    control_conn = pg_factory()
    control_conn.autocommit = True
    source_conn = pg_factory()
    
    tenant_resolver = TenantResolver(loader.core_doc, control_conn, source_conn, pg_factory=pg_factory)
    writer = Writer(pool, loader, loader.connections, metrics, tenant_resolver=tenant_resolver)
    
    # Query tables without tenant col from information_schema
    cur = source_conn.cursor()
    cur.execute("""
        SELECT table_schema || '.' || table_name 
        FROM information_schema.tables t
        WHERE table_schema IN ('accounts', 'ccaas', 'cdp', 'crm', 'ticketing', 'campaign', 'webtrack')
          AND table_type = 'BASE TABLE'
          AND NOT EXISTS (
              SELECT 1 FROM information_schema.columns c
              WHERE c.table_schema = t.table_schema
                AND c.table_name = t.table_name
                AND c.column_name = %s
          )
    """, (tenant_column,))
    tables_without_tenant_col = {row[0] for row in cur.fetchall()}
    
    problems = tenant_resolver.validate(tables_without_tenant_col)
    if problems:
        raise SystemExit("\n".join(problems))
    
    router = Router(
        loader, registry, loader.section("kafka")["topic_prefix"],
        cp["organisations_table"], metrics,
        loader.connections.get("money", {}).get("emit_scale_property", True),
        tenant_column,
        tenant_resolver=tenant_resolver,
    )
    quarantine = Quarantine(loader.connections.get("quarantine", {}).get("path", "./quarantine"))

    if load_registry:
        provisioner.check_enterprise()
        provisioner.assert_prefix_immutable(loader.prefix)
        with pg_factory() as conn:
            print("CONTROL PLANE:", loader.section("control_plane"))
            registry.load_from_postgres(conn)
            router.load_partition_map_from_postgres(conn)

    return dict(pool=pool, metrics=metrics, registry=registry, provisioner=provisioner,
                writer=writer, router=router, quarantine=quarantine, pg_factory=pg_factory)


# --------------------------------------------------------------------------
# commands
# --------------------------------------------------------------------------

def cmd_validate(args) -> int:
    from src.validation import validate_all
    loader = _load(args)
    report = validate_all(loader)
    for w in report.warnings:
        print(f"WARN   {w}")
    for e in report.errors:
        print(f"ERROR  {e}")
    if report.ok:
        print(
            f"OK     core.yaml: {len(loader.core_tables)} table(s), "
            f"{len(loader.stub_labels)} stub label(s); "
            f"{len(loader.overlay_files())} overlay(s) validated"
        )
        return 0
    print(f"\nFAILED with {len(report.errors)} error(s)")
    return 1


def cmd_dry_run(args) -> int:
    from src.cypher_builder import build_all, build_constraint
    from src.naming import constraint_name
    loader = _load(args)
    syntax = loader.connections.get("cypher", {}).get("subquery_syntax", "legacy")

    databases = [args.org] if args.org else [p.stem for p in loader.overlay_files()]
    if not databases:
        databases = ["<core-only>"]

    for db in databases:
        eff = loader.effective(db)
        print(f"\n{'=' * 78}\nDATABASE {db}"
              f"  products={sorted(eff.products) or '(none)'}"
              f"  overlay={'yes' if eff.overlay_present else 'NO -- core only'}\n{'=' * 78}")

        print("\n--- CONSTRAINTS (created before any data) ---")
        for label, key in sorted(eff.all_labels().items()):
            print(f"  {build_constraint(label, key, constraint_name(label, key))}")

        for table, m in sorted(eff.tables.items()):
            gate = ""
            if m.product and m.product not in eff.products:
                gate = "  [SKIPPED -- product not purchased]"
            print(f"\n--- {table}  (mode={m.mode}, product={m.product or '-'}){gate}")
            for op, query in build_all(m, syntax).items():
                note = ""
                if m.mode == "properties_on" and op == "delete":
                    note = ("   (property name is built per flush from the row's "
                            "attr_name; DYNAMIC is a placeholder)")
                print(f"  # {op}{note}")
                for line in query.splitlines():
                    print(f"    {line}")
    return 0


def cmd_preflight(args) -> int:
    from src import preflight
    loader = _load(args)
    factory = _pg_factory(loader)
    tables = sorted(loader.core_tables)
    control = loader.section("control_plane")["organisations_table"]
    tenant_column = loader.section("control_plane").get("tenant_column", "tenant_id")
    with factory() as conn:
        report = preflight.run_all(conn, tables, tenant_column=tenant_column,
                                   control_table=control, strict=not args.warn_only,
                                   core_doc=loader.core_doc)
    print(json.dumps(report, indent=2, default=str))
    return 0


def cmd_provision(args) -> int:
    from src.provision import provision_organisation
    loader = _load(args)
    rt = _build_runtime(loader)
    targets = (
        rt["registry"].active()
        if args.all
        else [o for o in rt["registry"].all() if o.organization_id == str(args.org)]
    )
    if not targets:
        print("no matching organisation")
        return 1
    for org in targets:
        provision_organisation(rt["provisioner"], org, rt["registry"])
        print(f"provisioned {org.organization_id} -> {org.database} on {org.instance}")
    rt["pool"].close()
    return 0


def cmd_verify_indexes(args) -> int:
    loader = _load(args)
    rt = _build_runtime(loader)
    orgs = (
        [o for o in rt["registry"].all() if o.organization_id == str(args.org)]
        if args.org else rt["registry"].active()
    )
    failed = False
    for org in orgs:
        results = rt["provisioner"].verify_index_usage(org.database, org.instance)
        print(f"\n{org.database}:")
        for label, r in sorted(results.items()):
            status = "OK  " if r["index_seek"] and not r["label_scan"] else "FAIL"
            if status == "FAIL":
                failed = True
            print(f"  {status} :{label}({r['key']})  operators={r['operators']}")
    rt["pool"].close()
    if failed:
        print("\nFAILED: at least one MERGE is not using a unique index seek. "
              "Do NOT proceed to load data.")
        return 1
    print("\nAll merges use NodeUniqueIndexSeek.")
    return 0


def cmd_run(args) -> int:
    from src.consumer import Consumer
    loader = _load(args)
    rt = _build_runtime(loader, load_registry=False)
    mcfg = loader.connections.get("metrics", {})
    if mcfg.get("port"):
        rt["metrics"].serve(int(mcfg["port"]))

    rt["provisioner"].check_enterprise()
    rt["provisioner"].assert_prefix_immutable(loader.prefix)

    consumer = Consumer(
        loader, rt["registry"], rt["router"], rt["writer"], rt["provisioner"],
        rt["quarantine"], rt["metrics"], rt["pg_factory"],
    )
    consumer.bootstrap()
    try:
        consumer.run()
    finally:
        rt["pool"].close()
    return 0


def cmd_run_ch(args) -> int:
    from src.ch_consumer import ClickHouseConsumer
    loader = _load(args)
    rt = _build_runtime(loader, load_registry=False)
    mcfg = loader.connections.get("metrics", {})
    if mcfg.get("port"):
        rt["metrics"].serve(int(mcfg["port"]) + 1) # run on a different port than main consumer

    consumer = ClickHouseConsumer(
        loader, rt["registry"], rt["router"], rt["writer"], rt["provisioner"],
        rt["quarantine"], rt["metrics"], rt["pg_factory"],
    )
    consumer.bootstrap()
    try:
        consumer.run()
    finally:
        rt["pool"].close()
    return 0

def cmd_run_ch_poll(args) -> int:
    from src.ch_poller import ClickHousePoller, WatermarkStore
    from confluent_kafka import Producer
    import clickhouse_connect
    
    loader = _load(args)
    kafka_conf = loader.section("kafka")
    producer = Producer({'bootstrap.servers': kafka_conf["brokers"]})
    
    # We expect clickhouse connection details in config (or use defaults for skeleton)
    ch_conf = loader.connections.get("clickhouse", {})
    ch_client = clickhouse_connect.get_client(
        host=ch_conf.get("host", "localhost"),
        port=ch_conf.get("port", 8123),
        username=ch_conf.get("user", "default"),
        password=ch_conf.get("password", ""),
        database=ch_conf.get("database", "default")
    )
    
    poller_conf = loader.connections.get("clickhouse_poller", {"tables": []})
    wm = WatermarkStore("data/ch_poller_watermarks.db")
    
    poller = ClickHousePoller(poller_conf, ch_client, producer, wm, loader)
    try:
        poller.run_forever()
    finally:
        producer.flush()

def cmd_backfill(args) -> int:
    from src.backfill import Backfiller
    loader = _load(args)
    rt = _build_runtime(loader)
    for org in rt["registry"].active():
        rt["writer"].warm_cache(org.database)
    from src.provision import provision_organisation
    bf = Backfiller(loader, rt["registry"], rt["router"], rt["writer"], rt["pg_factory"], tenant_resolver=rt.get("router").tenant_resolver)

    orgs = (
        rt["registry"].active() if getattr(args, "all", False) or getattr(args, "org", None) == "all"
        else [o for o in rt["registry"].all() if o.organization_id == str(args.org)]
    )
    if not orgs:
        print(f"No matching organisation found for --org {getattr(args, 'org', None)}")
        rt["pool"].close()
        return 1

    all_stats = {}
    for target_org in orgs:
        provision_organisation(rt["provisioner"], target_org, rt["registry"])
        stats = bf.run(target_org.organization_id, args.product, args.table, args.resume_from)
        all_stats[target_org.organization_id] = stats

    if getattr(args, "all", False) or len(orgs) > 1:
        print(json.dumps(all_stats, indent=2, default=str))
    else:
        print(json.dumps(all_stats.get(str(args.org), {}), indent=2, default=str))
    rt["pool"].close()
    return 0


def cmd_replay(args) -> int:
    loader = _load(args)
    rt = _build_runtime(loader)
    from src.provision import provision_organisation
    for org in rt["registry"].active():
        provision_organisation(rt["provisioner"], org, rt["registry"])
        rt["writer"].warm_cache(org.database)

    def handler(topic, payload) -> bool:
        from src.router import RoutedEvent
        decision = rt["router"].route(topic, payload)
        if isinstance(decision, RoutedEvent):
            rt["writer"].add(decision)
            rt["writer"].flush_all()
            return True
        return False

    stats = rt["quarantine"].replay(args.date, handler)
    print(json.dumps(stats, indent=2))
    rt["pool"].close()
    return 0


def cmd_steward_scan(args) -> int:
    from ontology_steward.orchestrator import Orchestrator
    from ontology_steward.tools.pg_conn import steward_pg_conn_factory

    loader = _load(args)
    pipeline_root = Path(__file__).resolve().parent
    semantic_root = pipeline_root.parent
    orch = Orchestrator(loader, pipeline_root, semantic_root, conn_factory=steward_pg_conn_factory())
    result = orch.scan(args.org, apply=args.apply)
    print(json.dumps(result, indent=2, default=str))
    return 0


def cmd_steward_eval(args) -> int:
    from ontology_steward.eval.run_eval import main as eval_main

    return eval_main(["--org", args.org])


def cmd_steward_inbox(args) -> int:
    from ontology_steward.orchestrator import Orchestrator

    loader = _load(args)
    pipeline_root = Path(__file__).resolve().parent
    semantic_root = pipeline_root.parent
    orch = Orchestrator(loader, pipeline_root, semantic_root)
    result = orch.process_inbox(args.org, apply=args.apply)
    print(json.dumps(result, indent=2, default=str))
    return 0


def cmd_steward_approve(args) -> int:
    import yaml
    from ontology_steward.agents.applicator import Applicator
    from ontology_steward.models import ApplyGate, Proposal, ProposalDecision, StewardContext

    semantic_root = Path(__file__).resolve().parent.parent
    pipeline_root = Path(__file__).parent
    doc = yaml.safe_load(Path(args.proposal).read_text(encoding="utf-8"))
    proposal = Proposal(
        field=doc["field"],
        table=doc["table"],
        org=doc["org"],
        industry=doc.get("industry", ""),
        decision=ProposalDecision(doc["decision"]),
        class_id=doc.get("class_id"),
        graph_label=doc.get("graph_label"),
        term_id=doc.get("term_id"),
        cdc=doc.get("cdc") or {},
        confidence=doc.get("confidence", 0),
        gate=ApplyGate(doc.get("gate", "human")),
        rationale=doc.get("rationale", ""),
    )
    ctx = StewardContext(
        repo_root=str(semantic_root),
        pipeline_root=str(pipeline_root),
        semantic_root=str(semantic_root),
        org=args.org,
    )
    import os

    app = Applicator(pipeline_root, semantic_root, push_meili=bool(os.environ.get("MEILI_URL")))
    result = app.apply(ctx, proposal, force=True)
    print(json.dumps(result, indent=2, default=str))
    return 0 if result.get("ok") else 1


# --------------------------------------------------------------------------

def main() -> int:
    p = argparse.ArgumentParser(prog="cdc-pipeline", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--config", default="config", help="config directory (default: config)")
    p.add_argument("--log-level", default="INFO")
    
    # Overrides for testing
    p.add_argument("--neo4j-uri", help="Override Neo4j URI")
    p.add_argument("--neo4j-user", help="Override Neo4j User")
    p.add_argument("--neo4j-password", help="Override Neo4j Password")
    p.add_argument("--domain-overlay", help="Path to domain overlay to force apply (e.g. config/mappings/domains/ecommerce.yaml)")

    sub = p.add_subparsers(dest="command", required=True)

    sub.add_parser("validate").set_defaults(func=cmd_validate)

    d = sub.add_parser("dry-run")
    d.add_argument("--org", help="database name, e.g. orga1b2c3d4")
    d.set_defaults(func=cmd_dry_run)

    pf = sub.add_parser("preflight")
    pf.add_argument("--warn-only", action="store_true")
    pf.set_defaults(func=cmd_preflight)

    pr = sub.add_parser("provision")
    g = pr.add_mutually_exclusive_group(required=True)
    g.add_argument("--all", action="store_true")
    g.add_argument("--org")
    pr.set_defaults(func=cmd_provision)

    vi = sub.add_parser("verify-indexes")
    vi.add_argument("--org")
    vi.set_defaults(func=cmd_verify_indexes)

    sub.add_parser("run").set_defaults(func=cmd_run)
    sub.add_parser("run-ch").set_defaults(func=cmd_run_ch)
    sub.add_parser("run-ch-poll").set_defaults(func=cmd_run_ch_poll)

    bf = sub.add_parser("backfill")
    bf_target = bf.add_mutually_exclusive_group(required=True)
    bf_target.add_argument("--all", action="store_true")
    bf_target.add_argument("--org")
    bf.add_argument("--product")
    bf.add_argument("--table")
    bf.add_argument("--resume-from", dest="resume_from")
    bf.set_defaults(func=cmd_backfill)

    rq = sub.add_parser("replay-quarantine")
    rq.add_argument("--date", required=True)
    rq.set_defaults(func=cmd_replay)

    st = sub.add_parser("steward", help="Ontology Steward MAS (scan / eval / approve)")
    st_sub = st.add_subparsers(dest="steward_cmd", required=True)
    st_scan = st_sub.add_parser("scan")
    st_scan.add_argument("--org", required=True)
    st_scan.add_argument("--apply", action="store_true")
    st_scan.set_defaults(func=cmd_steward_scan)
    st_eval = st_sub.add_parser("eval")
    st_eval.add_argument("--org", default="1000")
    st_eval.set_defaults(func=cmd_steward_eval)
    st_approve = st_sub.add_parser("approve")
    st_approve.add_argument("--org", required=True)
    st_approve.add_argument("--proposal", required=True)
    st_approve.set_defaults(func=cmd_steward_approve)
    st_inbox = st_sub.add_parser("inbox")
    st_inbox.add_argument("--org", required=True)
    st_inbox.add_argument("--apply", action="store_true")
    st_inbox.set_defaults(func=cmd_steward_inbox)

    args = p.parse_args()
    setup_logging(args.log_level)
    try:
        return args.func(args)
    except ConfigError as exc:
        print(f"CONFIG ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
