# Skill: `error-recovery-and-guardrails`

## Overview & Purpose
Provides negative guardrails (read-only enforcement, product domain fences, division-by-zero protection) and the exact self-repair procedures for handling `REPAIR`, `DENY`, and `REPLAN` errors.

---

## 1. Negative Directives & Security Fencing
* **Strict Read-Only**: Never use `CREATE`, `MERGE`, `SET`, `DELETE`, `DETACH`, `REMOVE`, `DROP`, or `ALTER`.
* **No Variable Hops**: Never use `[*..]`, `shortestPath`, or `allShortestPaths`.
* **No External APOC/DBMS**: Never call `CALL dbms.*`, `CALL apoc.*`, or `LOAD CSV`.
* **Domain Fencing**: Never query foreign product labels (`Ticket`, `Deal`, `Campaign`, `Proactive*`).
* **Mandatory Row Cap**: Every dynamic query must end with a `LIMIT` clause (default 50 for paths, 20 for breakdowns).
* **Division-by-Zero Guard**: Always wrap divisions and ratio calculations:
  ```cypher
  MATCH (c:Conversation)
  RETURN count(c) AS total,
         CASE WHEN count(c) > 0 THEN round(100.0 * count(CASE WHEN c.resolution_code = 'resolved' THEN 1 END) / count(c), 2) ELSE 0.0 END AS resolution_rate_pct
  LIMIT 10
  ```

---

## 2. Error Recovery & Self-Repair Recipes

When `run_cypher` returns an error (`"status": "error"`), apply the corresponding recovery protocol:

### Recipe 1: `error_type: "REPAIR"` (Invalid Identifier)
* **Trigger**: Query referenced an invalid label, relationship, or property name.
* **Protocol**:
  1. Extract the rejected identifier from the error message.
  2. **STRICT RULE**: Do NOT repeat the rejected identifier in the retry query.
  3. Consult `schema_registry.json` and replace it with a valid CCaaS entity or telemetry property.
  4. Re-emit the corrected query.

### Recipe 2: `error_type: "DENY"` (Forbidden Domain / Mutation)
* **Trigger**: Query attempted cross-domain access (e.g., tickets, deals) or write operations.
* **Protocol**:
  1. Immediately strip all foreign domain entities.
  2. Constrain the query strictly to CCaaS entities (`Conversation`, `MissedContact`, `Transfer`, `ContactCentreQueue`, `ContactCentreAgent`).
  3. Re-emit the read-only query.

### Recipe 3: `error_type: "REPLAN"` (Syntax / Template Failure)
* **Trigger**: Certified template not found or malformed Cypher syntax.
* **Protocol**:
  1. Fall back to a standard dynamic `MATCH (c:Conversation) ... RETURN ... LIMIT 20` query.
  2. Verify correct Cypher syntax and re-emit.
