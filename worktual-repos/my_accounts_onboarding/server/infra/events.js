import { EventEmitter } from "node:events";

import { getRedisClient } from "./redis.js";

export const EVENT_CHANNELS = {
  QUOTATIONS: "events:quotations",
  PAYMENTS: "events:payments",
  TICKETS: "events:tickets",
  MAIL: "events:mail",
};

const localBus = new EventEmitter();
localBus.setMaxListeners(100);

let subscriberReady = false;
const channelHandlers = new Map();

async function ensureSubscriber() {
  if (subscriberReady) {
    return;
  }

  const { getRedisSubscriber } = await import("./redis.js");
  const subscriber = await getRedisSubscriber();
  if (!subscriber) {
    subscriberReady = true;
    return;
  }

  subscriber.on("message", (channel, message) => {
    let payload;
    try {
      payload = JSON.parse(message);
    } catch {
      return;
    }

    localBus.emit(channel, payload);
    localBus.emit("*", { channel, payload });
  });

  subscriberReady = true;
}

export async function subscribeToChannel(channel, handler) {
  await ensureSubscriber();

  localBus.on(channel, handler);

  const { getRedisSubscriber } = await import("./redis.js");
  const subscriber = await getRedisSubscriber();
  if (!subscriber) {
    return () => localBus.off(channel, handler);
  }

  if (!channelHandlers.has(channel)) {
    channelHandlers.set(channel, 0);
    await subscriber.subscribe(channel);
  }
  channelHandlers.set(channel, channelHandlers.get(channel) + 1);

  return () => {
    localBus.off(channel, handler);
    const count = (channelHandlers.get(channel) || 1) - 1;
    if (count <= 0) {
      channelHandlers.delete(channel);
      void subscriber.unsubscribe(channel).catch(() => undefined);
    } else {
      channelHandlers.set(channel, count);
    }
  };
}

export async function publishEvent(channel, payload) {
  const message = JSON.stringify({
    ...payload,
    channel,
    emittedAt: new Date().toISOString(),
  });

  const redis = await getRedisClient();
  if (redis) {
    await redis.publish(channel, message);
    return;
  }

  localBus.emit(channel, JSON.parse(message));
  localBus.emit("*", { channel, payload: JSON.parse(message) });
}

export function publishQuotationEvent(event, data = {}) {
  return publishEvent(EVENT_CHANNELS.QUOTATIONS, { event, ...data });
}

export function publishPaymentEvent(event, data = {}) {
  return publishEvent(EVENT_CHANNELS.PAYMENTS, { event, ...data });
}

export function publishTicketEvent(event, data = {}) {
  return publishEvent(EVENT_CHANNELS.TICKETS, { event, ...data });
}

export function publishMailEvent(event, data = {}) {
  return publishEvent(EVENT_CHANNELS.MAIL, { event, ...data });
}
