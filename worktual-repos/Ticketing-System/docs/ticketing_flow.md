# Ticket Management Flow Design

## Overview

The Ticket Management System is designed to automate ticket routing while allowing controlled manual intervention when required.

The system consists of four primary roles:

- Customer
- Agent
- Resolver
- Admin

The overall objective is to:

- Automatically assign the right Agent based on team.
- Allow the Agent to perform first-level analysis.
- Route only complex issues to the appropriate Resolver based on skills.
- Allow controlled reassignment and escalation.
- Maintain complete ownership, SLA tracking, and audit history.

---

# Roles and Responsibilities

| Role | Responsibility |
|------|----------------|
| Customer | Creates tickets and tracks progress |
| Agent | First-level support, customer communication, ticket ownership |
| Resolver | Technical investigation and resolution |
| Admin | System configuration, monitoring, overrides, reporting |

---

# Final Ticket Flow

```text
                    ┌─────────────────────┐
                    │   Ticket Created    │
                    └──────────┬──────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
        ▼                      ▼                      ▼
    Customer               Agent                  Admin
        │                      │                      │
        └────────────── Creates Ticket ───────────────┘
                               │
                               ▼
                     Ticket Status = NEW
                               │
                               ▼
               AI Categorization (Optional)
                               │
                               ▼
                     team Identification(AI)
                               │
                               ▼
              Agent Assignment based on team and workload (AI)
       (Skill + team + Workload + Availability)
                               │
                               ▼
                        Agent Assigned
                               │
                               ▼
                     Agent Accepts Ticket
                               │
                               ▼
                     Agent Investigation
                               │
          ┌────────────────────┴────────────────────┐
          │                                         │
          ▼                                         ▼
   Solved by Agent                         Needs Resolver
          │                                         │
          ▼                                         ▼
 Ticket Resolved                   Skill-Based Resolver Assignment
                                                    │
                                                    ▼
                                           Resolver Accepts
                                                    │
                                                    ▼
                                            Resolver Works
                                                    │
                       ┌────────────────────────────┴──────────────────────────┐
                       │                                                       │
                       ▼                                                       ▼
               Ticket Resolved                                  Escalate Resolver
                       │                                                       │
                       ▼                                                       ▼
              Notify Customer                                     Higher-Level Resolver
                       │                                                       │
                       └───────────────────────┬───────────────────────────────┘
                                               ▼
                                       Customer Confirmation
                                               │
                                               ▼
                                         Ticket Closed
```

---

# Flow 1 – Ticket Creation

## Description

A ticket can be created by:

- Customer
- Agent
- Admin

Regardless of who creates the ticket, the same automated routing process begins.

### Process

```
Create Ticket
      │
      ▼
Status = NEW
```

### Outcome

- Ticket ID generated
- SLA timer starts
- Audit log created

---

# Flow 2 – AI Categorization (Optional)

## Description

The system can automatically determine:

- Category
- Priority
- Required Skill
- team

using AI or predefined business rules.

### Example

Customer writes:

> "My VPN is not working."

System identifies:

- Category → Network
- Skill → VPN Support
- team → Network team

---

# Flow 3 – team Assignment

## Description

Every ticket belongs to a team.

Examples

- Billing
- Technical Support
- HR
- Sales
- Hardware
- Software

team selection ensures the ticket reaches the correct support team.

---

# Flow 4 – Skill-Based Agent Assignment

## Description

The Assignment Engine finds the best available Agent.

The system checks:

- Required Skill
- team Membership
- Agent Availability
- Current Workload
- Working Hours
- Leave Status
- SLA Priority

### Flow

```
Ticket
   │
   ▼
Find Eligible Agents
   │
   ▼
Compare Workload
   │
   ▼
Assign Best Agent
```

### Result

Agent becomes the Ticket Owner.

---

# Flow 5 – Agent Acceptance

## Description

After assignment, the Agent must accept the ticket.

### Status

```
Assigned
      │
      ▼
Accepted
```

If the Agent does not accept within the configured timeout:

- Auto Reassign
- Notify Supervisor

---

# Flow 6 – Agent Investigation

## Description

The Agent performs first-level troubleshooting.

Responsibilities

- Contact Customer
- Verify Issue
- Collect Logs
- Validate Information
- Attempt Resolution

The Agent decides whether:

- The issue is resolved
- Resolver assistance is required

---

# Flow 7 – Agent Resolution

## Description

If the Agent successfully resolves the issue:

```
Investigation
      │
      ▼
Resolved
      │
      ▼
Customer Notification
```

No Resolver involvement is required.

This significantly reduces Resolver workload.

---

# Flow 8 – Resolver Assignment

## Description

Only complex issues are forwarded to a Resolver.

The Assignment Engine again checks:

- Resolver Skill
- Workload
- Availability
- team

### Flow

```
Needs Resolver
        │
        ▼
Find Resolver
        │
        ▼
Assign Resolver
```

---

# Flow 9 – Resolver Investigation

## Description

The Resolver performs technical analysis.

Examples

- Database Issue
- API Failure
- Server Crash
- Network Configuration
- Bug Fix

The Resolver updates:

- Work Logs
- Resolution Notes
- Attachments

---

# Flow 10 – Resolver Escalation

## Description

If the assigned Resolver cannot solve the issue:

```
Resolver A
      │
      ▼
Escalate
      │
      ▼
Resolver B
```

Rules

- Escalation Reason Mandatory
- Escalation History Saved
- Maximum Escalation Level Configurable

---

# Flow 11 – Ticket Resolution

## Description

After successful investigation:

```
Resolved
     │
     ▼
Notify Customer
```

The customer receives:

- Resolution Summary
- Attachments
- Comments
- Closure Notification

---

# Flow 12 – Ticket Closure

## Description

After customer confirmation (or auto-close policy):

```
Resolved
      │
      ▼
Closed
```

The ticket becomes read-only except for administrators.

---

# Flow 13 – Ticket Reopening

## Description

If the customer replies after closure:

```
Closed
     │
     ▼
Customer Reply
     │
     ▼
Reopened
```

The ticket returns to the assigned Agent.

---

# Manual Reassignment Flow

## Admin Reassignment

```
Assigned Agent
      │
      ▼
Admin Changes Agent
      │
      ▼
New Agent Assigned
```

Admin can reassign for:

- Incorrect Skill
- High Workload
- Leave
- SLA Risk

---

## Agent Reassignment

```
Assigned Agent
      │
      ▼
Transfer to Another Eligible Agent
```

Rules

- Same team
- Required Skill
- Audit Log
- Reason Required

---

# Ticket Ownership

Customer Communication Owner

```
Customer
      │
      ▼
Agent
```

Technical Resolution Owner

```
Agent
      │
      ▼
Resolver
```

The Agent remains the single point of contact for the customer throughout the ticket lifecycle.

---

# Ticket Status Lifecycle

```
NEW
 │
 ▼
ASSIGNED
 │
 ▼
ACCEPTED
 │
 ▼
IN PROGRESS
 │
 ├────────────► WAITING FOR CUSTOMER
 │
 ├────────────► WAITING FOR THIRD PARTY
 │
 ├────────────► ON HOLD
 │
 ▼
RESOLVED
 │
 ▼
CLOSED
 │
 ▼
REOPENED
```

---

# Automation Rules

| Event | Automation |
|---------|------------|
| Ticket Created | Create SLA, Audit Log |
| Ticket Categorized | Assign team |
| team Assigned | Skill-Based Agent Assignment |
| Agent Timeout | Auto Reassign |
| Agent Escalation | Assign Resolver |
| Resolver Timeout | Auto Reassign Resolver |
| SLA Breach | Notify Supervisor |
| Ticket Resolved | Notify Customer |
| Customer Inactive | Auto Close |
| Customer Reply | Reopen Ticket |

---

# Business Rules

## Customer

- Can create tickets
- Can reply
- Can view status

---

## Agent

- Owns customer communication
- Can resolve simple issues
- Can reassign eligible Agents
- Can escalate to Resolver

---

## Resolver

- Handles technical work
- Can escalate to another Resolver
- Updates technical resolution

---

## Admin

- Override assignments
- Configure skills
- Configure teams
- Manage SLA
- View all tickets
- Generate reports

---

# Final Design Summary

The recommended workflow follows a **tiered support model**:

1. **Customer, Agent, or Admin creates a ticket.**
2. **The system categorizes the ticket and assigns it to the appropriate team.**
3. **A skill-based assignment engine selects the best available Agent.**
4. **The Agent becomes the primary ticket owner and communicates with the customer.**
5. **If the Agent resolves the issue, the ticket is closed without involving a Resolver.**
6. **Only complex issues are routed to a Resolver using the same skill-based assignment logic.**
7. **Resolvers can escalate to higher-level Resolvers when necessary.**
8. **The customer is notified upon resolution, and the ticket is closed or reopened based on subsequent customer responses.**

This workflow minimizes unnecessary escalations, ensures clear ownership, supports SLA compliance, and provides a scalable foundation for enterprise-grade ticket management.