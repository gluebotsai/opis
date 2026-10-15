import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

/** Offer timeout applied to routing policies during webchat E2E runs. */
export const E2E_OFFER_TIMEOUT_SECONDS = Number.parseInt(
  process.env.PLAYWRIGHT_OFFER_TIMEOUT_SECONDS ?? "10",
  10,
);

let offerTimeoutConfigured = false;

/** Idempotent — runs the DB update once per process. */
export function configureE2eOfferTimeoutOnce(seconds = E2E_OFFER_TIMEOUT_SECONDS): void {
  if (offerTimeoutConfigured) return;
  useE2eOfferTimeoutSeconds(seconds);
  offerTimeoutConfigured = true;
}

export function e2eOfferTimeoutWaitMs(bufferSeconds = 5): number {
  return (E2E_OFFER_TIMEOUT_SECONDS + bufferSeconds) * 1_000;
}

export function cleanupWebchatTestState(): void {
  execSync("npx tsx apps/cc-core/scripts/revoke-e2e-agent-sessions.ts --live", {
    cwd: repoRoot,
    stdio: "pipe",
  });
  execSync("npx tsx apps/cc-core/scripts/cleanup-worktual1-webchat.ts --live", {
    cwd: repoRoot,
    stdio: "pipe",
  });
}

export function useE2eOfferTimeoutSeconds(seconds = E2E_OFFER_TIMEOUT_SECONDS): void {
  execSync(`npx tsx apps/cc-core/scripts/set-offer-timeout.ts --seconds ${seconds} --live`, {
    cwd: repoRoot,
    stdio: "pipe",
  });
}
