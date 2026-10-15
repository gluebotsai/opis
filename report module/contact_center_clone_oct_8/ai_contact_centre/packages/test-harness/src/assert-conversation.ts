import type { CcCoreClient } from "./cc-core-client.js";

export async function assertConversationStatus(
  client: CcCoreClient,
  organizationId: string,
  conversationId: string,
  expected: string | string[],
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const intervalMs = options.intervalMs ?? 500;
  const allowed = Array.isArray(expected) ? expected : [expected];
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const payload = await client.requestInternal<{ conversation: { status: string } }>(
      organizationId,
      "GET",
      `/internal/v1/conversations/${conversationId}`,
    ).catch(() => null);

    const status = payload?.conversation?.status;
    if (status && allowed.includes(status)) {
      return;
    }
    await sleep(intervalMs);
  }

  throw new Error(
    `Conversation ${conversationId} did not reach status ${allowed.join("|")} within ${timeoutMs}ms`,
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
