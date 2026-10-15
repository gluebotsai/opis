# SIP over WSS (WebSocket Secure)

`ur-signaling` binds WSS the same way as legacy SGW: Sofia `NUTAG_WSS_URL` + `NUTAG_CERTIFICATE_DIR` (OpenSSL), not libwebsockets.

## Requirements

1. **Sofia with WSS** — Ubuntu `libsofia-sip-ua` usually **lacks** `NUTAG_WSS_URL`.
   Build from the SGW-patched sources (vendored as `third_party/sofia-sip-1.13.17.tar.gz`):

```bash
# Typical install path used by signalinggateway/CMakeLists.txt
export UR_SOFIA_PREFIX="${HOME}/.local/sofia-sip-1.13.17"
# Uses vendored tarball / SOFIA_SRC (see docs/deploy-self-hosted.md):
./scripts/install-wss-sofia.sh
# Or point at a prefix that has include/.../sofia-sip/nua_tag.h with NUTAG_WSS_URL
```

CMake auto-picks `$HOME/.local/sofia-sip-1.13.17` when present. Rebuild after setting the prefix:

```bash
rm -rf build
./scripts/build.sh
# cmake should log: Using WSS Sofia from UR_SOFIA_PREFIX=...
```

2. **TLS material (manual at runtime)** — the **build does not embed certificates**. Operators place PEM files under `sip.certificate_dir` (or `UR_SIP_CERTIFICATE_DIR`; deploy default `/etc/ur-signaling/certs`):

| File | Required | Role |
|------|----------|------|
| `agent.pem` | **yes** | Cert + private key (concatenated) for TLS / `NUTAG_CERTIFICATE_DIR` |
| `wss.pem` | **yes** | Cert + key for WSS listen (Sofia `tport_ws_init_primary_secure`; usually a copy of `agent.pem`) |
| `cafile.pem` | recommended | CA / self-signed cert for peer verification |

```bash
# Local smoke only — writes agent.pem, wss.pem, cafile.pem under certs/sofia/
./scripts/gen-sofia-certs.sh
# Production: copy real PEMs into certificate_dir (never commit *.pem)
```

## Config

```json
"sip": {
  "udp_listen": "10.x.x.x:5060",
  "tcp_listen": "10.x.x.x:5060",
  "tls_listen": "10.x.x.x:5061",
  "wss_listen": "10.x.x.x:57344",
  "certificate_dir": "certs/sofia",
  "contact_wss_host": "public.example.com"
}
```

| Field | Role |
|-------|------|
| `wss_listen` | `host:port` → `sips:host:port;transport=wss` |
| `tls_listen` | Bound as `NUTAG_SIPS_URL` with `;transport=tls` when WSS is enabled |
| `certificate_dir` | `NUTAG_CERTIFICATE_DIR` (must contain `agent.pem` + `wss.pem`; recommend `cafile.pem`) |
| `contact_wss_host` | Optional public host stored as binding `Ipaddress` for WSS REGISTERs |

Empty `wss_listen` → UDP-only (previous behaviour).

Force UDP-only at runtime (skip WSS even if configured):

```bash
export UR_SIP_UDP_ONLY=1
```

## REGISTER

Via `SIP/2.0/WSS` sets `transport_type=wss` (same as legacy). Binding JSON stores `transport_type: "wss"`. Contact responses include `;transport=wss`.

## Staging notes

- Open firewall for **57344/tcp** (WSS) and **5061/tcp** (TLS) in addition to **5060/udp**.
- Use `UR_SIP_HOST` (auto in deploy) — do not leave laptop `192.168.13.190` as the bind IP.
- Install WSS Sofia once: `./scripts/install-wss-sofia.sh` (uses vendored `third_party/sofia-sip-1.13.17.tar.gz`; or Manual Deploy with `install_wss_sofia=true`, `udp_only=false`).
- Verify: `ss -ltnp | grep 57344` and log line `wss=sips:...:57344;transport=wss`.
- Clients: `wss://<host>:57344` with the same digest credentials as UDP REGISTER.
