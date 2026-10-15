# Contact Center API E2E Scripts

Headless journey tests for webchat, email, WhatsApp, and cross-channel identity. These scripts use the shared `@ai-contact-center/test-harness` package and expect a running local stack.

## Prerequisites

1. Start infrastructure:

```bash
npm run docker:up
npm run db:push
```

2. Seed agent + channel config (if not already present):

```bash
npm run seed:worktual-test-accounts -w cc-core
```

3. Start services:

```bash
npm run dev
```

4. Copy env template:

```bash
cp .env.e2e.example .env.e2e
```

## Auth / single session

By default, cc-core allows **one active login per account**. A second sign-in returns HTTP 409 until the first session signs out.

- Sign out from the app header before signing in again in another browser or tab.
- For E2E scripts, `CcCoreClient.loginAgent()` reuses a cached session per email within the same process.
- To disable enforcement locally (e.g. parallel manual testing), set `AUTH_SINGLE_SESSION=false` on cc-core.

## Preflight

Checks Postgres, service health endpoints, and agent login:

```bash
npx tsx scripts/e2e/preflight.ts
```

Database-only check:

```bash
npx tsx scripts/e2e/preflight.ts --db-only
```

## Run journeys

All channels:

```bash
npx tsx scripts/e2e/run-all.ts
```

Single channel:

```bash
npx tsx scripts/e2e/run-all.ts --channel=webchat
npx tsx scripts/e2e/run-all.ts --channel=email
npx tsx scripts/e2e/run-all.ts --channel=whatsapp
npx tsx scripts/e2e/run-all.ts --channel=identity
npx tsx scripts/e2e/run-all.ts --channel=omni-memory
npx tsx scripts/e2e/run-all.ts --channel=missed-reasons
```

Smoke (preflight + one assertion per channel):

```bash
npx tsx scripts/e2e/run-all.ts --smoke
```

Individual scripts:

```bash
npx tsx scripts/e2e/test-webchat-journey.ts
npx tsx scripts/e2e/test-email-journey.ts
npx tsx scripts/e2e/test-whatsapp-journey.ts
npx tsx scripts/e2e/test-whatsapp-contact-enrichment.ts
npx tsx scripts/e2e/test-cross-channel-journey.ts
npx tsx scripts/e2e/test-omni-phone-memory-journey.ts
npx tsx scripts/e2e/test-missed-contact-reasons.ts
```

## DB rollback integration (no live stack)

```bash
npm run test:email-enterprise -w cc-core
npx tsx apps/cc-core/scripts/test-contact-identity-integration.ts
npx tsx apps/cc-core/scripts/test-omni-phone-memory-integration.ts
npx tsx apps/cc-core/scripts/test-webchat-memory-integration.ts
```

## Playwright UI E2E

Smoke (workspace shell):

```bash
npm run test:e2e -w web -- --project=smoke
```

Full stack specs (requires `E2E_STACK_READY=1`):

```bash
E2E_STACK_READY=1 PLAYWRIGHT_SKIP_WEBSERVER=1 npm run test:e2e -w web -- --project=full
```

## CI

PR pipeline runs unit tests + Postgres rollback integration. Nightly/manual workflow runs API E2E smoke and Playwright smoke.
