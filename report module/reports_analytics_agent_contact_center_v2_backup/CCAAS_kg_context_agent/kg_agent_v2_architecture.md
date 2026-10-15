# Knowledge Graph Agent: Revised Architecture Plan v2

## Addresses Feedback on v1 Validation Plan

---

## 1. Cypher Pre-Validation for Read-Only Queries

**Q: "It's read-only, does it still need validation?"**

**Answer: Yes, but validation priorities shift.**

Since writes are blocked, we focus on:
1. **Result Bounding** (LIMIT enforcement) — prevent unbounded reads
2. **Schema Validity** — correct labels, properties, relationship types
3. **Parameter Binding** — prevent injection
4. **Performance Guardrails** — detect full scans, missing indexes

We **remove**:
- Write operation checks (CREATE, MERGE, SET, DELETE, REMOVE)
- Transaction safety checks

### Simplified Validation Pipeline for Read-Only

```yaml
llm_generated_cypher:
  → Parse & extract labels/properties/relationships
  → Validate against core.yaml schema (existence check)
  → Check for LIMIT clause (block if missing, auto-inject if absent)
  → Parameter binding validation (type check)
  → Dry-run EXPLAIN (validate execution plan, reject if full scan detected)
  → Execute
```

### Validation Rules

| Check | Action |
|-------|--------|
| No LIMIT clause | Auto-inject `LIMIT 100` or block |
| Invalid label/property | Block + return error |
| Missing WHERE clause | Warn + suggest org scoping |
| EXPLAIN shows full scan | Block + suggest index hint |
| Unbound parameters | Block + return error |

---

## 2. Multi-Tenancy: Separate Graphs Per Tenant

**Q: "I'm keeping different graphs for different tenants."**

### How This Changes Validation

Since each tenant has its own graph:
- **Organization scoping in Cypher** becomes **optional** (query is already tenant-scoped by nature of which graph we're connected to)
- Validation pipeline simplifies: no `WHERE org_id = $X` enforcement needed in Cypher
- **Security shifts to connection layer**: validate which graph a request can access

### Revised Validation Pipeline

```yaml
Tenant Graph Access:
  → Request includes tenant_id
  → Lookup tenant's Neo4j database/namespace
  → Route connection to that graph
  → Cypher queries run against tenant-specific graph
  → NO org_id filtering needed in Cypher (implicit by graph)

LLM-Generated Cypher:
  → Schema validation (labels, properties)
  → LIMIT enforcement
  → Parameter binding
  → EXPLAIN dry-run
  → Execute (already tenant-scoped)
```

### Tenant Isolation Options

| Strategy | Implementation | Pros | Cons |
|----------|---------------|------|------|
| **Separate DBs** | Neo4j fabric or multiple instances | Complete isolation | Higher infra cost |
| **Separate Schemas** | Same DB, different labels/prefixes | Lower cost | Shared infra risk |
| **Namespace/Partition** | Tenant property + composite index | Balanced | Query complexity |

For your use case, **Neo4j Fabric** or **separate databases per tenant** is recommended.

---

## 3. Schema Design: Concepts That Break "Is-A" Hierarchy

Your examples don't fit standard inheritance:

### Problem Case 1: Contact → Customer → Lead

```
Contact: "Person who contacted the business"
  ├── Customer: "A contact who purchased"
  └── Lead: "Contact but no purchase yet"
```

**Problem**: "Customer" and "Lead" are **temporal states/roles**, not distinct entity types. The same Contact can be a Lead → Customer over time.

**Solution**: Use a **role/status property** or **relationship-based typing**:

```yaml
# Option A: Status Property (Recommended)
cdp.customer_profile:
  mode: node
  label: Contact
  key: cdp_id
  properties:
    - cdp_id
    - first_name
    - last_name
    - contact_status: enum[lead, prospect, customer, churned]  # NEW
    - first_purchase_at: datetime  # NULL = not purchased
    - lifetime_value: decimal
  relationships:
    - HAS_CONTACT (from Tenant)
    - PLACED (to Order, optional)  # Has orders = customer

# LLM Query Pattern:
# "Show all customers" → MATCH (c:Contact) WHERE c.contact_status = 'customer'
# "Show leads" → MATCH (c:Contact) WHERE c.contact_status = 'lead'
# "Show contacts who became customers" → MATCH (c:Contact) WHERE c.first_purchase_at IS NOT NULL
```

```cypher
# Concept Card: customer_list
match_contact_type:
  entities: [Contact, Order]
  pattern: |
    MATCH (c:Contact)
    WHERE c.contact_status = $status
    OPTIONAL MATCH (c)-[:PLACED]->(o:Order)
    RETURN c.cdp_id, c.first_name, c.last_name, count(o) as total_orders
  keywords: [customer, lead, prospect, contact type]
```

### Problem Case 2: Conversation → Call / Web Session / Email Session

```
Conversation: "Set of interactions"
  ├── Call: "Voice channel"
  ├── Web Session: "Web chat channel"
  └── Email Session: "Email channel"
```

**Problem**: These are **channel-based subtyping**. The `channel` property already exists on Conversation. Creating separate node types adds redundancy.

**Solution**: Keep single `Conversation` node with `channel` property:

```yaml
ccass.conversations:
  mode: node
  label: Conversation
  key: id
  properties:
    - id
    - channel: enum[voice, webchat, email, whatsapp, sms]  # Explicit channel type
    - channel_metadata: json  # Channel-specific data (phone, email, etc.)
    - # ... other properties
  relationships:
    - HAS_CONVERSATION (from Tenant)
    - THROUGH (to Channel)  # Links to Channel config
    - HAS_WEBCHAT_SESSION (to WebchatSession, conditional)

# Query by channel:
# "Show calls" → WHERE c.channel = 'voice'
# "Show web sessions" → WHERE c.channel = 'webchat'
```

```cypher
# Concept Card: channel_conversations
by_channel:
  entities: [Conversation, Channel]
  pattern: |
    MATCH (c:Conversation)-[:THROUGH]->(ch:Channel)
    WHERE ch.channel_type = $channel_type
    RETURN c.id, c.status, c.channel, c.created_at
  keywords: [call, voice, webchat, email, session, conversation by channel]
```

### When to Create Separate Node Types

| Condition | Use Property | Create Subtype Node |
|-----------|-------------|---------------------|
| Different properties | ✓ | ✗ |
| Different relationships | ✓ | ✓ (if unique rels) |
| Different lifecycle | ✓ | ✓ |
| Semantic clarity needed | ✗ | ✓ |
| Query patterns differ | ✓ | ✓ |

**Rule of Thumb**: If two concepts share 80%+ properties and relationships, use a property discriminator. If they diverge significantly, consider separate types.

---

## 4. Revised Concept Card Schema for Your Architecture

```yaml
ConceptCard:
  id: string                    # Unique identifier
  domain: string                # e.g., "cdp.contacts", "ccass.conversations"
  entities: [string]           # Node labels involved
  traversal_pattern: string     # Human-readable pattern description
  cypher_template: |
    MATCH ...
    WHERE {channel} = $channel_type OR {status} = $status
    RETURN ...
  parameters:
    - name: channel_type
      type: enum
      values: [voice, webchat, email, whatsapp, sms]
    - name: status
      type: enum
      values: [lead, prospect, customer, churned]
  keywords: [string]
  examples:
    - "Show all calls from yesterday"
    - "List customers with high lifetime value"
  version: string
  schema_version: string
  constraints:
    - type: limit_required    # Must have LIMIT in query
    - type: channel_filter    # Requires channel type parameter
```

---

## 5. Handling Ambiguous Concepts in LLM Context

For concepts like Lead/Customer that depend on business rules:

### Option A: Include Calculation Logic in Concept Card

```cypher
# Concept Card: lead_vs_customer
contact_classification:
  entities: [Contact, Order]
  traversal: |
    # LEAD: Contact with no orders
    # CUSTOMER: Contact with at least one order
    # PROSPECT: Contact with status='prospect' AND no orders
    MATCH (c:Contact)
    OPTIONAL MATCH (c)-[:PLACED]->(o:Order)
    WITH c, count(o) as order_count
    RETURN c.cdp_id,
           CASE 
             WHEN order_count > 0 THEN 'customer'
             WHEN c.contact_status = 'prospect' THEN 'prospect'
             ELSE 'lead'
           END as classification
  keywords: [lead, customer, prospect, classify, segment]
```

### Option B: Pre-computed Flag (Recommended for Performance)

```yaml
cdp.customer_profile:
  properties:
    - is_customer: boolean     # Computed: has orders?
    - is_lead: boolean         # Computed: no orders + recent activity
    - is_prospect: boolean     # Computed: qualified lead
    - first_purchase_at: datetime
    - last_purchase_at: datetime
```

```cypher
# Query: "Show all customers"
MATCH (c:Contact) WHERE c.is_customer = true RETURN c
```

---

## Summary: Changes from v1

| Topic | v1 Plan | v2 Revised |
|-------|---------|------------|
| Cypher Validation | Full pipeline (write + read checks) | **Simplified**: schema validity + LIMIT + EXPLAIN |
| Multi-Tenancy | `WHERE org_id = $X` in every query | **Separate graphs per tenant** (connection-level isolation) |
| Contact/Customer/Lead | Separate node types | **Single Contact with `contact_status` property** |
| Channel Subtypes | Separate node types | **Single Conversation with `channel` property** |
| Validation Block | Org scoping enforcement | **Remove org filtering** (implicit by graph) |

---

## Implementation Priority

1. **Immediate**: Migrate Contact/Customer/Lead to single type with status
2. **Immediate**: Migrate Call/Webchat/Email to single Conversation with channel
3. **Next**: Simplify validation pipeline (remove write checks, add LIMIT guard)
4. **Next**: Implement per-tenant graph isolation in connection layer
5. **Later**: Add Concept Cards with proper traversal patterns

