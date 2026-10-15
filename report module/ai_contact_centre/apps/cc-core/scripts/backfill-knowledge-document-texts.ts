/**
 * Extract plain text for knowledge documents missing setup_knowledge_document_texts rows.
 *
 * Usage:
 *   npx tsx apps/cc-core/scripts/backfill-knowledge-document-texts.ts
 *   npx tsx apps/cc-core/scripts/backfill-knowledge-document-texts.ts --org-id <uuid>
 */
import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

import { backfillMissingKnowledgeDocumentTexts } from "../src/services/knowledge-documents.js";

const orgArgIndex = process.argv.indexOf("--org-id");
const organizationId = orgArgIndex >= 0 ? process.argv[orgArgIndex + 1] : undefined;

await ccPrisma.$transaction(async (db) => {
  await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  if (organizationId) {
    await db.$executeRaw`
      SELECT set_config('app.organization_id', ${organizationId}, true)
    `;
  }
  const result = await backfillMissingKnowledgeDocumentTexts(db, organizationId);
  console.log(JSON.stringify(result, null, 2));
});

await ccPrisma.$disconnect();
