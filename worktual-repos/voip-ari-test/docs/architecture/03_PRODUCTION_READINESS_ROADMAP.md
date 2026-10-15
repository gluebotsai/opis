# Enterprise Production Readiness Roadmap & Gap Analysis

This document outlines the **gaps, security requirements, high-availability architecture, and operational tasks** required to graduate the current Telephony Platform from single-node MVP to a **99.99% SLA Enterprise-Grade CPaaS**.

---

## 1. Production Gap Matrix

| Area | Current State (MVP) | Enterprise Target State | Priority |
| :--- | :--- | :--- | :--- |
| **Node High Availability** | Single Asterisk container on `82.113.92.45` | Active-Active Asterisk Cluster behind Kamailio SBC Load Balancer | **P0 (Critical)** |
| **SIP & WebRTC Transport** | Plain WS on port `8088` / Self-signed Vite proxy | Signed TLS / WSS Certificates (Let's Encrypt / Cert-Manager) | **P0 (Critical)** |
| **NAT & WebRTC Media** | Basic Google STUN servers | Dedicated **COTURN (STUN/TURN)** server array with auth credentials | **P0 (Critical)** |
| **Database & Persistence** | In-memory `CallSessionService` maps | Persistent PostgreSQL (Prisma) + Redis Cluster for session state | **P1 (High)** |
| **Security & Auth** | Demo tenant key (`demo-tenant-api-key-12345`) | OAuth2 / JWT Auth, Scope-based RBAC, API Key rotation | **P1 (High)** |
| **Observability & CDRs** | Console logger & local file logs | Prometheus metrics, Grafana dashboards, Homer SIP capture, Sentry | **P1 (High)** |
| **Media Storage** | Local disk `/var/spool/asterisk` | AWS S3 / MinIO Object Storage with lifecycle retention policies | **P2 (Medium)** |

---

## 2. Detailed Technical Workstreams

### 2.1 High Availability & SBC Load Balancing Architecture

To eliminate the single point of failure (SPOF) of a single Asterisk engine:

```
                                  [ INBOUND TRAFFIC ]
                                           │
                                           ▼
                       ┌───────────────────────────────────────┐
                       │   KAMAILIO / OPENSIPS SBC CLUSTER     │
                       │   (SIP Load Balancing & Failover)     │
                       └───────────────────┬───────────────────┘
                                           │
                    ┌──────────────────────┴──────────────────────┐
                    ▼                                             ▼
 ┌────────────────────────────────────┐        ┌────────────────────────────────────┐
 │ ASTERISK ENGINE 01 (ARI Node 1)    │        │ ASTERISK ENGINE 02 (ARI Node 2)    │
 └─────────────────┬──────────────────┘        └─────────────────┬──────────────────┘
                   │                                             │
                   └──────────────────────┬──────────────────────┘
                                          ▼
                       ┌───────────────────────────────────────┐
                       │ REDIS CLUSTER & POSTGRESQL HA REPLICA │
                       └───────────────────────────────────────┘
```

1. **SBC Layer**: Deploy **Kamailio** or **OpenSIPS** as the public-facing Session Border Controller (SBC).
   - Handles SIP registration, TLS termination, NAT traversal, and DDoS rate-limiting.
   - Distributes call traffic across Asterisk worker nodes using weighted round-robin.
2. **Stateless Asterisk Workers**: Asterisk nodes run identical PJSIP + ARI configurations. If Node 1 fails, Kamailio automatically reroutes new calls to Node 2 within 500ms.
3. **Redis Session Store**: Replace the local JavaScript `Map` inside `CallSessionService` with Redis Hash objects (`HSET active_calls:<callId>`) so any microservice instance can inspect and manage active calls.

---

### 2.2 Production Media & WebRTC Traversal (STUN / TURN)

Browser WebRTC connections across strict enterprise firewalls / symmetric NATs require a dedicated TURN server array:

1. **Deploy COTURN Services**:
   ```bash
   # Coturn installation on separate public IP
   apt-get install coturn
   turnserver -a -o -v -n --u agent1:secure_turn_password -r telephony.yourdomain.com
   ```
2. **Update Softphone Configuration**:
   ```ts
   iceServers: [
     { urls: 'stun:stun.yourdomain.com:3478' },
     {
       urls: 'turn:turn.yourdomain.com:3478',
       username: 'agent1',
       credential: 'secure_turn_password',
     },
   ]
   ```
3. **Firewall / Security Group Rules**:
   - Allow UDP ports `10000 - 20000` (Asterisk RTP media).
   - Allow UDP/TCP ports `3478` & `5349` (STUN/TURN).

---

### 2.3 Security, TLS & Encryption Hardening

1. **Domain & WSS Setup**:
   - Bind production domain: `telephony.yourdomain.com`.
   - Issue wildcard SSL certificate via Let's Encrypt / Certbot.
   - Serve Agent UI, API Gateway, and WebSockets strictly over `HTTPS` and `WSS`.
2. **SRTP Media Encryption**:
   - Enforce mandatory SRTP on all PJSIP endpoints:
     ```ini
     [webrtc-endpoint-template](!)
     media_encryption=dtls
     dtls_cert_file=/etc/asterisk/keys/asterisk.pem
     dtls_ca_file=/etc/asterisk/keys/ca.crt
     dtls_setup=actpass
     ```
3. **Database & API Security**:
   - Replace static tenant keys with short-lived **JWT Tokens** for agents and hashed **API Keys** for backend integrations.
   - Enable PostgreSQL TLS connection string (`sslmode=verify-full`).

---

### 2.4 Observability, SIP Tracing & Compliance Logging

To achieve enterprise diagnostic visibility:

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                OBSERVABILITY & TELEMETRY PIPELINE                                │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘

 [ Asterisk PJSIP Engine ] ──> HEP / Homer Protocols ──> [ HOMER SIP CAPTURE (SIP PCAP Tracing) ]
 [ NestJS Adapter Services] ──> Prometheus Metrics ────> [ GRAFANA DASHBOARDS (CPS, ACD, Latency) ]
 [ API & Webhook Service ]  ──> JSON Structured Logs  ──> [ ELK STACK / DATADOG (Log Analytics) ]
```

1. **SIP PCAP Capture (Homer / HEP)**:
   - Configure Asterisk `res_hep.so` to mirror all raw SIP signaling packets to Homer for instant visual call ladder diagnostics.
2. **Prometheus Metrics**:
   - Expose metrics endpoint (`/metrics`):
     - Active concurrent channels (`telephony_active_channels_count`)
     - Call Setup Time (Post-Dial Delay / PDD)
     - Calls Per Second (CPS)
     - Call Completion Rate (ASR / Answer-Seizure Ratio)
     - Packet Loss / Jitter / MOS Audio Quality Scores
3. **Compliance Recording Storage**:
   - Automatically upload completed WAV call recordings from `/var/spool/asterisk/recording` to AWS S3 / MinIO.
   - Enable AES-256 S3 server-side encryption and automated lifecycle rules (e.g. move to Glacier after 90 days).

---

## 3. Checklist for Enterprise Sign-off

- [ ] Deploy COTURN TURN server on dedicated IP
- [ ] Implement Kamailio SBC load balancer for Asterisk redundancy
- [ ] Migrate `CallSessionService` in-memory state to Redis HSET
- [ ] Install production TLS certificates for WSS / HTTPS
- [ ] Enforce JWT authentication on API Gateway & WebSockets
- [ ] Configure Homer HEP SIP packet capturing
- [ ] Set up Prometheus & Grafana dashboards
- [ ] Implement AWS S3 automated recording upload pipeline
