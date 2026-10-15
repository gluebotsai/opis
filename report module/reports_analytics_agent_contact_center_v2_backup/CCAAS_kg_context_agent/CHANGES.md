# Changes from kg_context_agent (campaign product scope only)

Everything else is byte-for-byte the original: prompt, LLM settings, agent loop, memory, summarizer, SSE events,
FastAPI service, Streamlit app, credentials, the old scripts and data files.

## Changed
| File | Change |
|---|---|
| `src/tools.py` | Added the product-scope guard (`apply_product_scope`) and one call to it in `execute_cypher`, after the existing checks and before LIMIT. Index name `graph_onto` → `graph_onto_campaign`. Nothing else in the file changed. |
| `scripts/reindex_ontology.py` | Index name `graph_onto` → `graph_onto_campaign` (so the old all-product index is not overwritten). |
| `ontology/ontology_base.json`, `schema_registry.json` | Campaign scope of the current (v4.5) graph: 66 labels, 48 relationship paths. |
| `ontology/concept_cards.json` | 22 campaign concept cards (the old cards were contact-centre / sales metrics, outside the scope). |
| `ontology/meilisearch_documents.json`, `content.json` | Rebuilt from the above with the old reindex script's own functions. |

## Added
| File | Purpose |
|---|---|
| `ontology/scope.json` | The scope the guard enforces (allowed: no product label, Marketing, CDP). |
| `scripts/generate_campaign_ontology.py` | Regenerates the campaign ontology from the pipeline config. The old `generate_ontology.py` is untouched (it regenerates the old all-product ontology from core.yaml, so do not run it here). |
| `scripts/check_campaign_queries.py` | Live check: scope on real data + every concept-card query. |
| `CHANGES.md` | This file. |

## Scope rule
A node is readable when it has no product label or its product label is Marketing or CDP. Every node pattern in a
query is rewritten to exclude ContactCentre, Sales, Support and WebTracking, e.g.
`(c:Campaign)` → `(c:Campaign&!ContactCentre&!Sales&!Support&!WebTracking)`; variable-length paths and procedure
calls are refused.

## Run (same as before, plus one reindex)
```bash
python scripts/reindex_ontology.py            # once: builds graph_onto_campaign
python scripts/check_campaign_queries.py      # live check on org1012
cd fastapi_service && ./start.sh              # or: streamlit run app.py  (app.py still uses org1000, as before)
```
