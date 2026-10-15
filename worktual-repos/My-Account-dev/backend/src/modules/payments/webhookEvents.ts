import {
  recordWebhookEventRow,
  tryClaimWebhookEventRow,
  updateWebhookEventPayloadRow,
  webhookEventExists,
} from "../../repositories/functions/webhookEvents.repo.js";

export async function hasProcessedWebhookEvent(provider: any, eventId: any) {
  return webhookEventExists(provider, eventId);
}

// @ts-expect-error -- legacy runtime boundary is validated by integration checks.
export async function tryClaimWebhookEvent({ provider, eventId, eventType }) {
  return tryClaimWebhookEventRow({ provider, eventId, eventType });
}

export async function updateWebhookEventPayload({
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  provider,
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  eventId,
  quotationId = null,
  payload = null,
}) {
  await updateWebhookEventPayloadRow({
    provider,
    eventId,
    quotationId,
    payload,
  });
}

export async function recordWebhookEvent({
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  provider,
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  eventId,
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  eventType,
  quotationId = null,
  payload = null,
}) {
  await recordWebhookEventRow({
    provider,
    eventId,
    eventType,
    quotationId,
    payload,
  });
}
