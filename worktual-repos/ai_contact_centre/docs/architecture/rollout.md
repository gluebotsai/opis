# Omnichannel Rollout Guide

## Pre-Deployment Checklist

1. Run `npm run db:migrate:status` — all migrations must show `APPLIED`
2. Run `npx tsx apps/cc-core/scripts/backfill-channel-policies.ts --dry-run` — review policy mapping
3. Apply backfill: `npx tsx apps/cc-core/scripts/backfill-channel-policies.ts --apply`
4. Verify `META_WHATSAPP_AUTO_REPLY` is **not** set to `true` in production
5. Confirm NLP health: `curl http://localhost:8000/health`

## Deployment Order

1. **Database**: `npm run db:push && npm run db:migrate`
2. **cc-core**: policy resolver + lifecycle transitions
3. **nlp**: intent registry + memory context
4. **chat-service**: webchat durable delivery + policy threshold
5. **social-service**: production ingest path (no auto-reply)
6. **web**: workspace (no changes required for bot flows)

## Canary Validation

Run smoke tests after each service deploy:

```bash
npm run test:e2e:preflight
npx tsx scripts/e2e/run-all.ts --smoke
```

Channel-specific:

```bash
npx tsx scripts/e2e/test-webchat-journey.ts
npx tsx scripts/e2e/test-email-journey.ts
npx tsx scripts/e2e/test-whatsapp-journey.ts
npx tsx scripts/e2e/test-cross-channel-journey.ts
```

## Rollback

- Policy changes: revert `channel_automation_policies` row via admin API
- Service rollback: redeploy previous container/image
- Migration rollback: create compensating migration (never delete applied migrations)

## Monitoring

Watch for:
- `botEligible: false` on WhatsApp ingest logs
- NLP provider failures (`nlp_provider_failure` handoff reason)
- Migration checksum mismatches in CI
- Queue depth growth when `no_agent_behavior = queue_and_notify`
