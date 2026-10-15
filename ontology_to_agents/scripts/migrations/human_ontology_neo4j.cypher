// Human-readable ontology migration (all products).
// Run per tenant database after deploying core.yaml label changes.
// Idempotent: safe to re-run.

// --- Ticketing label renames ------------------------------------------------
MATCH (n:SupportCase) SET n:Ticket REMOVE n:SupportCase;
MATCH (n:CaseNote) SET n:Note REMOVE n:CaseNote;
MATCH (n:SupportAccount) SET n:ContactAccount REMOVE n:SupportAccount;
MATCH (n:SupportQueue) SET n:Queue REMOVE n:SupportQueue;
MATCH (n:CannedReply) SET n:Macro REMOVE n:CannedReply;
MATCH (n:EmailThreadRef) SET n:InboundEmail REMOVE n:EmailThreadRef;
MATCH (n:EmailDispatchRecord) SET n:OutboundEmail REMOVE n:EmailDispatchRecord;
MATCH (n:WorkflowRule) SET n:AutomationRule REMOVE n:WorkflowRule;
MATCH (n:ProactiveSuggestion) SET n:Suggestion REMOVE n:ProactiveSuggestion;
MATCH (n:ActionApproval) SET n:Approval REMOVE n:ActionApproval;
MATCH (n:AuditRecord) SET n:AuditLog REMOVE n:AuditRecord;

// --- StaffRole -> Agent -------------------------------------------------------
MATCH (n:StaffRole) SET n:Agent REMOVE n:StaffRole;

// --- Employee -> User ---------------------------------------------------------
MATCH (n:Employee) SET n:User REMOVE n:Employee;

// --- SupportProfile -> rewire to Contact --------------------------------------
MATCH (t:Ticket)-[r:RAISED_BY]->(sp:SupportProfile)
MATCH (c:Contact {cdp_id: sp.cdp_id})
MERGE (t)-[:raised_by]->(c)
DELETE r;
MATCH (t:Ticket)-[r:FOR_CUSTOMER]->(c:Contact)
MERGE (t)-[:raised_by]->(c)
DELETE r;
MATCH (sp:SupportProfile) DETACH DELETE sp;

// --- CaseStatus nodes (if any) ------------------------------------------------
MATCH (s:CaseStatus) DETACH DELETE s;

// --- CRM / platform renames ---------------------------------------------------
MATCH (n:Opportunity) SET n:Deal REMOVE n:Opportunity;
MATCH (n:WebVisitor) SET n:Visitor REMOVE n:WebVisitor;
MATCH (n:BehaviourEvent) SET n:Event REMOVE n:BehaviourEvent;
MATCH (n:MessageDelivery) SET n:Message REMOVE n:MessageDelivery;
MATCH (n:WorkTask) SET n:Task REMOVE n:WorkTask;
MATCH (n:AudienceSegment) SET n:Segment REMOVE n:AudienceSegment;
MATCH (n:TrackedSite) SET n:Website REMOVE n:TrackedSite;
MATCH (n:ServiceLevelPolicy) SET n:SLA REMOVE n:ServiceLevelPolicy;
MATCH (n:ServiceQueue) SET n:Queue REMOVE n:ServiceQueue;

// --- Relationship type renames (business paths) -------------------------------
// Ticket customer link
MATCH ()-[r:FOR_CUSTOMER]->() CALL { WITH r MATCH (a)-[r]->(b) CREATE (a)-[:raised_by]->(b) DELETE r } IN TRANSACTIONS OF 1000 ROWS;
MATCH ()-[r:RAISED_BY]->() CALL { WITH r MATCH (a)-[r]->(b) CREATE (a)-[:raised_by]->(b) DELETE r } IN TRANSACTIONS OF 1000 ROWS;

// Assignment
MATCH ()-[r:ASSIGNED_L1]->() CALL { WITH r MATCH (a)-[r]->(b) CREATE (a)-[:assigned_to]->(b) DELETE r } IN TRANSACTIONS OF 1000 ROWS;
MATCH ()-[r:ASSIGNED_TO]->() CALL { WITH r MATCH (a)-[r]->(b) CREATE (a)-[:assigned_to]->(b) DELETE r } IN TRANSACTIONS OF 1000 ROWS;
MATCH ()-[r:RESOLVER_L2]->() CALL { WITH r MATCH (a)-[r]->(b) CREATE (a)-[:resolved_by]->(b) DELETE r } IN TRANSACTIONS OF 1000 ROWS;
MATCH ()-[r:RESOLVED_BY]->() CALL { WITH r MATCH (a)-[r]->(b) CREATE (a)-[:resolved_by]->(b) DELETE r } IN TRANSACTIONS OF 1000 ROWS;

// People
MATCH ()-[r:ROLE_OF]->() CALL { WITH r MATCH (a)-[r]->(b) CREATE (a)-[:role_of]->(b) DELETE r } IN TRANSACTIONS OF 1000 ROWS;
MATCH ()-[r:HAS_EMPLOYEE]->() CALL { WITH r MATCH (a)-[r]->(b) CREATE (a)-[:has_user]->(b) DELETE r } IN TRANSACTIONS OF 1000 ROWS;
MATCH ()-[r:ABOUT_EMPLOYEE]->() CALL { WITH r MATCH (a)-[r]->(b) CREATE (a)-[:about_user]->(b) DELETE r } IN TRANSACTIONS OF 1000 ROWS;
