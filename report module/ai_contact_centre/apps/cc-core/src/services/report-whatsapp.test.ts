import assert from "node:assert/strict";
import test from "node:test";

import {
  SCHEDULED_REPORT_PDF_TEMPLATE,
  buildReportWhatsAppTemplateComponents,
  buildScheduledReportPdfPublicUrl,
  isApprovedWhatsAppTemplateStatus,
  isMetaFetchableHttpsUrl,
  signReportPdfToken,
  toWhatsAppRecipient,
  verifyReportPdfToken,
} from "./report-whatsapp.js";

test("isApprovedWhatsAppTemplateStatus accepts approved only", () => {
  assert.equal(isApprovedWhatsAppTemplateStatus("approved"), true);
  assert.equal(isApprovedWhatsAppTemplateStatus("APPROVED"), true);
  assert.equal(isApprovedWhatsAppTemplateStatus(" pending "), false);
  assert.equal(isApprovedWhatsAppTemplateStatus("draft"), false);
  assert.equal(isApprovedWhatsAppTemplateStatus("rejected"), false);
  assert.equal(isApprovedWhatsAppTemplateStatus(null), false);
});

test("toWhatsAppRecipient keeps E.164 digits and prefixes 10-digit India numbers", () => {
  assert.equal(toWhatsAppRecipient("+91 91509 11820"), "919150911820");
  assert.equal(toWhatsAppRecipient("9150911820"), "919150911820");
  assert.equal(toWhatsAppRecipient("123"), null);
  assert.equal(toWhatsAppRecipient(null), null);
});

test("isMetaFetchableHttpsUrl rejects localhost and http", () => {
  assert.equal(
    isMetaFetchableHttpsUrl("https://rebuild-ccaas-api.worktual.com/cc-core-api/api/v1/public/reports/runs/1/pdf"),
    true,
  );
  assert.equal(isMetaFetchableHttpsUrl("http://rebuild-ccaas-api.worktual.com/x"), false);
  assert.equal(isMetaFetchableHttpsUrl("https://localhost/api/v1/public/reports/runs/1/pdf"), false);
  assert.equal(isMetaFetchableHttpsUrl("https://127.0.0.1/pdf"), false);
  assert.equal(isMetaFetchableHttpsUrl(null), false);
});

test("report PDF token round-trips and rejects a different run", () => {
  const secret = "report-pdf-test-secret";
  const token = signReportPdfToken(
    { organizationId: "1000", runId: "42" },
    secret,
    Date.parse("2026-09-09T00:00:00.000Z"),
  );
  assert.deepEqual(
    verifyReportPdfToken(token, { runId: "42" }, secret, Date.parse("2026-09-09T00:00:00.000Z")),
    { organizationId: "1000" },
  );
  assert.equal(
    verifyReportPdfToken(token, { runId: "99" }, secret, Date.parse("2026-09-09T00:00:00.000Z")),
    null,
  );
  assert.equal(
    verifyReportPdfToken(token, { runId: "42" }, secret, Date.parse("2026-09-10T00:00:00.000Z")),
    null,
  );
});

test("buildScheduledReportPdfPublicUrl uses public HTTPS API path", () => {
  const url = buildScheduledReportPdfPublicUrl(
    "42",
    "1000.1.sig",
    "https://rebuild-ccaas-api.worktual.com/cc-core-api",
  );
  assert.equal(
    url,
    "https://rebuild-ccaas-api.worktual.com/cc-core-api/api/v1/public/reports/runs/42/pdf?token=1000.1.sig",
  );
  assert.equal(buildScheduledReportPdfPublicUrl("42", "tok", ""), null);
});

test("WhatsApp payload uses PDF template header and body params", () => {
  const components = buildReportWhatsAppTemplateComponents(
    "https://example.com/report.pdf",
    "Daily performance report",
    "24 Aug 2026",
  );
  assert.equal(SCHEDULED_REPORT_PDF_TEMPLATE, "scheduled_report_pdf_v1");
  assert.deepEqual(components, [
    {
      type: "header",
      parameters: [{ type: "document", document: { link: "https://example.com/report.pdf" } }],
    },
    {
      type: "body",
      parameters: [
        { type: "text", text: "Daily performance report" },
        { type: "text", text: "24 Aug 2026" },
      ],
    },
  ]);
});
