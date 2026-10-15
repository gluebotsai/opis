# Phase 10: Production Deployment & Airtel SIP Trunk

## 1. Overview
Prepare the Telephony Platform for production deployment: integrate Airtel SIP Trunk for PSTN calling, enforce TLS/SRTP security, set up Prometheus/Grafana monitoring, and configure production orchestration.

---

## 2. Airtel SIP Trunk Configuration (`docker/asterisk/config/pjsip.conf`)

```ini
; Airtel SIP Trunk Registration & Endpoint
[airtel-trunk-reg]
type=registration
outbound_auth=airtel-trunk-auth
server_uri=sip:10.200.1.1:5060 ; Airtel SBC IP Address
client_uri=sip:+911234567890@10.200.1.1:5060
retry_interval=60

[airtel-trunk-auth]
type=auth
auth_type=userpass
username=+911234567890
password=AIRTEL_TRUNK_PASSWORD

[airtel-trunk]
type=endpoint
context=from-pstn
disallow=all
allow=ulaw,alaw
outbound_auth=airtel-trunk-auth
aors=airtel-trunk-aor

[airtel-trunk-aor]
type=aor
contact=sip:10.200.1.1:5060
```

---

## 3. High Availability, Security & Monitoring

### 3.1 TLS & SRTP Encryption
- Enable TLS transport on port 5061 for encrypted SIP signaling.
- Enable SRTP (`media_encryption=sdes`) for encrypted audio voice channels.

### 3.2 Prometheus Monitoring Metrics (`apps/api/src/metrics.controller.ts`)
Exposes operational telemetry at `/metrics`:
- `telephony_active_calls_total`: Gauge tracking concurrent call sessions.
- `telephony_call_duration_seconds`: Histogram tracking call duration distribution.
- `telephony_webhook_failures_total`: Counter tracking failed HTTP webhook dispatches.

---

## 4. Production Checklist
- [ ] Airtel SIP Trunk registered and tested with real PSTN phone numbers.
- [ ] SSL/TLS certificates configured for API Gateway and WebSockets.
- [ ] Database backups configured (daily PostgreSQL pg_dump to encrypted bucket).
- [ ] Grafana monitoring dashboard imported and alerting rules enabled.
