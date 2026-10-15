# Merge validation checklist (B2B ↔ B2C split)

Use this when combining the B2B copy (this repo) and the B2C copy (teammate's
local clone + local DB) back into one codebase + one shared DB
(`worktual_bigint`). Follow it in order — don't apply anything to the shared
DB until the "throwaway DB" steps pass.

Companion docs: [`docs/parallel-work-log.md`](parallel-work-log.md) (the
migrations/shared-file log you should have been keeping since day one) and
[`docs/b2c-handoff.md`](b2c-handoff.md) (the setup instructions given to the
B2C track before work started).

## 0. Before you start

- [ ] Both sides have real git history (not a flattened folder copy).
- [ ] Pull `docs/parallel-work-log.md` from both copies and reconcile into one
      file first — it tells you exactly which migrations and which high-touch
      files to expect conflicts in, before you open a single diff.
- [ ] Take a fresh `pg_dump` of the live shared DB (`worktual_bigint`) right
      now, before anything below touches it. This is your rollback point.

## 1. Code merge (git)

- [ ] Merge/rebase branches normally. Expect real conflicts in:
  - `prisma/schema.prisma`
  - `backend/src/config/modules.ts`, `frontend/src/config/modules.ts`
  - `backend/src/lib/contact-company-motion.ts`
  - `ai-service/app/agents/crm_agent.py`, `crm_tools.py`, `coworker_shared.py`, `llm_result.py`
- [ ] For each conflict in the files above, resolve by hand — read both
      sides' intent (check the parallel-work-log entry for context), don't
      accept a side blindly and don't let an auto-merge tool silently pick one.
- [ ] Re-run `assertModuleAccessInvariants()` implicitly by starting the
      backend — it throws at import time if the merged `modules.ts` violates
      an invariant (B2C+finance, inbox-without-configuration).

## 2. Schema + migrations merge (do NOT touch the shared DB yet)

- [ ] After the code merge, `prisma/migrations/` will likely contain both
      sides' new migration folders side by side (usually no git conflict here
      — different timestamped filenames — but that does **not** mean they're
      compatible).
- [ ] Spin up a **throwaway Postgres** (fresh empty DB, or restore the
      pre-merge dump from step 0 into a scratch instance).
- [ ] Run `npm run db:deploy` (`prisma migrate deploy`) against the throwaway
      DB with the fully merged `prisma/migrations/` folder.
  - If it fails: two migrations touched the same table/column/enum
    incompatibly. Fix by hand (edit/reorder/squash the newer migration) —
    do not force it onto the real DB to "see what happens."
  - If it succeeds: run `npm run db:generate` and confirm the generated
    Prisma client matches `schema.prisma` with no drift warnings.
- [ ] Only after a clean deploy on the throwaway DB: run `npm run db:deploy`
      once against the real shared `worktual_bigint` DB.

## 3. Data (do not merge — reseed deliberately)

- [ ] Teammate's local test data (contacts/companies/orders) stays local and
      is discarded — it does not get copied into the shared DB.
- [ ] If there's specific B2C seed/demo data you want in the shared DB
      (sample products, a demo org), add it via a small, reviewed seed script
      — not a data dump.

## 4. Automated test baseline

- [ ] `ai-service`: `cd ai-service && source .venv/bin/activate && PYTHONPATH=. python3 -m pytest -q`
      — compare against the pre-split baseline of **450 passed** recorded in
      `docs/parallel-work-log.md`. Fewer passing (without an explained,
      intentional reason) means the merge broke something.
- [ ] `backend`: no wired-up `vitest` config exists yet in this repo (path
      aliases like `@/dao/...` aren't resolved when running `vitest` directly
      — pre-existing gap, not introduced by this split). If this gets fixed
      before merge day, run it and treat any regression the same way.

## 5. Manual smoke test (do this — tests don't cover everything)

- [ ] Log in as a B2B org/user: contact requires company, Sales/Finance nav
      present, Commerce absent.
- [ ] Log in as a B2C org/user: contact has no company field, Commerce nav
      present, Sales/Finance nav absent, Finance routes blocked.
- [ ] Run a coworker/chat session in each mode (`crm_agent.py` path) and
      confirm both still behave correctly — this is the one area a clean git
      merge is least likely to catch a real regression (see
      `docs/parallel-work-log.md` high-touch file list).

## 6. Rollback plan

If step 2 or step 5 uncovers a broken shared DB state after `db:deploy` has
already run against the real DB: restore the step-0 `pg_dump`, fix the
migration/code issue against the throwaway DB, and repeat from step 2.
