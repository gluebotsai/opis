import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import {
  buildInternalChatStorageKey,
  readInternalChatFile,
  sha256Hex,
  writeInternalChatFile,
} from "./internal-chat-storage.js";

let tempRoot = "";
let previousRoot: string | undefined;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "internal-chat-"));
  previousRoot =
    process.env.INTERNAL_CHAT_NFS_PATH ?? process.env.INTERNAL_CHAT_UPLOAD_ROOT;
  process.env.INTERNAL_CHAT_NFS_PATH = tempRoot;
  delete process.env.INTERNAL_CHAT_UPLOAD_ROOT;
});

afterEach(async () => {
  if (previousRoot === undefined) {
    delete process.env.INTERNAL_CHAT_NFS_PATH;
    delete process.env.INTERNAL_CHAT_UPLOAD_ROOT;
  } else {
    process.env.INTERNAL_CHAT_NFS_PATH = previousRoot;
  }
  await rm(tempRoot, { recursive: true, force: true });
});

test("buildInternalChatStorageKey uses org/room layout", () => {
  const key = buildInternalChatStorageKey("1000", "42", "photo.png");
  assert.match(key, /^1000\/42\/.+\/photo\.png$/);
});

test("writeInternalChatFile and readInternalChatFile round-trip", async () => {
  const key = buildInternalChatStorageKey("1000", "42", "note.txt");
  const payload = Buffer.from("hello internal chat");
  await writeInternalChatFile(key, payload);
  const onDisk = await readFile(join(tempRoot, key));
  assert.equal(onDisk.equals(payload), true);
  assert.equal((await readInternalChatFile(key)).equals(payload), true);
  assert.equal(sha256Hex(payload).length, 64);
});
