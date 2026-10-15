import { EventEmitter } from "node:events";

import { getRedisClient } from "./redis.js";

export const EVENT_CHANNELS = {
  QUOTATIONS: "events:quotations",
  PAYMENTS: "events:payments",
  COMMISSIONS: "events:commissions",
  TICKETS: "events:tickets",
  MAIL: "events:mail",
  CANCELLATIONS: "events:cancellations",
  REQUESTS: "events:requests",
};

const localBus = new EventEmitter();
localBus.setMaxListeners(100);

const PROCESS_ORIGIN = `pid:${process.pid}:${Math.random().toString(36).slice(2, 8)}`;

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

  subscriber.on("message", (channel: any, message: any) => {
    let payload;
    try {
      payload = JSON.parse(message);
    } catch {
      return;
    }

    // Same-process publishes already notified localBus; skip the Redis echo.
    if (payload?.origin === PROCESS_ORIGIN) {
      return;
    }

    localBus.emit(channel, payload);
    localBus.emit("*", { channel, payload });
  });

  subscriberReady = true;
}

export async function subscribeToChannel(channel: any, handler: any) {
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

export async function publishEvent(channel: any, payload: any) {
  const envelope = {
    ...payload,
    channel,
    origin: PROCESS_ORIGIN,
    emittedAt: new Date().toISOString(),
  };

  // Always notify in-process listeners immediately so local SSE clients update
  // even if Redis pub/sub is slow, misconfigured, or not yet subscribed.
  localBus.emit(channel, envelope);
  localBus.emit("*", { channel, payload: envelope });

  const redis = await getRedisClient();
  if (redis) {
    await redis.publish(channel, JSON.stringify(envelope));
  }
}

export function publishQuotationEvent(event: any, data: any = {}) {
  return publishEvent(EVENT_CHANNELS.QUOTATIONS, { event, ...data });
}

export function publishPaymentEvent(event: any, data: any = {}) {
  return publishEvent(EVENT_CHANNELS.PAYMENTS, { event, ...data });
}

export function publishCommissionEvent(event: any, data: any = {}) {
  return publishEvent(EVENT_CHANNELS.COMMISSIONS, { event, ...data });
}

export function publishTicketEvent(event: any, data: any = {}) {
  return publishEvent(EVENT_CHANNELS.TICKETS, { event, ...data });
}

export function publishMailEvent(event: any, data: any = {}) {
  return publishEvent(EVENT_CHANNELS.MAIL, { event, ...data });
}

export function publishCancellationEvent(event: any, data: any = {}) {
  return publishEvent(EVENT_CHANNELS.CANCELLATIONS, { event, ...data });
}

export function publishRequestEvent(event: any, data: any = {}) {
  return publishEvent(EVENT_CHANNELS.REQUESTS, { event, ...data });
}
