import assert from "node:assert/strict";
import test from "node:test";
import { jsPDF } from "jspdf";

import {
  DASHBOARD_CAPTURE_PAGE_WIDTH_PT,
  addDashboardImageFitToPage,
  dashboardCapturePageFormat,
} from "./dashboard-pdf-image.js";

const ONE_BY_ONE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("dashboardCapturePageFormat uses portrait width for a tall Reports PNG", () => {
  const [width, height] = dashboardCapturePageFormat(1100, 3200);
  assert.equal(width, DASHBOARD_CAPTURE_PAGE_WIDTH_PT);
  assert.ok(height > width);
});

test("addDashboardImageFitToPage keeps tall dashboard captures on one page", () => {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const dataUrl = `data:image/png;base64,${ONE_BY_ONE_PNG.toString("base64")}`;

  addDashboardImageFitToPage(doc, dataUrl, 1100, 3200, 36);

  assert.equal(doc.getNumberOfPages(), 1);
});
