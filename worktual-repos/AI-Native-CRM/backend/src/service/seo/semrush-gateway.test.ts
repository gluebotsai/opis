import {
  isSemrushGatewayConfigured,
  isSemrushQuotaError,
} from "./semrush-gateway";

const prev = process.env.SEMRUSH_GATEWAY_TOKEN;
delete process.env.SEMRUSH_GATEWAY_TOKEN;
if (isSemrushGatewayConfigured()) {
  throw new Error("expected gateway off without token");
}
process.env.SEMRUSH_GATEWAY_TOKEN = "tok";
if (!isSemrushGatewayConfigured()) {
  throw new Error("expected gateway on with token");
}
if (prev === undefined) delete process.env.SEMRUSH_GATEWAY_TOKEN;
else process.env.SEMRUSH_GATEWAY_TOKEN = prev;

if (!isSemrushQuotaError("DAILY_HIT_LIMIT: exhausted")) {
  throw new Error("expected daily quota");
}
if (!isSemrushQuotaError("MONTHLY_UNIT_LIMIT")) {
  throw new Error("expected monthly quota");
}
if (isSemrushQuotaError("CONNECTED_APP_NOT_FOUND")) {
  throw new Error("connected-app is not quota");
}

console.log("semrush-gateway.test.ts: ok");
