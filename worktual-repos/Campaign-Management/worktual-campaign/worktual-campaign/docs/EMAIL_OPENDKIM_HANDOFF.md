# OpenDKIM handoff (Mode B) — ops runbook

Campaign generates DKIM and stores the **encrypted** private key in Postgres.  
**Postfix / OpenDKIM does not read Campaign DB.** This runbook bridges the two.

## Prerequisites

- Domain **authenticated** in Configuration → Email (DNS Verify passed)
- Campaign backend running with same `DKIM_ENCRYPTION_KEY` / `JWT_SECRET` used at keygen
- `INTERNAL_SERVICE_KEY` set (same key used for social-service)
- Access to the mail host (OpenDKIM + Postfix)

## 1. Export private key (ops only)

```bash
# Auth as a Campaign session user for the tenant, plus internal key.
# PRIVATE KEY MUST NOT be pasted into Slack/tickets in plain text long-term.

curl -sS -X POST \
  "https://<campaign-api>/api/configuration/email/domains/<email-domain-uuid>/dkim-export" \
  -H "Authorization: Bearer <session-jwt>" \
  -H "x-internal-service-key: $INTERNAL_SERVICE_KEY" \
  -H "Content-Type: application/json"
```

Response includes:

| Field | Use |
|-------|-----|
| `selector` | Usually `s1` |
| `dns_name` | `s1._domainkey.customer.com` |
| `public_key_p` | Must match live DNS `p=` |
| `private_key_pem` | Install on OpenDKIM only |
| `instructions` | KeyTable / SigningTable hints |

## 2. Install on OpenDKIM (mail host)

Paths vary by distro; adjust to your layout.

```bash
# Example layout
sudo mkdir -p /etc/opendkim/keys/customer.com
sudo tee /etc/opendkim/keys/customer.com/s1.private >/dev/null <<'EOF'
-----BEGIN PRIVATE KEY-----
…paste private_key_pem…
-----END PRIVATE KEY-----
EOF
sudo chown -R opendkim:opendkim /etc/opendkim/keys/customer.com
sudo chmod 600 /etc/opendkim/keys/customer.com/s1.private
```

**KeyTable** (example):

```text
s1._domainkey.customer.com customer.com:s1:/etc/opendkim/keys/customer.com/s1.private
```

**SigningTable** (example):

```text
*@customer.com s1._domainkey.customer.com
```

Ensure Postfix milter still points at OpenDKIM, then:

```bash
sudo systemctl restart opendkim
# sudo systemctl reload postfix   # if required in your setup
```

## 3. Issue a new Postfix `domainId`

- Do **not** reuse `11165` with a customer From
- Create / register the domain on the send stack the same way other branded domains are onboarded
- Note the numeric `domainId`

## 4. Save domainId in Campaign

Configuration → Email → domain card → **Save domainId**  
(or `PUT /api/configuration/email/domains/:id/provider` with `{ "provider_domain_id": "20607" }`)

## 5. Activate branded From + test send

1. Add / verify From on that domain (e.g. `hello@customer.com`) → **Set active**
2. Launch a small email campaign
3. Confirm headers: `DKIM-Signature` with selector `campaign`
4. Worker log should show `Worktual send identity resolved` with `mode: "B"`

## Fallback

There is no shared Worktual.tech From fallback. If branded From is incomplete, launch stays blocked until a Google / Microsoft / SMTP mailbox is send-ready.

## Security

- Never return private keys from normal Config UI
- Rotate `DKIM_ENCRYPTION_KEY` only with a re-key plan (old ciphertext becomes unreadable)
- Limit who has `INTERNAL_SERVICE_KEY`
