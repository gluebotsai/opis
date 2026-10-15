import assert from "node:assert/strict";
import test from "node:test";

import {
  clearPersistedVoiceCallSession,
  persistVoiceCallSession,
  readPersistedVoiceCallSession,
} from "./voice-call-session.ts";

const store = new Map<string, string>();

function installSessionStorage() {
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
  });
}

test("persistVoiceCallSession survives a read and clears when empty", () => {
  store.clear();
  installSessionStorage();
  persistVoiceCallSession({
    acdSessionId: "sess-1",
    conversationId: "100854",
    destination: "91915009118200",
  });
  assert.deepEqual(readPersistedVoiceCallSession(), {
    acdSessionId: "sess-1",
    conversationId: "100854",
    destination: "91915009118200",
  });
  persistVoiceCallSession({ acdSessionId: null, conversationId: null, destination: null });
  assert.equal(readPersistedVoiceCallSession(), null);
  clearPersistedVoiceCallSession();
});
