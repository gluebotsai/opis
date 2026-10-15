# Ontology Steward MAS

File-backed multi-agent system for classifying custom JSON fields and writing approved ontology artifacts.

## Verification runbook

```bash
cd Knowledge_Graph_Pipeline
PYTHONPATH=. python3 ontology_steward/eval/run_eval.py
PYTHONPATH=. python3 tests/test_coercion.py
PYTHONPATH=. python3 tests/test_steward_mas.py
PYTHONPATH=. python3 tests/test_steward_hardening.py
PYTHONPATH=. python3 scripts/e2e_steward_mas.py
```

With pytest: `pip install pytest && PYTHONPATH=. python3 -m pytest tests/test_steward_hardening.py -v`

## CLI

```bash
PYTHONPATH=. python3 -m ontology_steward scan --org 1000
PYTHONPATH=. python3 -m ontology_steward eval --org 1000
PYTHONPATH=. python3 -m ontology_steward inbox --org 1000
PYTHONPATH=. python3 main.py steward eval --org 1000
```

Set `STEWARD_PG_DSN` or `DATABASE_URL` for live PG scan. Set `MEILI_URL` + `MEILI_KEY` for Meili push on approve.

## Shopify taxonomy

Minimal vendored assets ship under `taxonomies/shopify/`. For full release assets:

```bash
python3 scripts/pin_shopify_taxonomy.py --version v2026-08
```
