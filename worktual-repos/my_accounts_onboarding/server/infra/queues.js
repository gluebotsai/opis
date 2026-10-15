import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";

import { getRedisUrl, isRedisConfigured } from "./env.js";
import { createEmailOutboxEntry } from "./emailOutbox.js";

export const QUEUE_NAMES = {
  EMAIL: "email:send",
  PAYMENT: "payment:fulfill",
  BILLING: "billing:sweep",
  MAIL: "mail:sync",
};

let connection = null;
const queues = new Map();
let inlineWorkerRegistered = false;

function getConnection() {
  if (!isRedisConfigured()) {
    return null;
  }

  if (!connection) {
    connection = new IORedis(getRedisUrl(), {
      maxRetriesPerRequest: null,
    });
  }

  return connection;
}

function getQueue(name) {
  const conn = getConnection();
  if (!conn) {
    return null;
  }

  if (!queues.has(name)) {
    queues.set(
      name,
      new Queue(name, {
        connection: conn,
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 200,
          attempts: 5,
          backoff: { type: "exponential", delay: 5000 },
        },
      }),
    );
  }

  return queues.get(name);
}

async function runInline(jobName, data, processor) {
  if (!processor) {
    throw new Error(`No inline processor registered for ${jobName}`);
  }

  await processor({ name: jobName, data });
}

export function registerInlineWorker(processors) {
  inlineWorkerRegistered = true;
  return processors;
}

let inlineProcessors = null;

export function setInlineProcessors(processors) {
  inlineProcessors = processors;
}

async function enqueueOrRun(queueName, jobName, data, options = {}) {
  const queue = getQueue(queueName);
  if (queue) {
    return queue.add(jobName, data, options);
  }

  if (!inlineProcessors) {
    console.warn(`[queues] Redis unavailable — dropping job ${queueName}/${jobName}`);
    return null;
  }

  const processor = inlineProcessors[queueName];
  await runInline(jobName, data, processor);
  return { inline: true };
}

export async function enqueueEmailJob(jobType, payload, meta = {}) {
  const outboxId = await createEmailOutboxEntry({
    jobType,
    payload,
    toEmail: meta.toEmail || null,
    subject: meta.subject || null,
  });

  return enqueueOrRun(QUEUE_NAMES.EMAIL, jobType, { outboxId, jobType, ...payload });
}

export async function enqueuePaymentFulfillment(data) {
  return enqueueOrRun(QUEUE_NAMES.PAYMENT, "fulfill", data, {
    jobId: data.eventId ? `stripe:${data.eventId}` : undefined,
  });
}

export async function enqueueBillingSweep() {
  return enqueueOrRun(QUEUE_NAMES.BILLING, "sweep", { runAt: new Date().toISOString() });
}

export async function enqueueMailSync(data) {
  return enqueueOrRun(QUEUE_NAMES.MAIL, "sync", data);
}

export function createQueueWorker(queueName, processor, options = {}) {
  const conn = getConnection();
  if (!conn) {
    if (!inlineWorkerRegistered) {
      setInlineProcessors({ [queueName]: processor });
    }
    return null;
  }

  return new Worker(queueName, processor, {
    connection: conn,
    concurrency: options.concurrency || 5,
  });
}

export async function scheduleBillingCron() {
  const queue = getQueue(QUEUE_NAMES.BILLING);
  if (!queue) {
    return;
  }

  await queue.add(
    "sweep",
    { runAt: new Date().toISOString() },
    {
      repeat: { pattern: "0 2 * * *" },
      jobId: "billing-daily-sweep",
    },
  );
}

export async function closeQueues() {
  for (const queue of queues.values()) {
    await queue.close();
  }
  queues.clear();

  if (connection) {
    await connection.quit();
    connection = null;
  }
}
