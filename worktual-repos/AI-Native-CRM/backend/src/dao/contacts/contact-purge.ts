/**
 * Hard-delete a CRM contact and its CDP person row.
 */
import { deleteActivitiesForContact } from "@/dao/contacts/contact-activity-service";
import { deleteContactProfile } from "@/dao/contacts/contact-profile-repository";
import { purgeCdpCustomerProfile } from "@/dao/account/cdp-profile-delete";
import { prisma } from "@/dao/db/prisma";

const CRM_SATELLITE_TABLES = [
  "process_confirmations",
  "meeting_assist_sessions",
  "agent_step_events",
  "lead_enrichment_jobs",
  "lead_scoring_jobs",
  "lead_nurture_jobs",
  "lead_lifecycle_jobs",
  "lead_summaries",
  "lead_enrichment_snapshots",
  "email_auto_reply_jobs",
  "privacy_requests",
  "meeting_analyses",
  "coaching_insights",
  "notifications",
] as const;

/** Remove CRM agent/job rows keyed by contact_id. */
export async function deleteCrmSatellitesForContact(contactId: string): Promise<void> {
  const id = contactId.trim();
  if (!id) return;

  for (const table of CRM_SATELLITE_TABLES) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM crm.${table} WHERE contact_id = $1`,
      id,
    );
  }

  await prisma.$executeRawUnsafe(
    `DELETE FROM crm.agent_memories
     WHERE scope_type = 'contact' AND scope_id = $1`,
    id,
  );

  await prisma.$executeRawUnsafe(
    `DELETE FROM crm.meeting_analyses ma
     WHERE ma.activity_id IN (
       SELECT a.id FROM crm.contact_activities a WHERE a.contact_id = $1
     )`,
    id,
  );

  await prisma.$executeRawUnsafe(
    `DELETE FROM crm.coaching_insights ci
     WHERE ci.activity_id IN (
       SELECT a.id FROM crm.contact_activities a WHERE a.contact_id = $1
     )`,
    id,
  );

  await prisma.deal.updateMany({
    where: { contactId: id },
    data: { contactId: null },
  });
}

/** Full CRM + CDP purge for one contact id. */
export async function purgeContactCompletely(contactId: string): Promise<void> {
  const id = contactId.trim();
  if (!id) throw new Error("Contact id is required.");
  await deleteActivitiesForContact(id);
  await deleteCrmSatellitesForContact(id);
  await deleteContactProfile(id);
  await purgeCdpCustomerProfile(id);
}

/** @deprecated alias */
export const purgeCdpPerson = purgeCdpCustomerProfile;
