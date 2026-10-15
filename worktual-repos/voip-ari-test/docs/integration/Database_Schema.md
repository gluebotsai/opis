# Database Schema Reference

## Overview
The Telephony Platform owns its own isolated PostgreSQL database. Downstream CRM/Contact Center databases should reference `callId`, `tenantId`, and `agentId` foreign keys where applicable.

---

## Core Tables

| Table | Description | Primary Key | Key Relations |
| --- | --- | --- | --- |
| `Tenant` | Multi-tenant account organization | `id` (UUID) | Has many Users, Agents, Extensions |
| `User` | Platform admins & managers | `id` (UUID) | Belongs to Tenant |
| `Agent` | Telephony agents / call handlers | `id` (UUID) | Belongs to Tenant, Has one SipExtension |
| `SipExtension` | PJSIP SIP extension credentials | `id` (UUID) | Belongs to Tenant & optional Agent |
| `Queue` | Call queue routing setup | `id` (UUID) | Has many QueueMembers |
| `QueueMember` | Agent assignment to queue | `id` (UUID) | Belongs to Queue & Agent |
| `CallHistory` | Completed & active call records | `id` (UUID) | Belongs to Tenant |
