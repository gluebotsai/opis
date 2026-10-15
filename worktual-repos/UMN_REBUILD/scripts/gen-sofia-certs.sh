#!/usr/bin/env bash
# Generate Sofia-SIP certificate directory for local/smoke use.
# Writes: agent.pem (TLS cert+key), wss.pem (copy for WSS listen), cafile.pem (CA).
# Production: place the same filenames under certificate_dir / UR_SIP_CERTIFICATE_DIR
# (e.g. /etc/ur-signaling/certs). Build does not embed certs — never commit *.pem.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-${ROOT}/certs/sofia}"
DAYS="${CERT_DAYS:-825}"
CN="${CERT_CN:-ur-signaling.local}"

mkdir -p "${OUT_DIR}"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "${TMP}/key.pem" \
  -out "${TMP}/cert.pem" \
  -days "${DAYS}" \
  -subj "/CN=${CN}"

cat "${TMP}/cert.pem" "${TMP}/key.pem" > "${OUT_DIR}/agent.pem"
# WSS primary (tport_ws_init_primary_secure) looks for wss.pem, not agent.pem.
cp "${OUT_DIR}/agent.pem" "${OUT_DIR}/wss.pem"
cp "${TMP}/cert.pem" "${OUT_DIR}/cafile.pem"

echo "Wrote Sofia certs under ${OUT_DIR}"
echo "  agent.pem  (cert+key for TLS / NUTAG_CERTIFICATE_DIR)"
echo "  wss.pem    (cert+key for WSS listen)"
echo "  cafile.pem (CA / self-signed cert)"
