import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";
import { withOrganizationContext } from "../src/lib/rls.js";
import { listConversationMessagesPaginated } from "../src/services/conversations.js";

async function main() {
  const messages = await ccPrisma.$queryRawUnsafe(`
    SELECT id::text,
           sender_type,
           left(body, 60) AS body,
           model_metadata->>'speaker' AS speaker,
           model_metadata->>'speakerUserId' AS speaker_user_id,
           model_metadata->>'speakerName' AS speaker_name,
           model_metadata->>'speakerExt' AS speaker_ext,
           created_at
    FROM ccass.conversation_messages
    WHERE created_at > NOW() - INTERVAL '30 minutes'
      AND model_metadata->>'source' = 'call_transcript'
    ORDER BY created_at DESC
    LIMIT 20
  `);
  console.log(JSON.stringify(messages, null, 2));
  const users = await ccPrisma.$queryRawUnsafe(`
    SELECT id::text AS id, ext::text AS ext, organization_id::text AS organization_id,
           NULLIF(btrim(concat_ws(' ', first_name, last_name)), '') AS name
    FROM accounts.setup_users
    WHERE ext::text IN ('101', '103')
       OR id::text IN ('101', '103', '1001', '1003')
  `);
  console.log(JSON.stringify(users, null, 2));
  const org = await ccPrisma.$queryRawUnsafe(`
    SELECT m.organization_id::text AS organization_id, c.assigned_user_id::text AS assigned_user_id
    FROM ccass.conversation_messages m
    JOIN ccass.conversations c ON c.id = m.conversation_id
    WHERE m.id = 10456
  `);
  console.log(JSON.stringify(org, null, 2));
  const matched = await withOrganizationContext(ccPrisma, "1000", async (db) => {
    return db.$queryRaw`
      SELECT id::text AS id, ext::text AS ext,
             NULLIF(btrim(concat_ws(' ', first_name, last_name)), '') AS name
      FROM accounts.setup_users
      WHERE organization_id = ${"1000"}::bigint
        AND (
          ext::text = ${"101"}
          OR id::text = ${"101"}
          OR (${""}::text <> '' AND lower(work_email) = ${""})
        )
      LIMIT 5
    `;
  });
  console.log(JSON.stringify(matched, null, 2));
  const raw = await ccPrisma.$queryRawUnsafe(`
    SELECT conversation_id::text AS conversation_id, model_metadata
    FROM ccass.conversation_messages
    WHERE id = 10456
  `);
  console.log(JSON.stringify(raw, null, 2));
  const conversationId = (raw as Array<{ conversation_id: string }>)[0]?.conversation_id;
  if (conversationId) {
    const page = await withOrganizationContext(ccPrisma, "1000", (db) =>
      listConversationMessagesPaginated(db, "1000", conversationId, { limit: 8, offset: 0 }),
    );
    console.log(
      JSON.stringify(
        page.messages.map((message) => ({
          body: message.body.slice(0, 40),
          senderType: message.senderType,
          senderUserId: message.senderUserId ?? null,
          senderName: message.senderName ?? null,
        })),
        null,
        2,
      ),
    );
  }
  await ccPrisma.$disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
