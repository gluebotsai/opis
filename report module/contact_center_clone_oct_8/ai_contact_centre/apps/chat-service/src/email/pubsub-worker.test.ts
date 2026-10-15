import assert from "node:assert/strict";
import test from "node:test";

import { GmailPubSubWorker } from "./pubsub-worker.js";
import type { ChatServiceConfig } from "../config.js";

const config: ChatServiceConfig = {
  port: 3002,
  serviceName: "test",
  internalServiceKey: "test",
  ccCoreUrl: "http://localhost:3000",
  gmailPubSub: null,
  gmailOAuth: null,
  tokenEncryptionKey: null,
};
const logger = {
  info() {},
  warn() {},
  error() {},
} as never;

function invoke(
  processor: { processNotification: () => Promise<number> },
  data: unknown,
): Promise<{ acked: number; nacked: number }> {
  const worker = new GmailPubSubWorker(config, processor as never, logger);
  const result = { acked: 0, nacked: 0 };
  const handle = (
    worker as unknown as {
      handleMessage(message: {
        data: Buffer;
        ack: () => void;
        nack: () => void;
      }): Promise<void>;
    }
  ).handleMessage.bind(worker);
  return handle({
    data: Buffer.from(typeof data === "string" ? data : JSON.stringify(data)),
    ack: () => {
      result.acked += 1;
    },
    nack: () => {
      result.nacked += 1;
    },
  }).then(() => result);
}

test("Pub/Sub ACKs only committed processing success", async () => {
  const result = await invoke(
    { processNotification: async () => 1 },
    { emailAddress: "support@example.com", historyId: "1" },
  );
  assert.deepEqual(result, { acked: 1, nacked: 0 });
});

test("Pub/Sub NACKs transient processor failures", async () => {
  const result = await invoke(
    {
      processNotification: async () => {
        throw new Error("temporary");
      },
    },
    { emailAddress: "support@example.com" },
  );
  assert.deepEqual(result, { acked: 0, nacked: 1 });
});

test("Pub/Sub ACKs malformed non-retryable payloads", async () => {
  const result = await invoke({ processNotification: async () => 0 }, "{not-json");
  assert.deepEqual(result, { acked: 1, nacked: 0 });
});

test("Pub/Sub serializes one mailbox without blocking another mailbox", async () => {
  let releaseFirst!: () => void;
  const firstBlocked = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const started: string[] = [];
  const processor = {
    async processNotification(input: { emailAddress: string }): Promise<number> {
      started.push(input.emailAddress);
      if (input.emailAddress === "first@example.com" && started.length === 1) {
        await firstBlocked;
      }
      return 1;
    },
  };
  const worker = new GmailPubSubWorker(config, processor as never, logger);
  const handle = (
    worker as unknown as {
      handleMessage(message: {
        data: Buffer;
        ack: () => void;
        nack: () => void;
      }): Promise<void>;
    }
  ).handleMessage.bind(worker);
  const message = (emailAddress: string) => ({
    data: Buffer.from(JSON.stringify({ emailAddress })),
    ack() {},
    nack() {},
  });

  const first = handle(message("first@example.com"));
  await Promise.resolve();
  const sameMailbox = handle(message("first@example.com"));
  const otherMailbox = handle(message("second@example.com"));
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(started, ["first@example.com", "second@example.com"]);
  releaseFirst();
  await Promise.all([first, sameMailbox, otherMailbox]);
  assert.deepEqual(started, [
    "first@example.com",
    "second@example.com",
    "first@example.com",
  ]);
});
