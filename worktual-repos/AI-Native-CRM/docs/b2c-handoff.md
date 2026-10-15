# B2C handoff — setup & working instructions

Read this before writing any code. It sets up your local environment and the
process we'll use to merge your work back into the main B2B codebase later.

## 1. Get the repo

Copy the whole project folder, **including the hidden `.git` folder** — not
just the visible files. This preserves history even though we're not using a
shared git remote.

## 2. Set up your own local database (do not use the shared one)

- Install Postgres locally (18.x recommended to match the source server).
- You were given `db-dumps/worktual_bigint_b2c_handoff.sql` alongside this
  repo (sent separately, not via git — it's gitignored). It contains the
  `crm`, `cdp`, and `accounts` schemas as of 2026-08-15.
- Create a local database and restore it:

  ```bash
  createdb worktual_bigint
  psql -d worktual_bigint -f db-dumps/worktual_bigint_b2c_handoff.sql
  ```

- In your copy's `.env`, change `DATABASE_URL` and `ACCOUNT_DATABASE_URL` to
  point at `localhost` instead of the shared server. Keep `?schema=crm` on
  `DATABASE_URL`.

## 3. Get schema + demo data in place

```bash
npm install
npm run db:generate
npm run db:seed
```

The seed script creates three separate demo tenants: `1000` (B2B), **`1001`
(B2C)**, `1002` (B2B2C) — each with its own login users. Develop and test
against the B2C one specifically:

- Login: `admin.b2c@worktual.com` / password `demo`
- This tenant already has `business_type = "b2c"` set on
  `accounts.organizations`, so module gating (`modules.ts`,
  `contact-company-motion.ts`) behaves correctly out of the box — no manual
  tenant setup needed.

## 4. Read before writing code

Have Cursor read these first (already in the repo):

- `AGENTS.md` (root) — stack conventions, mandatory LLM-agent rules
- `docs/multi-tenancy-common-model.md` — B2B/B2C/B2B2C rules, do not violate
- `docs/parallel-work-log.md` — the changelog you must update as you work
- `docs/merge-validation-checklist.md` — how this gets merged back later

## 5. Working rules while building

- **Log every migration and every edit to a high-touch file** in
  `docs/parallel-work-log.md`, the same day — file, table/model, what
  changed, why. This is the only record used at merge time.
- **High-touch files** (already flagged with comments in the code — treat
  extra carefully, log clearly):
  - `prisma/schema.prisma`
  - `backend/src/config/modules.ts`
  - `frontend/src/config/modules.ts`
  - `backend/src/lib/contact-company-motion.ts`
  - `ai-service/app/agents/crm_agent.py`
  - `ai-service/app/agents/crm_tools.py`
  - `ai-service/app/agents/coworker_shared.py`
  - `ai-service/app/agents/llm_result.py`
- **Never write a migration that alters `cdp.*` or `accounts.*`** — CRM only
  reads those schemas. Applies locally too, not just on the shared server.
- **Any new AI/agent behavior must go through the LLM**, reusing
  `crm_tools.py` / `coworker_shared.py` / `llm_result.py`. No hand-coded
  heuristic "agent" logic on the success path.
- **Commit locally as you go**: `git add -A && git commit -m "..."`. No push,
  no remote needed — just your own rollback/history.

## 6. What to send back at the end

- The whole folder, including `.git` history.
- Your completed `docs/parallel-work-log.md`.
- Your additions under `prisma/migrations/`, if you changed the schema.
