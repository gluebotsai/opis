import {
  recordWebhookEventRow,
  tryClaimWebhookEventRow,
  updateWebhookEventPayloadRow,
  webhookEventExists,
} from "../repositories/functions/webhookEvents.repo.js";

export async function hasProcessedWebhookEvent(provider, eventId) {
  return webhookEventExists(provider, eventId);
}

export async function tryClaimWebhookEvent({ provider, eventId, eventType }) {
  return tryClaimWebhookEventRow({ provider, eventId, eventType });
}

export async function updateWebhookEventPayload({
  provider,
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
  provider,
  eventId,
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
