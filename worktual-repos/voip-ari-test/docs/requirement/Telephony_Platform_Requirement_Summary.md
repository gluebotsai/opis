# Telephony Platform V1 - Requirement Summary

## Vision
Build an independent, reusable, multi-tenant Telephony Platform that exposes REST APIs, WebSockets, Webhooks, and SDKs for CRM, Contact Center, AI Voice, and future products. Asterisk should be hidden behind the platform so consuming applications never communicate directly with the PBX.

## Architecture

```text
                         ┌─────────────────────────────────────────┐
                         │         TELEPHONY PLATFORM              │
 Airtel SIP Trunk ─────► │  Asterisk (PBX Core)                    │
                         │       │ ARI / AMI                       │
                         │       ▼                                │
                         │  Telephony Platform                    │
                         │  • REST APIs                           │
                         │  • WebSockets                          │
                         │  • Webhooks                            │
                         │  • SDKs                                │
                         │  • Multi-Tenant                        │
                         │  • Call Control                        │
                         │  • Agent & Queue Mgmt                  │
                         │  • Own Database                        │
                         └───────────────┬─────────────────────────┘
                                         │
               ┌─────────────────────────┼─────────────────────────┐
               ▼                         ▼                         ▼
             CRM                 Contact Center             Future Products
```

## Core Requirements

### PBX
- Asterisk
- PJSIP
- ARI
- AMI

### Core Platform
- Multi-tenant
- Call Control
- Agent Management
- Queue Management
- Number Management
- Recording Management
- Configuration Management

### Call Features
- Originate
- Answer
- Hangup
- Hold / Resume
- Mute / Unmute
- Blind Transfer
- Attended Transfer
- Conference
- DTMF
- Recording

### APIs
REST:
- POST /calls
- Hangup
- Hold
- Transfer
- Mute

WebSocket:
- call.started
- call.ringing
- call.answered
- call.ended
- agent.online
- queue.updated

Webhooks:
- call.started
- call.answered
- call.ended
- recording.ready

### Database (Separate from CRM)
Own:
- Tenants
- Agents
- SIP Extensions
- Numbers
- Queues
- Calls
- Call History
- Recordings
- Settings

### Integrations
Consumers:
- CRM
- Contact Center
- Campaign Management
- AI Voice
- Analytics
- Billing
- Future Products

### Development Plan
1. Develop using Docker + Asterisk + Linphone (no SIP provider).
2. Validate calls, queues, transfers, recordings.
3. Integrate Airtel SIP Trunk for PSTN.
4. Deploy production-ready platform with monitoring, HA, backups and security.

## Principles
- Telephony is an independent platform.
- Products integrate only through APIs/WebSockets/Webhooks/SDKs.
- CRM never stores telephony configuration.
- Telephony owns its own database.
- PBX implementation is hidden behind the platform.
- Future PBX replacement should not affect products.

## Goal
Build an enterprise-grade reusable telephony platform similar to commercial CPaaS architectures that can power all communication products.
