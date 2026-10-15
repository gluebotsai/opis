import {
  enrichConversationContact,
} from "./cc-core-client.js";
import {
  extractContactEntities,
  hasContactEntities,
  type NlpContactEntities,
} from "./nlp-client.js";

export function mergeContactEntities(
  ...sources: Array<NlpContactEntities | null | undefined>
): NlpContactEntities {
  const merged: NlpContactEntities = {
    email: null,
    phone: null,
    firstName: null,
    lastName: null,
    displayName: null,
    company: null,
    city: null,
    country: null,
  };
  for (const source of sources) {
    if (!source) continue;
    if (!merged.email && source.email?.trim()) merged.email = source.email.trim();
    if (!merged.phone && source.phone?.trim()) merged.phone = source.phone.trim();
    if (!merged.firstName && source.firstName?.trim()) merged.firstName = source.firstName.trim();
    if (!merged.lastName && source.lastName?.trim()) merged.lastName = source.lastName.trim();
    if (!merged.displayName && source.displayName?.trim()) {
      merged.displayName = source.displayName.trim();
    }
    if (!merged.company && source.company?.trim()) merged.company = source.company.trim();
    if (!merged.city && source.city?.trim()) merged.city = source.city.trim();
    if (!merged.country && source.country?.trim()) merged.country = source.country.trim();
  }
  return merged;
}

export async function captureContactFromCustomerMessage(input: {
  organizationId: string;
  conversationId: string;
  message: string;
  sourceMessageId?: string;
  channel: "webchat" | "email";
  nlpEntities?: NlpContactEntities | null;
  importantFacts?: string[];
}): Promise<void> {
  const extracted = await extractContactEntities({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    message: input.message,
    channel: input.channel,
  });
  const entities = mergeContactEntities(input.nlpEntities, extracted);
  if (!hasContactEntities(entities) && !(input.importantFacts?.length ?? 0)) {
    return;
  }

  await enrichConversationContact(
    input.organizationId,
    input.conversationId,
    entities,
    input.sourceMessageId,
    input.importantFacts,
  );
}
