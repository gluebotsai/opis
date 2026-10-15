# Traceability

Every requirement in the build specification, mapped to where it is implemented
and how it is verified. Produced by auditing the code, not by restating the spec.

Automated audit: **103/103 spec assertions pass.**
Test suite: **168 passed, 2 skipped** (the 2 need a live Neo4j Enterprise).

---

## 1. Spec sections → implementation

| Spec | Requirement | Implementation | Verified by |
|---|---|---|---|
| 2.1 | Neo4j names: alnum only, no underscore, starts with letter, 3–63, lowercase | `naming.make_database_name` | `test_naming.py` (12 tests) |
| 2.1 | Backtick-quote names in DDL | `naming.quote_db`, used in `provision._create_database` | `test_quote_db`, audit |
| 2.1 | Over-length names must not silently pass to Neo4j | truncate **+ SHA-1 suffix** (deviation 7) | `test_overflow_ids_sharing_a_prefix_do_not_collide` |
| 2.2 | Enterprise required; fail fast on Community | `provision.check_enterprise` | audit; runtime |
| 2.3 | No nested maps as properties | `coercion.coerce_value`, `extract_custom` | `test_nested_json_value_is_rejected` |
| 2.4 | `SET x = null` deletes; strip nulls | `coercion.strip_nulls`, applied in `router._node_props` | `test_11b`, `test_strip_nulls_*` |
| 2.5 | `wal_level`, REPLICATION role, slots, `tenant_id NOT NULL` | `preflight.run_all` | audit (5 checks) |
| 3 | Architecture; consumer is the only deliverable | `src/`, `docker/` for dev only | — |
| 4.1 | `safe_load` only, `${VAR}` substitution, `enable_auto_commit: false` | `config_loader`, `consumer._build_consumer` | `test_missing_env_var_is_a_config_error`, audit |
| 4.2 | `core.yaml` + `<database>.yaml` + `_TEMPLATE.yaml`; missing overlay → warn, core alone | `config_loader.effective` | `test_missing_overlay_falls_back_to_core_alone` |
| 5.1 | Registry from `accounts.organisations` at startup | `registry.load_from_postgres` | `test_09*` |
| 5.2 | Control topic handled first; `d` never drops a database | `consumer._handle_batch`, `registry.upsert_from_event` | `test_control_message_is_handled_before_data_in_the_same_batch`, `test_09b` |
| 5.3 | Idempotent provisioning; constraints for **all** mappings before data | `provision.provision_organisation` | `test_all_labels_includes_stubs`, audit |
| 5.4 | `PROFILE` asserts `NodeUniqueIndexSeek`, not `NodeByLabelScan` | `provision.verify_index_usage`, CLI `verify-indexes` | `test_13` (live server) |
| 6.1–6.3 | Declarative mappings; overlay may only add | `config_loader.merge_overlay` | `test_overlay_adds_without_touching_core` + 12 rejection tests |
| 6.4 | All ten startup checks, non-zero exit | `validation.validate_all` | `test_validation.py` (29 tests), audit (10/10) |
| 7.1 | `MERGE` on core label+key only; extra labels via `SET`; targets MERGEd as stubs; FK null-guarded | `cypher_builder.build_node_upsert` | `test_cypher_builder.py` (7 invariant tests) |
| 7.2 | `relationship_only` upsert and delete | `build_relationship_upsert/_delete` | byte-exact match to spec |
| 7.3 | `properties_on` with `SET n +=`; dynamic `REMOVE` built in Python, grouped | `build_properties_on_upsert/_remove`, `writer._write_group` | `test_10`, `test_properties_on_attributes_do_not_collapse` |
| 7.4 | JSONB: cast, prefix, reject nested | `coercion.extract_custom` | 5 tests |
| 7.5 | Strip nulls before assignment | `coercion.strip_nulls` | `test_11b` |
| 7.6 | Deletes; `on_delete: soft` configurable | `build_node_delete` | `test_soft_delete_is_configurable_per_mapping` |
| 8.1 | Topic → table | `router.table_for` | `test_topic_maps_to_table` |
| 8.2 | Eight routing steps in order | `router.route` | `test_router.py` (30 tests) |
| 8.3 | Fail-closed: 5 quarantine paths, JSONL with reason | `router`, `quarantine` | 5 dedicated tests |
| 8.4 | Buffer; flush on size **or** interval | `writer.due` | `test_size_threshold_*`, `test_time_threshold_*` |
| 8.5 | One tx per buffer key; upsert→rel→delete; deadlock retry with jitter | `writer.flush`, `_execute_with_retry` | `test_one_transaction_per_buffer_key_not_per_event`, retry tests |
| 8.6 | Commit only after the Neo4j tx; replay-safe | `OffsetTracker` + `consumer._commit` | `test_offsets_are_not_committed_past_unflushed_data` |
| 8.7 | One worker per database; partition by `tenant_id` | documented; `instance`+database routing | README |
| 9 | Backfill via same mapping/Cypher, server-side cursor, resumable | `backfill.Backfiller` | audit (4 checks) |
| 10 | Batched `UNWIND`, constraints, one driver, cached Cypher, no `fetchall` | `writer`, `drivers`, `backfill` | `test_cypher_is_generated_once_and_cached` |
| 11 | Project structure and module responsibilities | `src/` (12 modules + 3 added) | audit (12/12) |
| 12 | Nine CLI commands | `main.py` | audit (7 named + `preflight`) |
| 13 | Eight metric families | `metrics.py`, emitted at call sites | audit (8/8) |
| 14 | Thirteen acceptance tests | `tests/test_integration.py` | 20 tests, 2 skipped |
| 15 | Dependencies, Python 3.11+ | `requirements.txt` | audit (8/8) |
| 16 | Debezium connector JSON | `docker/connectors/postgres-source.json` | audit (7/7) |
| 17 | Build order with phase gates | followed; see README | phase gates run in order |

---

## 2. Acceptance tests (spec §14)

| # | Test | Status |
|---|---|---|
| 1 | Insert → node with correct properties | pass |
| 2 | Update one column → updated, `tenant_id` present, no duplicate | pass (2 tests) |
| 3 | 10,000 rows → all present, one transaction | pass |
| 4 | Delete → node and relationships removed | pass |
| **5** | **Replay → node count unchanged** | **pass** (2 tests) |
| **6** | **Org A never appears in org B** | **pass** (2 offline + 1 live) |
| 7 | Unknown `tenant_id` → quarantined, nothing written | pass |
| 8 | Unpurchased product → skipped, nothing written | pass |
| 9 | New org row → database created, constraints, routing | pass (3 tests) |
| 10 | `properties_on` update preserves other properties | pass (2 tests) |
| 11 | Missing JSON key → property preserved | pass (2 tests) |
| 12 | Nested JSON → rejected, not written | pass (2 tests) |
| **13** | **`PROFILE` → `NodeUniqueIndexSeek`** | **skipped without a live server** |

Tests 1–12 run against `tests/fakes.py`, which interprets the exact Cypher this
project generates and models node identity as `(label, key, value)` — the same
semantics a uniqueness constraint provides. "Replay changes no node count" is
therefore a real assertion, not a tautology.

Test 13 needs plan inspection from a real server. **It is a release blocker: run
`pytest` with `NEO4J_TEST_URI` set, or `python main.py verify-indexes`, before
loading production data.**

---

## 3. Deviations from the specification

Each one changes behaviour the spec prescribed. Twelve total: six agreed in
review, two found during review, four found during the build.

### Agreed in review

**1. `REPLICA IDENTITY FULL` everywhere, verified in code.**
The spec framed it as a TOAST optimisation. Under DEFAULT, a DELETE's
before-image carries only primary-key columns, so `tenant_id` is absent and
**every delete is quarantined** — acceptance test 4 fails on an otherwise correct
system. `preflight.check_replica_identity` fails the process; `01-schema.sql`
sets it. Router error messages name it explicitly, because that is where an
operator will first see the symptom.

**2. Coercion layer driven by the Debezium value schema.**
`time.precision.mode` emits integers. Written through, every timestamp becomes a
number and temporal queries silently misbehave. Requires
`value.converter.schemas.enable=true`; the reason is commented in both the
compose file and `connectors/README.md`, because someone will eventually try to
turn it off to halve message size.

**3. `stub_labels` in `core.yaml`.**
Relationship targets are MERGEd as stubs. Without constraints on those labels,
`MERGE (t:Tag {tag_id: …})` is a full label scan. This also resolved a
contradiction in the spec itself: `_TEMPLATE.yaml` declared `HOLDS → Policy`
while validation check 5 required every `target_label` to be a core label, and
`Policy` was neither — **the shipped template failed the shipped validator.**

**4. Offset watermark.**
Every buffered row carries `(topic, partition, offset)`; the commit point per
partition is the lowest offset not yet durable in Neo4j.

**5. Collapsing buffer, keyed `(database, table)`.**
Collapse keys per mode: `node` → business key; `relationship_only` →
`(from_key, to_key, type)`; `properties_on` → `(target_key, attr_name)`.

**6. `instance` field on every organisation.**
`DriverPool` keys drivers by instance; sharding is a config change.

### Found during review

**7. Money: `decimal.handling.mode: string` + integer minor units.**
`double` silently rounds. Excess precision is quarantined, never rounded.
See README, "How money is stored".

**8. Schema drift: `unmapped_columns_total`, warned once per `(table, column)`.**

### Found during the build

**9. Hash suffix instead of truncation on over-length names.**
Two UUIDs sharing a long prefix would truncate to one database name and
**silently merge two tenants' graphs** — the exact failure the architecture
exists to prevent. `test_overflow_ids_sharing_a_prefix_do_not_collide`.

**10. Prefix assertion lives in a `cdcmeta` database, not `system`.**
Neo4j 5 reserves `system`; arbitrary nodes cannot be written there.

**11. `control_plane.tenant_id_column` added.**
The spec keyed the registry by `tenant_id` but its `control_plane` config block
named only `organization_id_column` and `status_column`. The column had to be
nameable.

**12. `properties:` accepts both a bare string and `{name, type, scale}`.**
Decimal columns need a declared scale. Both spellings normalise internally, so
generated `core.yaml` stays readable.

### Found during first-run trials

**13. The tenant discriminator column is configurable.**
`router.py` hardcoded the string `"tenant_id"`. Real schemas frequently have no
separate tenant column and discriminate on `organization_id`, collapsing tenant
and organisation into one identifier. Now `control_plane.tenant_column`, with
`tenant_id` as the default. Two tests cover the `organization_id` case.

**14. `${VAR}` expansion is deferred to first section read.**
It was eager, at load time, so `validate` and `dry-run` — which touch no
database — failed on an unset `PG_HOST`. That defeated the point of making the
driver imports lazy. `test_offline_commands_work_with_an_empty_environment`
asserts both run under `env -i`.

**15. `PG_PORT` is honoured.**
`connections.yaml` hardcoded `port: 5432` while `.env.example` shipped a
`PG_PORT` line nothing read. Anyone on a non-default port connected to the
wrong place with a confusing error.

**16. Debezium's address is separate from the consumer's.**
`database.hostname` was hardcoded to the Docker service name `postgres`. Debezium
connects from inside a container, so its route to PostgreSQL may differ from the
consumer's: `DEBEZIUM_PG_HOST`/`DEBEZIUM_PG_PORT`, defaulting to `PG_HOST`/`PG_PORT`.

**17. `pydantic` and `tenacity` removed from `requirements.txt`.**
Spec §15 named them, but neither is imported. Config validation is hand-written
(clearer messages, and the ten spec checks map one-to-one onto assertions) and
the deadlock retry is inline in `writer.py` because it counts retries into the
metrics registry, which is awkward through a decorator. Two unused installs is
not a neutral cost. This is the only §15 item not satisfied literally.

### One bug the tests caught during the build

`test_collapsed_events_still_release_every_offset` failed on first run.
Superseded events were holding their Kafka offsets forever, so the watermark
would have stalled permanently at the first collapsed event and consumer lag
would have grown without bound — in production, silently. `Buffer` now tracks
every offset added, separately from the surviving events.

---

## 4. Open items, carried forward

**Organisation count — unanswered.** Built for a single instance with the
`instance` field present throughout. Fine under ~200 databases per DBMS;
thousands is not a supported operating point and needs a placement policy before
onboarding.

**Temporal precision — assumed `adaptive`.** `connect` truncates `timestamp(6)`
to milliseconds, irreversibly. Reversible in config, but only before load.

Both are cheap now and expensive after data exists.

---

## 5. Deliberate non-implementations

- **No Fabric or composite databases.** A Cypher query cannot cross a database
  boundary; that is the isolation guarantee.
- **No hand-rolled WAL parsing.** Debezium provides snapshot, offsets, TOAST
  handling and type mapping.
- **No official Neo4j Kafka sink connector.** It binds one connector to one
  fixed `neo4j.database`; per-event routing requires custom code.
- **No table ordering.** Stub-node MERGE makes arrival order irrelevant.
- **No automatic database drop** on control-plane delete. Logged; manual action
  required.
- **New PostgreSQL columns are not auto-added** to the graph. An explicit
  property list is what keeps junk out. Now counted rather than silent.

---

## 6. Post-audit fixes (independent review)

Three defects found by adversarial testing after the build. All three were
invisible to the original 171-test suite.

### Fix 1 — `properties_on` upsert and delete disagreed on the property name

**Severity: data integrity. Silent.**

The upsert passed the property key as a `$batch` parameter, where any string is
legal, so it was written raw. The delete has to embed the key literally, because
Cypher cannot parameterise a property name, so it ran through
`safe_property_name`. Whenever `attr_name` contained anything outside
`[A-Za-z0-9_]`, the two disagreed:

| `attr_name` | upsert wrote | delete removed |
|---|---|---|
| `risk-score` | `attr_risk-score` | `attr_risk_score` |
| `kyc.status` | `attr_kyc.status` | `attr_kyc_status` |
| `policy number` | `attr_policy number` | `attr_policy_number` |

The delete matched nothing and the value survived in the graph permanently, so
the graph reported attributes that no longer existed in PostgreSQL.

Undetected because every fixture used a clean name — `colour`, `size`, `status`.

**Fix:** `router._build` now sanitises on the upsert side too, and the
`properties_on` collapse key holds the prefixed, sanitised name. Two names that
sanitise alike (`a-b`, `a.b`) are one Neo4j property, so they now share one
collapse key and resolve deterministically by Kafka order instead of racing.

### Fix 2 — renaming `attr_name` orphaned the old property

**Severity: data integrity. Silent.**

An UPDATE changing `attr_name` from `colour` to `shade` wrote `attr_shade` and
left `attr_colour` on the node forever.

**Fix:** `RoutedEvent.companion` carries a paired removal for the old name,
emitted only when `before.attr_name != after.attr_name` and the two do not
sanitise to the same key. The companion carries `offset=None` — the primary
event owns the Kafka watermark for that record, and double-holding the offset
could advance the watermark past an unflushed event.

**Placement note:** the companion is buffered inside `Writer.add`, not in the
consumer. Putting it in one caller meant `backfill.py` and the test helper
bypassed it and silently reintroduced the orphan — which is exactly what the
first attempt did, and what the new tests caught.

### Fix 3 — `register_connector.sh` required `envsubst`

**Severity: setup failure at the last step.**

`envsubst` ships with gettext, absent on minimal Linux images and on macOS
without brew. The script already required `python3`, so it now falls back to a
python substitution rather than failing with `envsubst: not found`.

### Coverage added

`tests/test_properties_on_naming.py` — 8 tests over dirty attribute names
(`risk-score`, `kyc.status`, `policy number`, `a/b`, `ratio%`): delete-removes-
what-upsert-wrote, sanitiser collisions collapsing deterministically, rename
across and within a flush window, value-only update emitting no companion,
rename-that-sanitises-alike emitting no companion, and offset non-duplication.

Suite: **179 passed, 2 skipped** (the 2 require a live Neo4j Enterprise).
