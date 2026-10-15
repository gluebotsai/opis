# Knowledge Graph Agent Architecture: Validation & Suggestions

## Overview

Architecture: **Pre-Retrieval Dynamic Context Injection** via Concept Cards in Meilisearch with Sliding Query Window for conversational continuity.

---

## Validation Against `core.yaml`

The schema spans 5 domains with 30+ node types and 40+ relationship types. The architecture is **well-suited** for this complexity.

### What Works Well

| Aspect | Assessment |
|--------|------------|
| **Concept Cards** | Excellent fit — maps naturally to domain-specific subgraph patterns (e.g., SLA monitoring, agent routing, customer scoring) |
| **Sliding Query Window** | Correctly addresses follow-up ambiguity (e.g., "how will it affect us?" after discussing queues) |
| **Latency model** | Sub-ms Meilisearch + targeted prompt = fast LLM inference; avoids token flooding |
| **Multi-domain decoupling** | Each domain (accounts, ccass, cdp, inventory) can produce independent Concept Cards |

### Critical Gaps

#### 1. **Concept Cards = Domain Patterns, Not Entity Docs**
The core.yaml describes individual entities. But an agent doesn't just query one entity — it queries **patterns**. Concept Cards should encode traversal patterns:

```yaml
Card: sla_monitor
  domain: ccass.conversations
  entities: [Conversation, SLAInstance, SLA, Queue]
  traversal: "Find conversations with breached/approaching SLA by following HAS_SLA → BASED_ON chains"
  cypher_template: |
    MATCH (c:Conversation)-[:HAS_SLA]->(s:SLAInstance)-[:BASED_ON]->(sl:SLA)
    WHERE c.organization_id = $org_id
      AND (s.breached_at IS NOT NULL OR s.first_response_warning_at <= datetime())
    RETURN c.id, c.status, sl.name, s.first_response_due_at, s.breached_at
  keywords: [sla, breached, response time, resolution, overdue, warning]
  examples:
    - "Which conversations are breaching SLA?"
    - "Show me SLA warnings"
    - "Which tickets are overdue?"
```

#### 2. **"Zero Cards Match" Scenario**
No fallback defined. Add a priority-based resolution chain:

```
1. Primary search → matched Concept Cards → proceed
2. No match → fallback to {card: "kg_explorer", priority: -1} — generic entity lookup
3. Multiple matches (≥4 cards) → apply relevance scoring, take top 3
4. No fallback card either → return explicit "could not determine domain" + suggest intent clarification
```

#### 3. **Schema Versioning**
core.yaml evolves. Concept Cards must be versioned to avoid stale templates:

```yaml
Card: queue_routing
  version: "1.0"
  schema_version: "1"
  deprecated: false
  replacement_card_id: null
```

On schema deploy: regenerate all affected Concept Cards, flag deprecated ones.

#### 4. **Hybrid Search (Meilisearch + Semantic)**
Meilisearch is optimized for typo-tolerant keyword search. For domain jargon, add vector embeddings:

- **Keyword layer** (Meilisearch): exact matches, abbreviations (e.g., "SLA", "cdp")
- **Semantic layer** (embedding model): handles synonyms ("breached" ↔ "overdue" ↔ "missed deadline")
- **Combined**: rank fusion of both results

This matters because the core.yaml uses industry terms ("disposition", "overflow", "handoff") that pure keyword search misses in conversational contexts.

#### 5. **Cypher Pre-Validation Before Execution**
Generated Cypher can still be wrong. Add a guard:

```
LLM-generated Cypher
  → Cypher lint/static analysis
  → Parameter binding validation
  → Dry-run (EXPLAIN) in sandboxed Neo4j
  → Blocked if: invalid labels, type mismatches, unbounded queries (no LIMIT)
  → Passes → execute
```

#### 6. **Organization Scoping (Multi-Tenancy)**
core.yaml entities all carry `organization_id`. Concept Card templates must enforce:

```cypher
WHERE c.organization_id = $organization_id
```

If the LLM generates a query without `organization_id` in WHERE, block execution.

---

## Suggested Implementation Roadmap

### Phase 1: Concept Card Schema & Generation
- [ ] Define ConceptCard structure (id, domain, entities, relationships, cypher_template, keywords, examples, version)
- [ ] Write a generator script that parses core.yaml and auto-scaffolds Concept Cards for each domain
- [ ] Domain expert manually writes/refines cypher_templates per card
- [ ] Version each card with `schema_version` from core.yaml

### Phase 2: Meilisearch Index Setup
- [ ] Configure Meilisearch index with keyword attributes: `keywords`, `domain`, `entities`, `examples`
- [ ] Enable typo tolerance for conversational queries
- [ ] (Optional) Add vector embeddings for semantic search layer
- [ ] Implement sliding query window (concatenate current + last user turn before search)

### Phase 3: Retrieval & Execution Pipeline
- [ ] Query Meilisearch with sliding window → retrieve top-N Concept Cards
- [ ] Build prompt: inject card's cypher_template + entity schema into LLM system prompt
- [ ] LLM generates parameterized Cypher
- [ ] Validate: org-scoped, bounded (LIMIT), no schema violations
- [ ] Execute against Neo4j with `organization_id` parameter
- [ ] Return results to user

### Phase 4: Fallback & Error Handling
- [ ] Implement "zero match" fallback card
- [ ] Rate limit per org to prevent prompt injection
- [ ] Add execution metrics (retrieval latency, LLM latency, Cypher execution time)

---

## Summary

Your architecture is **sound and well-suited** for this schema. The core innovation — decoupling ontology knowledge from the LLM prompt via retrievable Concept Cards — is the right approach for a complex, multi-domain knowledge graph.

The main improvements to make:

1. **Cards encode traversal patterns** (not just entities)
2. **Hybrid search** for domain jargon
3. **Strict Cypher pre-validation** before execution
4. **Schema versioning** on Concept Cards
5. **Explicit zero-match fallback** with graceful degradation
