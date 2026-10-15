# Reports workflow

**Tools:** query_analytics, ask_semantic_layer, LIST_MONITOR_CAMPAIGNS, GET_CAMPAIGN_REPORT, GET_CAMPAIGN_AUDIENCE, STOP_*, RESUME_CHANNEL, LIST_EVENTS, GET_EVENT_DETAIL, ROUTE_TO_MODULE.

## Chat NL analytics (CRM handoff spine)

1. Data questions → `query_analytics` first.
2. Pipeline: semantic `POST {SEMANTIC_LAYER_GATEWAY_URL}/ask` (`product=campaign`) → allowlisted `POST /api/analytics/ask` (`campaign_sql`) → LIST_MONITOR / GET_CAMPAIGN_REPORT.
3. Map rows → `analytics.visual` v1.0 → chat bubble (`AnalyticsVisual`).
4. Dashboard Overview reloads when a chart arrives in chat.
5. Greetings → text only, no tools.

Env (agents): `SEMANTIC_LAYER_GATEWAY_URL`, `SEMANTIC_LAYER_PRODUCT=campaign`, `SEMANTIC_LAYER_TIMEOUT_S`.
Ontology (analytics / Past Analyst): `ONTOLOGY_CHAT_STREAM_URL` (default `http://82.113.92.44:8000/chat/stream`).

**Routing (LLM + tools):**
- Analytics / past-campaign / graph → tool `ask_ontology` → ontology chat/stream
- Reports / KPI rates & volumes → tool `query_analytics` → semantic `/ask` (then campaign_sql)

### Smoke

```bash
# Reports — semantic gateway
curl -sS -X POST "$SEMANTIC_LAYER_GATEWAY_URL/ask" \
  -H 'Content-Type: application/json' \
  -d '{"query":"what is our open rate","organization_id":"<org_id>","product":"campaign"}'

# Analytics — ontology chat/stream
curl -sS -X POST "${ONTOLOGY_CHAT_STREAM_URL:-http://82.113.92.44:8000/chat/stream}" \
  -H 'Content-Type: application/json' \
  -d '{"sessionID":"","query":"list recent campaigns","organization_id":"<org_id>"}'

# Campaign allowlisted fallback (JWT)
curl -sS -X POST "http://127.0.0.1:3001/api/analytics/ask" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"query":"open rate last 7 days","period":{"relative":"last_7_days"}}'
```

Call tools before stating any number. Period windows must match Dashboard (IST launch date). Rates from the gateway may be fractions — the visual formats them as %. Prefer `*_display` fields from campaign tools.
