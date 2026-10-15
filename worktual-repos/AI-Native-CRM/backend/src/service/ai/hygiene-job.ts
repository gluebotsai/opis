/**
 * Hygiene agent bridge — LLM suggest merge/enrich; never auto-merges.
 */

import { findDuplicatesForContactId } from "@/dao/contacts/contact-duplicate-service";
import { getContact } from "@/dao/contacts/contact-service";
import { callAiServiceAgent, AI_SERVICE_JOB_TIMEOUT_MS } from "@/service/ai/ai-service-client";
import { assertRecordAccess } from "@/service/auth/ownership-scope";
import { canEditContacts } from "@/service/auth/rbac";
import { requireRole } from "@/service/auth/require-role";

export async function runHygieneSuggestCommand(contactId: string): Promise<
  | {
      ok: true;
      action: string;
      rationale?: string;
      toolHint?: Record<string, unknown> | null;
      confidence?: number;
      enrichHints?: string[];
      source?: string;
    }
  | { ok: false; error: string }
> {
  try {
    await requireRole(
      canEditContacts,
      "You do not have permission to run contact hygiene.",
    );
    const contact = await getContact(contactId);
    if (!contact) return { ok: false, error: "Contact not found." };
    await assertRecordAccess(contact.crm.ownerUserId);

    const dupes = await findDuplicatesForContactId(contactId);
    const result = await callAiServiceAgent<{
      ok?: boolean;
      action?: string;
      rationale?: string;
      toolHint?: Record<string, unknown> | null;
      confidence?: number;
      enrichHints?: string[];
      source?: string;
      error?: string;
    }>(
      "hygiene",
      {
        contact: {
          id: contact.id,
          displayName: contact.displayName,
          email: contact.person.email,
          phone: contact.person.phone,
          companyName: contact.person.company?.name ?? null,
        },
        candidates: dupes,
      },
      { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
    );

    if (!result || result.ok === false) {
      return {
        ok: false,
        error: result?.error || "Hygiene agent failed.",
      };
    }
    return {
      ok: true,
      action: result.action || "no_action",
      rationale: result.rationale,
      toolHint: result.toolHint ?? null,
      confidence: result.confidence,
      enrichHints: result.enrichHints,
      source: result.source,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Hygiene failed.",
    };
  }
}
