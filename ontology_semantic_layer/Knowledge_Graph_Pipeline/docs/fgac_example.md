## Neo4j Fine-Grained Access Control (FGAC) Example

To implement the security model where a **Support Agent** can traverse from `Customer` to `SupportTicket` and `Product`, but cannot access `SalesDeal` or `DealValue`, you would define the following Neo4j Enterprise Edition Role-Based Access Control (RBAC) grants.

```cypher
// 1. Create the scoped role for the Support Agent
CREATE ROLE support_agent IF NOT EXISTS;

// 2. Grant TRAVERSE and READ privileges on the permitted nodes
GRANT TRAVERSE ON GRAPH * NODES Customer, Product, SupportTicket TO support_agent;
GRANT READ {*} ON GRAPH * NODES Customer, Product, SupportTicket TO support_agent;

// 3. Grant TRAVERSE privileges on the permitted relationships
GRANT TRAVERSE ON GRAPH * RELATIONSHIPS PURCHASED, RAISED_TICKET TO support_agent;
GRANT READ {*} ON GRAPH * RELATIONSHIPS PURCHASED, RAISED_TICKET TO support_agent;

// 4. Explicitly DENY access to the restricted sales nodes (optional but recommended for zero-trust)
DENY TRAVERSE ON GRAPH * NODES SalesDeal, DealValue TO support_agent;
DENY READ {*} ON GRAPH * NODES SalesDeal, DealValue TO support_agent;

// 5. Explicitly DENY access to the restricted sales relationships
DENY TRAVERSE ON GRAPH * RELATIONSHIPS HAS_DEAL, HAS_DEAL_VALUE TO support_agent;
```

With these rules in place, if the Support Agent attempts to run a query like:
`MATCH (c:Customer)-[:PURCHASED]->(p:Product), (c)-[:HAS_DEAL]->(d:SalesDeal) RETURN *`

Neo4j will silently filter out the `SalesDeal` branch from the result set without throwing an error, ensuring the agent only sees the `Customer` and `Product` subgraph.
