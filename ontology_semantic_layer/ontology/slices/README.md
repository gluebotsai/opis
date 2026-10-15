# Ontology slices (compiled preset dumps)

Optional **legal slice** snapshots per catalog preset — not the LLM prompt.

| What | Detail |
|------|--------|
| **Runtime** | The API uses [`slice.py`](../slice.py) + YAML modules — **not** these files |
| **Purpose** | Human review, diffing presets, policy/debug reference |
| **Regenerate** | `PYTHONPATH=. python3 ontology/regen_slices.py` |

Each file lists `classes`, `relations`, `actions`, and `metric_ids` for one preset (e.g. `cc.reporting.yml`).

**Inject agents with** `pack.as_prompt()` (compact), not the contents of this folder.
