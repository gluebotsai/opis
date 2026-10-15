import assert from "node:assert/strict";
import test from "node:test";

import {
  correlationFromRequest,
  correlationLogFields,
  extendCorrelation,
  logWithCorrelation,
} from "./correlation.js";

test("correlation parses W3C traceparent and retains authenticated scope", () => {
  const correlation = correlationFromRequest({
    headers: {
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    },
    tenantId: "42",
    userId: "7",
  });

  assert.deepEqual(correlation, {
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    organizationId: "42",
    userId: "7",
  });
});

test("correlation envelope carries call and operation fields without losing trace identity", () => {
  const base = correlationFromRequest({
    headers: { "x-trace-id": "request-trace" },
    tenantId: "42",
    userId: "7",
  });
  const correlation = extendCorrelation(base, {
    conversationId: "900",
    acdSessionId: "acd-1",
    transferId: "901",
    callId: "sip-call",
    localTag: "local",
    remoteTag: "remote",
    leg: "consult",
    fsmPhase: "consult_active",
    action: 2,
    operationId: "op-1",
    presenceVersion: 3,
  });

  assert.equal(correlation.traceId, "request-trace");
  assert.deepEqual(correlationLogFields(correlation, { event: "transfer.action" }), {
    event: "transfer.action",
    correlation,
  });
});

test("correlated logging emits one structured envelope", () => {
  const calls: unknown[][] = [];
  const logger = {
    info(fields: Record<string, unknown>, message: string) {
      calls.push([fields, message]);
    },
  };

  logWithCorrelation(
    logger,
    "info",
    { traceId: "trace-1", organizationId: "42", operationId: "op-1" },
    "published transfer action",
    { event: "transfer.action.published" },
  );

  assert.deepEqual(calls, [
    [
      {
        event: "transfer.action.published",
        correlation: { traceId: "trace-1", organizationId: "42", operationId: "op-1" },
      },
      "published transfer action",
    ],
  ]);
});
