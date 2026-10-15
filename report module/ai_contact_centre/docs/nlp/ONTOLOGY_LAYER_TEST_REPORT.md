# Ontology Layer — Test Report

**Date:** 2026-08-24  
**Organization:** `1000`  
**Ontology endpoint:** `POST http://192.168.11.156:8000/chat/stream`  
**Semantic layer (validation):** `POST http://192.168.13.244:8800/ask`  
**Postgres (ground truth):** `worktual_bigint` / `ccass` schema  

No application code was changed during these tests. All calls were made via `curl` and Python SSE parsers.

---

## Executive summary

| Category | Correct | Total | Rate |
|----------|---------|-------|------|
| **KPI / compare questions** | 2 | 6 | 33% |
| **Why / conceptual questions** | 4 | 4 | 100% |
| **All 10-question batch** | 6 | 10 | 60% |

**Semantic layer vs Postgres (6 KPI questions):** 4 exact matches, 2 definition-sensitive (missed contact rate formula, AHT outlier handling).

**Recommendation:** Route **KPIs and counts** to the semantic layer first; use ontology for **why / how / relationship** explanations. Do not trust ontology graph counts for channel mix, rates, or AHT without semantic-layer confirmation.

---

## API contract

### Request

```json
POST /chat/stream
Content-Type: application/json

{
  "sessionID": "",
  "query": "<natural language question>",
  "organization_id": "1000"
}
```

| Field | Notes |
|-------|--------|
| `sessionID` | Empty string works for new turns; `done.turnId` can be reused for follow-ups |
| `query` | Natural language question |
| `organization_id` | String tenant id (e.g. `"1000"`) |

### Response (SSE)

| Event | Purpose | Example |
|-------|---------|---------|
| `status` | Phase label for UI | `phase: "fetching"`, `label: "Fetching: MATCH…"` |
| `activity` | Step progress | `step_id: "concepts"`, `status: "completed"` |
| `tool_call` | Graph query fired | `name: "knowledge_graph"`, Cypher in `arguments` |
| `block` | Tool run status | `status: "success"`, `summary: "1 row returned"` |
| `text_delta` | Streamed answer chunks | `delta: "**5 conversations**…"` |
| `done` | Turn complete | `elapsed_seconds`, `turnId` |

### Typical SSE flow

```
status [understanding]     → Understanding your question…
activity [running]         → Understanding your question
activity [running]         → Finding relevant metrics (concepts)
status [concepts]          → Found: Missed Contacts, FCR, …
activity [completed]       → understand + concepts
activity [running]         → Analyzing & calculating
status [planning]          → Planning the analysis…          ← KPI questions
status [querying]          → Writing the analytics query…
status [fetching]          → Fetching: MATCH (c:Conversation)…
tool_call                  → knowledge_graph + Cypher
block [running/success]    → Query · MATCH … / N rows returned
activity [running]         → Preparing results
status [writing]           → Writing my reply…
text_delta × N             → streamed markdown
done                       → elapsed_seconds, turnId
```

**Conceptual / why questions** often skip `querying` → `fetching` → `tool_call` (~4–6s).  
**KPI questions** almost always invoke `knowledge_graph` (~5–9s).

---

## Test 1 — Initial smoke tests

### Relationship / “why” question

**Query:** `What is missed contact rate and how is it related to queue staffing?`

| Item | Value |
|------|-------|
| Elapsed | ~12s |
| `turnId` | `020cec89-e422-43c0-a73b-50bb6c31def0` |
| Tool calls | Concepts + analysis (no Cypher in first run) |
| Result | Good markdown explanation of missed contacts vs abandonment, staffing gaps (`no_ready_agents`, `no_shift_coverage`) |

### Simple KPI count (first run — graph stale)

**Query:** `How many conversations were handled yesterday?`

| Source | Answer |
|--------|--------|
| Ontology (run 1) | **0** on Aug 23, 2026 |
| Semantic layer | **12** |
| Postgres (`created_at`) | **12** |

First Cypher attempt failed (`Invalid label` datetime parse); retry succeeded but answer was wrong. Graph data appeared out of sync.

### Re-test (graph synced)

| Source | Answer |
|--------|--------|
| Ontology (run 2) | **12** on Aug 23, 2026 |
| Semantic layer | **12** |
| Postgres | **12** |

---

## Test 2 — Ten-question batch

**Endpoint:** `http://192.168.11.156:8000/chat/stream`  
**Org:** `1000`  
**Note:** Empty `sessionID` caused “I already answered this earlier” on some follow-up runs. Use a fresh UUID per question in production.

### Results

| # | Type | Question | Time | Tool? | Ontology | Semantic / truth | Valid? |
|---|------|----------|------|-------|----------|------------------|--------|
| Q1 | KPI | How many conversations handled **today**? | 5.5s | Yes | **5** | Semantic **5**, PG **5** | ✅ |
| Q2 | KPI | Missed contact rate **last 7 days**? | 9.3s | Yes | **23.8%** (30/126) | Semantic **60.7%** | ❌ |
| Q3 | KPI | Top channel **last 30 days**? | 6.8s | Yes | **sample-whatsapp: 23** | Semantic **webchat: 117** | ❌ |
| Q4 | KPI | Average handle time **7d**? | 7.3s | Yes | **5,878s (~98 min)** | Semantic **718s (~12 min)** | ❌ |
| Q5 | KPI | Resolved **yesterday**? | 3.7s | Yes | **5** | Semantic **5**, PG **5** | ✅ |
| Q6 | conceptual | Missed contact vs abandonment? | 6.6s | No | Good table + definitions | N/A | ✅ |
| Q7 | conceptual | Agent availability → wait time? | 4.8s | No | Good explanation | N/A | ✅ |
| Q8 | why | Why missed contacts spike when understaffed? | 5.3s | No | Causal chain | N/A | ✅ |
| Q9 | compare | Webchat vs WhatsApp **this month**? | 8.6s | Yes (2×) | **0 webchat, WA 23** | Semantic **117 / 26** | ❌ |
| Q10 | why | Factors driving FCR? | 5.6s | No | Good factor list | N/A | ✅ |

### Sample Cypher (Q1 — correct)

```cypher
MATCH (c:Conversation)
WHERE c.created_at >= datetime('2026-08-24T00:00:00Z')
  AND c.created_at < datetime('2026-08-24T16:00:00Z')
RETURN count(c) AS conversation_count
```

### Ontology errors observed

- **Channel labels:** Graph uses `sample-whatsapp`, `sample-insta` instead of `whatsapp`, `webchat`.
- **Missed contact rate:** Graph computes its own ratio (30/126 = 23.8%) — does not match semantic cube (60.7%).
- **AHT:** Graph average skewed by long-running conversations (~98 min vs semantic ~12 min).

---

## Test 3 — Why / conceptual deep dive

### Pure mechanism questions (no org-specific counts)

| Question | Tool calls | Numbers in answer | Quality |
|----------|------------|-------------------|---------|
| Why might missed contacts spike when staffing is low? | 0 | None (only numbered list 1–3) | ✅ Good |
| How does low staffing cause missed contacts? | 0 | None | ✅ Good |

These explain **how** things work using product terms (`no_ready_agents`, `no_shift_coverage`) without citing org metrics.

### Diagnostic “why” questions (pulls graph data)

| Question | Tool calls | Ontology claims | vs semantic | Valid? |
|----------|------------|-----------------|-------------|--------|
| Why is our missed contact rate high? | 6 | 4 this week vs 92 last week; “rate is **not** high” | Semantic **~53–61%** — still high | ❌ Wrong framing |
| Why more abandonments last week? | 1 | 12 / 41 (29.3%), all `support` queue | PG **131** convos in period; no abandonment metric | ❌ Wrong denominator |
| What factors drive FCR? | 5 | 3 resolved, 100% FCR (Aug 24–31) | Semantic: no FCR metric | ⚠️ Unverified |
| Why spike on Aug 20? | 0 | Deflected — asked user to pick analysis | Semantic: **75%** on Aug 20 | ❌ No answer |

### Rule of thumb

| Pattern | Counts in answer? | Trust for numbers? |
|---------|-------------------|-------------------|
| “Why **might** X happen?” | Usually no | N/A — explanation only |
| “Why is **our** X high?” | Yes (tables, %) | ❌ Validate via semantic layer |
| “Why did **we** see more Y on date Z?” | Often yes | ❌ Often wrong or deflected |

---

## Test 4 — Semantic layer vs Postgres (6 KPI questions)

Validated **2026-08-24** against `ccass.conversations` and `ccass.agent_missed_contacts` for org `1000`.

| # | Question | Semantic | Postgres | Match? |
|---|----------|----------|----------|--------|
| Q1 | Conversations handled today | **5** | **5** (`created_at >= today`) | ✅ Exact |
| Q2 | Missed contact rate 7d | **60.7%** | **28.2%** naive (37÷131); **38.5%** (37÷96 routing attempts) | ⚠️ Different formula |
| Q3 | Top channel 30d | **webchat 117** | **webchat 117** | ✅ Exact |
| Q4 | AHT 7d | **718 sec** (~12 min) | **8,935 sec** raw; **625 sec** trimmed (excl. >24h) | ⚠️ Close if outliers removed |
| Q5 | Resolved yesterday | **5** | **5** (`resolved_at`) | ✅ Exact |
| Q6 | Webchat vs WhatsApp this month | **117 / 26** | **117 / 26** | ✅ Exact |

### Q1 nuance

| Definition | Count |
|------------|-------|
| Created today (`created_at`) | **5** ← semantic uses this |
| Resolved/closed today | **4** |

### Q2 nuance

- Postgres missed contacts (7d): **37**
- Postgres conversations (7d): **131**
- Semantic rate **60.7%** implies denominator ≈ **61** (37 ÷ 0.6066)
- Do **not** compute missed rate as `missed ÷ all conversations` in raw SQL

### Q3 — channel breakdown (30d)

| Channel | Semantic | Postgres |
|---------|----------|----------|
| webchat | 117 | 117 |
| whatsapp | 26 | 26 |
| email | 7 | 7 |
| instagram | 2 | 2 |

### Q4 nuance — outlier skew

| Method | AHT |
|--------|-----|
| Semantic layer | **718 sec** |
| Postgres raw average | **8,935 sec** |
| Postgres median | **188 sec** |
| Postgres excl. handles >24h | **625 sec** |

Top outliers: conversation `14797` (~2,759 min), `14960` (~1,694 min).

### Q5 nuance

- Resolved yesterday (`resolved_at`): **5** ← semantic matches
- Closed yesterday (`closed_at`): **10**

---

## Ontology vs semantic vs Postgres (KPI summary)

| Question | Ontology | Semantic | Postgres | Best source |
|----------|----------|----------|----------|-------------|
| Handled today | 5 ✅ | 5 | 5 | Any (aligned) |
| Missed rate 7d | 23.8% ❌ | 60.7% | 37 missed; rate formula-specific | **Semantic** |
| Top channel 30d | sample-whatsapp ❌ | webchat 117 | webchat 117 | **Semantic / Postgres** |
| AHT 7d | 98 min ❌ | 12 min | 12 min trimmed | **Semantic** |
| Resolved yesterday | 5 ✅ | 5 | 5 | Any (aligned) |
| Webchat vs WA month | 0 / 23 ❌ | 117 / 26 | 117 / 26 | **Semantic / Postgres** |

---

## Routing recommendation (for dashboard analytics agent)

```
┌─────────────────────────────────────────────────────────────┐
│  User question                                              │
└───────────────────────────┬─────────────────────────────────┘
                            │
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
     KPI / count /     Why / how /      Custom SQL /
     rate / mix /      relationship /   report export
     trend             concept            (fallback)
            │               │               │
            ▼               ▼               ▼
   ask_semantic_layer   ask_ontology_layer   sql_analytics /
   (MANDATORY FIRST)    (/chat/stream)       generate_performance_report
            │
            ├─ ok=true → terminal card + HTML summary
            └─ ok=false → sql_analytics or generate_performance_report
```

| Intent | Tool | Notes |
|--------|------|-------|
| Counts, rates, mixes, trends | `ask_semantic_layer` | Validated against Postgres |
| Why / how / definitions / root cause (no “our numbers”) | `ask_ontology_layer` | Strong qualitative answers |
| Why is **our** metric high / why did **we** spike | Semantic **first** for numbers, ontology **second** for interpretation | Never trust ontology counts alone |
| Semantic miss or custom period | `sql_analytics` | Existing Path B |

---

## Planned integration (not implemented)

| Item | Detail |
|------|--------|
| Gateway | `apps/nlp/src/app/services/ontology_layer.py` — SSE client, aggregate `text_delta` |
| Config | `ONTOLOGY_LAYER_URL=http://192.168.11.156:8000` |
| MCP tool | `ask_ontology_layer` on analytics server |
| Surfaces | `dashboard`, `performance`, `reports` in `SURFACE_TOOLS` |
| Prompts | Path O in `analytics.py` / `coworker.py` for graph/why questions |
| SSE labels | `runtime/sse.py` — map ontology `status` / `activity` phases |
| Session | Pass `turnId` from `done` as `sessionID` on follow-up turns |
| Fresh session | Generate new UUID per unrelated question to avoid “already answered” cache |

---

## Appendix — Postgres reference queries

```sql
-- Q1: conversations created today
SELECT COUNT(*) FROM ccass.conversations
WHERE organization_id = 1000 AND created_at >= CURRENT_DATE;

-- Q3: channel volume 30d
SELECT channel, COUNT(*) FROM ccass.conversations
WHERE organization_id = 1000
  AND created_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY 1 ORDER BY 2 DESC;

-- Q5: resolved yesterday
SELECT COUNT(*) FROM ccass.conversations
WHERE organization_id = 1000
  AND resolved_at >= CURRENT_DATE - 1
  AND resolved_at < CURRENT_DATE;

-- Q6: webchat vs whatsapp this month
SELECT channel, COUNT(*) FROM ccass.conversations
WHERE organization_id = 1000
  AND created_at >= date_trunc('month', CURRENT_DATE)
  AND channel IN ('webchat', 'whatsapp')
GROUP BY 1;
```

---

## Appendix — curl examples

```bash
# Ontology (SSE stream)
curl -sS -N -X POST "http://192.168.11.156:8000/chat/stream" \
  -H "Content-Type: application/json" \
  -d '{"sessionID":"","query":"Why might missed contacts spike when staffing is low?","organization_id":"1000"}'

# Semantic layer (JSON)
curl -sS -X POST "http://192.168.13.244:8800/ask" \
  -H "Content-Type: application/json" \
  -d '{"query":"How many conversations were handled today?","tenant_id":"1000","product":"aiccaas"}'
```

---

*Generated from manual integration tests on 2026-08-24. Re-run after ontology graph sync or semantic cube changes.*
