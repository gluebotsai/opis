import { pool, query } from "../../db/pool.js";
import { callDbFunctionScalar, callDbVoidFunction, resolveQueryRunner } from "../../db/routines.js";

function runnerOrPool(runner: any) {
  return runner ? resolveQueryRunner(runner) : pool;
}

export async function webhookEventExists(provider: any, eventId: any, runner: any = null) {
  const exists = await callDbFunctionScalar(
    runnerOrPool(runner),
    "fn_webhook_event_exists",
    [provider, eventId],
  );
  return Boolean(exists);
}

export async function tryClaimWebhookEventRow({ provider, eventId, eventType }: any, runner: any = null) {
  const claimed = await callDbFunctionScalar(
    runnerOrPool(runner),
    "fn_try_claim_webhook_event",
    [provider, eventId, eventType],
  );
  return Boolean(claimed);
}

export async function updateWebhookEventPayloadRow(
  { provider, eventId, quotationId, payload }: any,
  runner: any = null,
) {
  await callDbVoidFunction(runnerOrPool(runner), "fn_update_webhook_event_payload", [
    provider,
    eventId,
    quotationId,
    payload ? JSON.stringify(payload) : null,
  ]);
}

export async function recordWebhookEventRow(
  { provider, eventId, eventType, quotationId, payload }: any,
  runner: any = null,
) {
  await callDbVoidFunction(runnerOrPool(runner), "fn_record_webhook_event", [
    provider,
    eventId,
    eventType,
    quotationId,
    payload ? JSON.stringify(payload) : null,
  ]);
}
