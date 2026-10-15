# Global Ticketing Model (B2B + B2C)

## 1) Global hierarchy (recommended)

```text
Your SaaS (Worktual)
  -> Tenant/Organization (buyer company, e.g. Tech Solutions)
      -> Accounts/Clients (Tech Solutions' client companies)
          -> Requesters (end users who raise issues)
```

- **Organization** = who pays you (Tech Solutions)
- **Account/Client** = Tech Solutions' customers (Client A, Client B, Client C)
- **Requester** = actual person raising ticket (employee/user of Client A)

This is how one buyer manages multiple clients in B2B.

---

## 2) How ticket is raised in B2B (example)

Worktual sells to Tech Solutions.  
Tech Solutions supports many clients.

### Ticket creation paths

Requester can raise ticket via:

- Email (`support@techsolutions.com`)
- Web form (no login)
- Customer portal login (optional)
- API from client systems (optional enterprise)

### Ticket must store these identities

- `organization_id` = Tech Solutions (buyer)
- `account_id` = which client (Client A)
- `requester_id` or requester email/phone = who raised
- ticket details (subject, description, priority, attachments)

Then workflow:

1. Agent triages
2. Assigns resolver by skill
3. Resolver updates/escalates
4. Requester gets updates by email or portal

---

## 3) B2C in same system

For B2C, same model works with simpler shape:

- one Organization (your brand)
- account/client layer optional or default "Direct Consumers"
- many requesters (consumers)

So you do not need two products. Just one with configurable depth.

---

## 4) What to build so it works globally

Build these core primitives:

- **Multi-tenant isolation**: strict `organization_id` on all data
- **Client/account segmentation** inside organization (`account_id`)
- **Requester abstraction**: contact-only or login user
- **Channels**: email, portal, API
- **Role model**: admin, agent, resolver, customer/requester
- **Visibility rules**:
  - Admin/Agent/Resolver see org scope (optionally limited by client/account)
  - Customer sees only own tickets
- **Routing engine**:
  - by skill, priority, SLA, client/account
- **Global readiness**:
  - timezone per org
  - locale/language
  - SLA calendars (business hours by region)
  - audit logs + data retention/compliance

---

## 5) Simple naming rule

Use these labels consistently in product and database:

- **Buyer** = Organization
- **Buyer's customer** = Account/Client
- **Person raising issue** = Requester

Avoid calling all of them "customer"; that causes confusion in B2B workflows.
