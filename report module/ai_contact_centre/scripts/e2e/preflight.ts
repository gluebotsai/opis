#!/usr/bin/env npx tsx
import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";
import { runPreflight } from "@ai-contact-center/test-harness";

const requireStack = !process.argv.includes("--db-only");

async function main() {
  const result = await runPreflight({ requireStack });

  if (result.organizationId) {
    console.log(`organizationId=${result.organizationId}`);
  }
  if (result.webchatId) {
    console.log(`webchatId=${result.webchatId}`);
  }
  if (result.whatsappPhoneNumberId) {
    console.log(`whatsappPhoneNumberId=${result.whatsappPhoneNumberId}`);
  }

  if (!result.ok) {
    console.error("Preflight failed:");
    for (const error of result.errors) {
      console.error(`  - ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Preflight OK");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
