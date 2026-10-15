/**
 * run: npx tsx --tsconfig tsconfig.json src/service/zoominfo/zoominfo-gateway.test.ts
 */
import {
  isZoominfoGatewayConfigured,
  isZoominfoOrgSkipError,
  ZoominfoGatewayRequestError,
  zoominfoGatewayBaseUrl,
} from "./zoominfo-gateway";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const prev = {
  ZOOMINFO_GATEWAY_URL: process.env.ZOOMINFO_GATEWAY_URL,
  ZOOMINFO_GATEWAY_TOKEN: process.env.ZOOMINFO_GATEWAY_TOKEN,
};

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

delete process.env.ZOOMINFO_GATEWAY_TOKEN;
assert(
  isZoominfoGatewayConfigured() === false,
  "gateway should be off without token",
);

process.env.ZOOMINFO_GATEWAY_TOKEN = "test-token";
assert(isZoominfoGatewayConfigured() === true, "gateway on with token");

process.env.ZOOMINFO_GATEWAY_URL = "http://example.test:8199/";
assert(
  zoominfoGatewayBaseUrl() === "http://example.test:8199",
  "base URL strips trailing slash",
);

assert(
  isZoominfoOrgSkipError(
    new ZoominfoGatewayRequestError({
      code: "CONNECTED_APP_NOT_FOUND",
      message: "missing",
      status: 404,
    }),
  ),
  "CONNECTED_APP_NOT_FOUND is skippable",
);
assert(
  isZoominfoOrgSkipError(
    new ZoominfoGatewayRequestError({
      code: "DAILY_CREDIT_LIMIT",
      message: "out",
      status: 429,
    }),
  ) === false,
  "credit limit is not skippable",
);

restore("ZOOMINFO_GATEWAY_URL", prev.ZOOMINFO_GATEWAY_URL);
restore("ZOOMINFO_GATEWAY_TOKEN", prev.ZOOMINFO_GATEWAY_TOKEN);

console.log("zoominfo-gateway.test.ts: ok");
