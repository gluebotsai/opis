/**
 * run: npx tsx --tsconfig tsconfig.json src/service/onboarding/connected-apps-credentials.test.ts
 */
import {
  fetchConnectedAppCredentials,
  fetchConnectedAppCredentialsFirst,
} from "./connected-apps-credentials";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const originalFetch = global.fetch;
const originalToken = process.env.PRODUCT_MCP_CONNECTORS_TOKEN;
const originalBase = process.env.ONBOARDING_INTERNAL_BASE_URL;

async function test404ReturnsNull() {
  process.env.PRODUCT_MCP_CONNECTORS_TOKEN = "test-connectors-token";
  process.env.ONBOARDING_INTERNAL_BASE_URL =
    "https://staging-onboarding.worktual.com";

  let calledUrl = "";
  global.fetch = (async (input: RequestInfo | URL) => {
    calledUrl = String(input);
    return {
      status: 404,
      ok: false,
      text: async () =>
        JSON.stringify({ statusCode: 404, message: "Unknown connected app." }),
    } as Response;
  }) as typeof fetch;

  const result = await fetchConnectedAppCredentials("1000", "semrush");
  assert(result === null, "expected null on 404");
  assert(
    calledUrl.includes("/connected-apps/semrush/credentials"),
    "expected semrush credentials URL",
  );
  assert(calledUrl.includes("organization_id=1000"), "expected org query");
}

async function testSuccessMapping() {
  global.fetch = (async () =>
    ({
      status: 200,
      ok: true,
      text: async () =>
        JSON.stringify({
          statusCode: 200,
          message: "Success",
          credentials: {
            organizationId: "1000",
            appKey: "linkedin",
            provider: "linkedin",
            name: "LinkedIn Ads",
            accessToken: "tok",
            expiresAt: "2026-10-13T09:33:08.230Z",
            scopes: "openid,profile",
            mcpUrl: "",
            authMode: "oauth",
          },
        }),
    }) as Response) as typeof fetch;

  const result = await fetchConnectedAppCredentials("1000", "linkedin");
  assert(result?.accessToken === "tok", "access token");
  assert(result?.appKey === "linkedin", "app key");
  assert(
    result?.expiresAt?.toISOString() === "2026-10-13T09:33:08.230Z",
    "expiresAt",
  );
}

async function testFirstKeyWins() {
  const calls: string[] = [];
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/semrush/")) {
      return {
        status: 404,
        ok: false,
        text: async () => JSON.stringify({ message: "Unknown connected app." }),
      } as Response;
    }
    return {
      status: 200,
      ok: true,
      text: async () =>
        JSON.stringify({
          credentials: {
            organizationId: "1000",
            appKey: "semrush_mcp",
            accessToken: "mcp-tok",
          },
        }),
    } as Response;
  }) as typeof fetch;

  const hit = await fetchConnectedAppCredentialsFirst("1000", [
    "semrush",
    "semrush_mcp",
  ]);
  assert(hit?.accessToken === "mcp-tok", "second key should win");
  assert(calls.length === 2, "expected two attempts");
}

async function main() {
  try {
    await test404ReturnsNull();
    await testSuccessMapping();
    await testFirstKeyWins();
    console.log("connected-apps-credentials.test.ts: ok");
  } finally {
    global.fetch = originalFetch;
    process.env.PRODUCT_MCP_CONNECTORS_TOKEN = originalToken;
    process.env.ONBOARDING_INTERNAL_BASE_URL = originalBase;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
