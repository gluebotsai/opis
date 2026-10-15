# Web push demo — Linux tester setup (LAN / mkcert)

**Prefer the ngrok share link** — see [README.md](./README.md) (`npm run dev:webpush:tunnel`). Testers need **no cert import** with that flow.

Use this doc only if you share **`https://192.168.11.31:5500/`** on the local network without a tunnel.

Demo URL (LAN): **https://192.168.11.31:5500/**

Web push requires a **trusted HTTPS** connection. The dev server uses a local **mkcert** certificate. Each tester must trust the dev machine’s root CA once.

---

## Before you start (dev machine)

On the machine running Campaign, keep these running:

```bash
npm run dev:backend
npm run dev:webpush
```

Optional — (re)generate trusted certs on the dev machine:

```bash
npm run webpush:trust
```

Ensure **Configuration → Web push** has VAPID keys saved in the Campaign app.

---

## Step 1 — Copy the root CA from the dev machine

**Only share `rootCA.pem`. Never share `rootCA-key.pem`.**

On the dev machine, the file is:

```text
~/.local/share/mkcert/rootCA.pem
```

Copy it to the tester’s PC (USB, Slack, scp, etc.).

Example from the **tester’s** Linux PC:

```bash
scp USER@192.168.11.31:~/.local/share/mkcert/rootCA.pem ~/Downloads/rootCA.pem
```

Replace `USER` with the dev machine’s Linux username.

---

## Step 2 — Trust the CA in Chrome / Chromium

### Option A — Chrome settings (easiest)

1. Open `chrome://settings/certificates`
2. Tab **Authorities** → **Import**
3. Select `~/Downloads/rootCA.pem`
4. Check **Trust this certificate for identifying websites**
5. **Fully quit Chrome** (all windows) and reopen it

### Option B — Terminal (`certutil`)

```bash
sudo apt install libnss3-tools   # if certutil is missing

certutil -d sql:$HOME/.pki/nssdb -A -t "C,," \
  -n "Worktual mkcert CA" \
  -i ~/Downloads/rootCA.pem
```

Then fully quit and reopen Chrome.

Verify:

```bash
certutil -d sql:$HOME/.pki/nssdb -L | grep -i mkcert
```

---

## Step 3 — Open the demo and subscribe

1. Open **https://192.168.11.31:5500/**
2. Confirm the address bar is **secure** (no “Not secure” / cert warning)
3. Enter email or phone → **Allow notifications**

---

## Troubleshooting

| Problem | Fix |
|--------|-----|
| “HTTPS certificate is not trusted” / service worker SSL error | Import `rootCA.pem` again; restart Chrome completely |
| Page does not load | Dev machine must run `npm run dev:webpush`; check same Wi‑Fi/LAN |
| API / config error | Dev machine must run `npm run dev:backend` |
| `http://localhost:5500` on tester PC | Wrong — that is *their* PC, not the server. Use `https://192.168.11.31:5500/` |
| Clicking “Proceed anyway” on cert warning | Page may load but **push will still fail** — trust the CA properly |

---

## Firefox (optional)

Firefox uses a separate certificate store:

1. **Settings → Privacy & Security → Certificates → View Certificates**
2. Tab **Authorities** → **Import** → `rootCA.pem`
3. Check **Trust this CA to identify websites**

---

## Security note

The mkcert root CA is for **local development only**. Only install it on machines you trust on your LAN. Remove it after testing if you prefer (`chrome://settings/certificates → Authorities → delete “mkcert” / “Worktual mkcert CA”).
