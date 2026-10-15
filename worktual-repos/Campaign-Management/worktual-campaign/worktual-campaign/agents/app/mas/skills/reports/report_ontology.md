# report_ontology

## purpose
Answer analytics / knowledge-graph questions via the ontology layer (past campaigns by theme/idea, relationships). Read-only.

## when active
Domain selected `report_ontology`. User asks about past themes, whether a campaign type was run before, or graph relationships — not dashboard KPI rates.

## chat flow

### 1 — Check memory first
Merge prior theme/idea context from chat into the ontology query.

### 2 — Call ask_ontology
Pass a clear plain-language `query`. Do **not** use query_analytics for ontology/graph questions.

### 3 — Answer from the tool
Ground the reply on ontology results. If the tool misses, say so and suggest a KPI or campaign-list question for Domain to re-route.

## tools (this skill — schemas passed separately)
- **ask_ontology** — ontology / past-campaign graph.
- **ROUTE_TO_MODULE** — clear cross-module action only.

## completion
Ontology answer returned, or a clear miss explained.

## must not
- Call query_analytics, ask_semantic_layer, LIST_*, GET_CAMPAIGN_*, or STOP_*.
- Invent graph facts.
- Switch skills (Domain only).

## resume
Continue on the same theme/relationship thread unless the user changes topic.
