/**
 * run: npx tsx src/service/ai/proposal-corpus-backfill.test.ts
 */
import {
  LEGACY_AUTO_CONFIDENCE_FLOOR,
  backfillWritesVisualPlaybookFk,
  pairingSourceForBackfill,
  shouldPersistScoredPair,
} from "@/lib/proposal-content-playbook";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(LEGACY_AUTO_CONFIDENCE_FLOOR === 0.65, "backfill scans pairs ≥ 0.65");
assert(
  pairingSourceForBackfill("legacy_auto") === "legacy_auto",
  "existing auto pairs stay legacy_auto",
);
assert(
  pairingSourceForBackfill(undefined) === "legacy_auto",
  "unlabeled historical pairs become legacy_auto",
);
assert(
  shouldPersistScoredPair({
    pairingSource: pairingSourceForBackfill(null),
    confidence: 0.65,
  }),
  "0.65 legacy pairs are eligible for case-study backfill",
);
assert(
  backfillWritesVisualPlaybookFk() === false,
  "backfill never writes contentPlaybookId on existing visual playbooks",
);

console.log("proposal-corpus-backfill.test.ts ok");
