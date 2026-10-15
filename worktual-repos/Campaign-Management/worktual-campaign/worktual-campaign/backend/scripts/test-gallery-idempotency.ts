/**
 * Gallery bootstrap idempotency — repeat login must not enqueue duplicate jobs.
 * Run: tsx scripts/test-gallery-idempotency.ts
 */
import assert from "node:assert/strict";
import { prisma } from "../src/plugins/prisma.js";
import { getSessionUserById } from "../src/dao/auth.js";
import {
  assessGalleryBootstrapNeed,
} from "../src/helpers/gallery-bootstrap-need.js";
import {
  enqueueGalleryBootstrapForSession,
} from "../src/services/gallery-bootstrap-worker.js";

async function main() {
  const userId = process.argv.find((a) => a.startsWith("--user-id="))?.split("=")[1] || "1027";
  const session = await getSessionUserById(userId);
  assert.ok(session, `no session for user ${userId}`);

  const assessment = await assessGalleryBootstrapNeed(session, "bootstrap");
  console.log("assessment:", assessment);

  const first = await enqueueGalleryBootstrapForSession(session, "bootstrap");
  console.log("first enqueue:", {
    enqueued: first.enqueued,
    reason: first.reason,
    jobId: first.job?.id,
  });

  const second = await enqueueGalleryBootstrapForSession(session, "bootstrap");
  console.log("second enqueue:", {
    enqueued: second.enqueued,
    reason: second.reason,
    jobId: second.job?.id,
  });

  if (assessment.galleryComplete) {
    assert.equal(
      second.enqueued,
      false,
      "repeat bootstrap must not enqueue when gallery is complete",
    );
    assert.equal(second.reason, "gallery_complete");
    console.log("idempotency test passed (gallery complete)");
  } else if (first.enqueued) {
    assert.equal(
      second.enqueued,
      false,
      "second call while job active or complete should not create duplicate",
    );
    console.log("idempotency test passed (job deduped)");
  } else {
    console.log("skipped strict assert — gallery still building");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
