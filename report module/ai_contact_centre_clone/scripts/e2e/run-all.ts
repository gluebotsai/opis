#!/usr/bin/env npx tsx
import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";
import { runPreflight } from "@ai-contact-center/test-harness";

import { runCrossChannelJourney } from "./test-cross-channel-journey.js";
import { runEmailJourney } from "./test-email-journey.js";
import { runMissedContactReasons } from "./test-missed-contact-reasons.js";
import { runOmniPhoneMemoryJourney } from "./test-omni-phone-memory-journey.js";
import { runWebchatJourney } from "./test-webchat-journey.js";
import { runWhatsAppContactEnrichmentE2e } from "./test-whatsapp-contact-enrichment.js";
import { runWhatsAppJourney } from "./test-whatsapp-journey.js";

type Channel = "webchat" | "email" | "whatsapp" | "whatsapp-enrich" | "identity" | "omni-memory" | "missed-reasons";

function parseArgs() {
  const args = process.argv.slice(2);
  const smoke = args.includes("--smoke");
  const channelArg = args.find((arg) => arg.startsWith("--channel="));
  const channel = channelArg?.split("=")[1] as Channel | undefined;
  return { smoke, channel };
}

async function main() {
  const { smoke, channel } = parseArgs();

  const preflight = await runPreflight();
  if (!preflight.ok) {
    console.error("Preflight failed:");
    for (const error of preflight.errors) {
      console.error(`  - ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  const runners: Array<{ name: Channel; run: () => Promise<unknown> }> = [
    { name: "webchat", run: () => runWebchatJourney({ smoke }) },
    { name: "email", run: () => runEmailJourney({ smoke }) },
    { name: "whatsapp", run: () => runWhatsAppJourney({ smoke }) },
    { name: "whatsapp-enrich", run: () => runWhatsAppContactEnrichmentE2e() },
    { name: "identity", run: () => runCrossChannelJourney({ smoke }) },
    { name: "omni-memory", run: () => runOmniPhoneMemoryJourney() },
    { name: "missed-reasons", run: () => runMissedContactReasons() },
  ];

  const selected = channel ? runners.filter((item) => item.name === channel) : runners;
  if (selected.length === 0) {
    console.error(`Unknown channel: ${channel}`);
    process.exitCode = 1;
    return;
  }

  for (const item of selected) {
    console.log(`\n==> ${item.name} journey`);
    await item.run();
  }

  console.log("\nAll selected E2E journeys passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
