import type { FastifyInstance } from "fastify";
import type Redis from "ioredis";

import {
  createRedisClient,
  createRedisStreamClient,
  createRedisSubscriber,
  setRedisClient,
} from "../lib/redis-client.js";
import { startUmnCallRoutingStreamConsumer } from "../services/umn-call-routing.js";
import { startUmnCallStreamConsumer } from "../services/umn-call-session.js";
import { startUmnCallTranscriptConsumer, transcriptRedisUrl } from "../services/umn-call-transcript.js";
import { startEmbeddedUmnPresenceWriter } from "../services/presence-umn-writer.js";
import { startUmnPresenceSubscriber } from "../services/umn-presence.js";

declare module "fastify" {
  interface FastifyInstance {
    redis: Redis | null;
    redisSubscriber: Redis | null;
    redisCallStream: Redis | null;
    redisCallRoutingStream: Redis | null;
    redisTranscriptStream: Redis | null;
  }
}

export async function registerRedis(app: FastifyInstance): Promise<void> {
  const url = process.env.REDIS_URL?.trim();
  const audioRedisUrl = transcriptRedisUrl();
  let redis: Redis | null = null;
  let redisSubscriber: Redis | null = null;
  let redisCallStream: Redis | null = null;
  let redisCallRoutingStream: Redis | null = null;
  let redisTranscriptStream: Redis | null = null;
  let presenceWriter: Redis | null = null;
  let stopCallStream: (() => void) | null = null;
  let stopCallRoutingStream: (() => void) | null = null;
  let stopTranscriptStream: (() => void) | null = null;

  if (url) {
    try {
      redis = await createRedisClient(url);
      app.log.info("Redis connected for presence cache");
    } catch (error) {
      app.log.warn({ err: error }, "Redis connection failed; presence will use PostgreSQL only");
    }

    try {
      redisSubscriber = await createRedisSubscriber(url);
      startUmnPresenceSubscriber(app, redisSubscriber);
      if (redis) {
        presenceWriter = await createRedisSubscriber(url);
        startEmbeddedUmnPresenceWriter(app, redis, presenceWriter);
      }
    } catch (error) {
      app.log.warn({ err: error }, "UMN presence Redis subscriber failed to start");
      redisSubscriber = null;
    }

    try {
      redisCallStream = await createRedisStreamClient(url);
      stopCallStream = startUmnCallStreamConsumer(app, redisCallStream);
    } catch (error) {
      app.log.warn({ err: error }, "CCAAS call Redis Stream consumer failed to start");
      redisCallStream = null;
    }

    try {
      redisCallRoutingStream = await createRedisStreamClient(url);
      if (!redis) throw new Error("ACD queue routing publisher Redis is unavailable");
      stopCallRoutingStream = startUmnCallRoutingStreamConsumer(
        app,
        redisCallRoutingStream,
        redis,
      );
    } catch (error) {
      app.log.warn({ err: error }, "ACD queue routing Redis Stream consumer failed to start");
      redisCallRoutingStream = null;
    }
  } else {
    app.log.warn("REDIS_URL not set; presence cache disabled");
  }

  if (audioRedisUrl) {
    try {
      redisTranscriptStream = await createRedisStreamClient(audioRedisUrl);
      stopTranscriptStream = startUmnCallTranscriptConsumer(app, redisTranscriptStream);
    } catch (error) {
      app.log.warn({ err: error }, "CCAAS transcript Redis Stream consumer failed to start");
      redisTranscriptStream = null;
    }
  } else {
    app.log.warn("TRANSCRIPT_REDIS_URL not set; live call transcript ingest disabled");
  }

  setRedisClient(redis);
  app.decorate("redis", redis);
  app.decorate("redisSubscriber", redisSubscriber);
  app.decorate("redisCallStream", redisCallStream);
  app.decorate("redisCallRoutingStream", redisCallRoutingStream);
  app.decorate("redisTranscriptStream", redisTranscriptStream);

  app.addHook("onClose", async () => {
    stopCallStream?.();
    stopCallRoutingStream?.();
    stopTranscriptStream?.();
    if (redisCallStream && redisCallStream.status !== "end") {
      redisCallStream.disconnect();
    }
    if (redisCallRoutingStream && redisCallRoutingStream.status !== "end") {
      redisCallRoutingStream.disconnect();
    }
    if (redisTranscriptStream && redisTranscriptStream.status !== "end") {
      redisTranscriptStream.disconnect();
    }
    if (presenceWriter) {
      await presenceWriter.quit();
    }
    if (redisSubscriber) {
      await redisSubscriber.quit();
    }
    if (redis) {
      await redis.quit();
      setRedisClient(null);
    }
  });
}
