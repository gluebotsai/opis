import { prisma } from "../src/dao/db/prisma.js";
import { getUserLabelsByIds } from "../src/service/account/user-directory.js";
import { getContact } from "../src/dao/contacts/contact-service.js";

async function main() {
  const sessionId = process.argv[2] || "cmucimnj6002t1a8854wvsdbf";
  const session = await prisma.meetingAssistSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      contactId: true,
      hostUserId: true,
      organizationId: true,
    },
  });
  console.log("session", session);
  if (session?.contactId) {
    const contact = await getContact(session.contactId);
    console.log("contact", contact && {
      id: contact.id,
      displayName: (contact as any).displayName,
      person: (contact as any).person,
    });
  }
  if (session?.hostUserId) {
    const labels = await getUserLabelsByIds([String(session.hostUserId)]);
    console.log("hostUser label", labels.get(String(session.hostUserId)));
  }
}

main().finally(() => process.exit(0));
