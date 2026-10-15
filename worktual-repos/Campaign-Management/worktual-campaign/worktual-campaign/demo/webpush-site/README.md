# Web push demo site

Local stand-in for a customer website. Subscribes visitors to browser push via the Campaign API.

## Share with testers (any PC — no setup on their side)

**Do not share** `https://192.168.x.x:5500` — that fails on other computers.

On **your dev machine**:

```bash
npm run dev:backend          # terminal 1
npm run dev:webpush:share    # terminal 2 — demo + ngrok tunnel
```

Terminal 2 prints a public link, e.g. `https://abc123.ngrok-free.dev/`.

- On **localhost**, the page also shows a green **Copy link** banner.
- **Send only the ngrok link** to testers. They open it → **Allow notifications**. Nothing to install.

Requirements: ngrok configured (`ngrok config check`), VAPID keys in **Configuration → Web push**, dev machine stays on.

## Local-only (same PC)

| URL | Use |
|-----|-----|
| `http://localhost:5500/` | Quick test on dev machine |
| `https://192.168.11.31:5500/` | LAN only — blocked for push on other PCs |

See **[TESTER-LINUX.md](./TESTER-LINUX.md)** only if you insist on LAN without ngrok.
