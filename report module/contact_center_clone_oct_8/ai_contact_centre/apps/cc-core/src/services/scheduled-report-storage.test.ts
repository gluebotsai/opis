import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import {
  buildScheduledReportPdfStorageKey,
  readScheduledReportPdf,
  resolveScheduledReportPdfPath,
  writeScheduledReportPdf,
} from "./scheduled-report-storage.js";

let tempRoot = "";
let previousRoot: string | undefined;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "scheduled-reports-"));
  previousRoot = process.env.SCHEDULED_REPORTS_ROOT;
  process.env.SCHEDULED_REPORTS_ROOT = tempRoot;
});

afterEach(async () => {
  if (previousRoot === undefined) {
    delete process.env.SCHEDULED_REPORTS_ROOT;
  } else {
    process.env.SCHEDULED_REPORTS_ROOT = previousRoot;
  }
  await rm(tempRoot, { recursive: true, force: true });
});

test("buildScheduledReportPdfStorageKey uses org/schedule/run layout", () => {
  assert.equal(
    buildScheduledReportPdfStorageKey("1000", "42", "99"),
    "1000/42/99.pdf",
  );
});

test("writeScheduledReportPdf and readScheduledReportPdf round-trip", async () => {
  const key = buildScheduledReportPdfStorageKey("1000", "42", "99");
  const pdf = Buffer.from("%PDF-1.4 test");
  await writeScheduledReportPdf(key, pdf);

  const absolutePath = resolveScheduledReportPdfPath(key);
  const onDisk = await readFile(absolutePath);
  assert.equal(onDisk.equals(pdf), true);
  assert.equal((await readScheduledReportPdf(key)).equals(pdf), true);
});
