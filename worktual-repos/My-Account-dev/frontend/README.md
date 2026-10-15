# My Accounts Frontend

React + Vite UI for Worktual My Accounts.

## Setup

```bash
cp .env.example .env
pnpm install
pnpm dev
```

`pnpm dev` = bundled preview (prod-like chunks); watches files, rebuilds, auto-refreshes.  
`pnpm dev:hmr` = Vite HMR (faster edits; many unbundled script requests).

Runs at http://localhost:5173 and proxies `/api` to `VITE_API_PROXY`.
