# CCaaS semantic query test fixtures

Input/output for the MetricFlow integration matrix against a live API.

| File | Role |
|------|------|
| `ccaas_mf_payloads.json` | Request bodies sent to `POST /v1/semantic/query` |
| `ccaas_test_results.json` | Latest run output (HTTP status, rows, timing) |
| `stress_test_comparison_raw.json` | Side-by-side stress test capture |

**Regenerate results** (API must be running):

```bash
export CONTEXT_LAYER_URL=http://localhost:8765   # optional
python3 scripts/ccaas_mf_test.py
```

These files are **not** read at runtime by the Context Layer — they are test/evaluation artifacts only.
