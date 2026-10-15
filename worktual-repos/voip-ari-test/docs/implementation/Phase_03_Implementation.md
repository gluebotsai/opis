# Phase 3 Implementation Summary: Asterisk Adapter Microservice

## Overview
Phase 3 created the NestJS microservice inside `adapters/asterisk-adapter` that bridges Asterisk ARI/AMI with the platform's Redis Pub/Sub message bus.

---

## 1. Directory Structure Implemented
```text
adapters/asterisk-adapter/
├── package.json
├── tsconfig.json
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── controllers/
│   │   └── health.controller.ts
│   └── services/
│       ├── ari.service.ts
│       ├── ami.service.ts
│       ├── redis.service.ts
│       └── command.listener.ts
```

---

## 2. Core Modules Implemented

### A. ARI Service (`ari.service.ts`)
- Connects to Asterisk ARI WebSocket interface at `http://localhost:8088`.
- Registers Stasis application `telephony`.
- Normalizes and publishes ARI events to Redis topic `telephony.events.asterisk`:
  - `stasis.start`: Triggered when channel enters Stasis app.
  - `stasis.end`: Triggered when channel leaves Stasis app.
  - `channel.state_change`: Triggered when channel state changes (Ringing, Up, Down).
  - `channel.dtmf`: Triggered when DTMF digit keypress occurs.

### B. AMI Service (`ami.service.ts`)
- Connects to Asterisk AMI TCP socket at `localhost:5038`.
- Listens to low-level peer events (`peer.status_change`) and publishes status changes to Redis.

### C. Redis Publisher (`redis.service.ts`)
- Uses `ioredis` to publish JSON events to channel `telephony.events.asterisk`.

### D. Command Listener (`command.listener.ts`) [Enhancement]
- Subscribes to Redis channel `telephony.commands.asterisk`.
- Listens for outbound call control commands issued by core microservices and executes them on Asterisk via ARI:
  - `ORIGINATE`: Spawns new PJSIP channels (`ari.channels.originate`).
  - `HANGUP`: Terminates active channel (`ari.channels.hangup`).
  - `HOLD` / `RESUME`: Starts and stops Music On Hold (`ari.channels.startMoh` / `stopMoh`).
  - `MUTE` / `UNMUTE`: Controls channel audio streams (`ari.channels.mute` / `unmute`).

### E. Health Controller (`health.controller.ts`) [Enhancement]
- Exposes `GET /health` to report ARI adapter connectivity status (`UP` / `DEGRADED`).
