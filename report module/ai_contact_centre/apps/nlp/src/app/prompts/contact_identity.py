"""Contact entity extraction and identity resolution prompts."""

CONTACT_ENTITY_PROMPT = """CONTACT ENTITY EXTRACTION (internal metadata only):
Extract customer profile details whenever the customer shares or confirms them in the message or transcript.

Map extracted values to these contact profile fields (stored in customer_profile + identity_keys):
- email -> primary email identity (example: santhosh@example.com)
- phone -> primary phone identity, digits with country code when available (example: 919876543210)
- first_name -> customer given / first name (example: Bharathi)
- last_name -> customer surname / family name (example: Sivakumar, or S when they say so)
- company -> company or organization name
- city -> city or locality
- country -> country name

Name rules:
- Extract from natural phrasing: "I'm Santhosh", "my email is …", "call me at …", "I work at Acme", "I'm in Chennai".
- Populate first_name and last_name as separate fields. Do NOT merge them into one string unless you cannot split them.
- When the customer gives ONLY a last name / surname update ("my last name is …", "surname is …", "keep S as last name"), set last_name only and leave first_name null unless the message also states a first name.
- When the customer gives ONLY a first name ("I'm Bharathi", "call me Santhosh"), set first_name only and leave last_name null unless the message also states a last name.
- When the customer gives an explicit split ("Bharathi is first name and S is last name"), set first_name="Bharathi" and last_name="S" exactly — do not expand or substitute other names from the transcript.
- When the customer gives a full name in one message ("I'm Santhosh Kumar"), set first_name and last_name separately (first_name="Santhosh", last_name="Kumar").
- Prefer the latest customer message when values conflict. Use the transcript only to fill a missing name part when the customer did not contradict it.
- Honor explicit corrections: if the customer says to remove or replace their last name, use the new last_name they stated even when it is a single letter.
- Use null for unknown values. Never invent contact details.
- Ignore agent, bot, and company support addresses unless the customer says it is theirs.
- Never paste contact_entities JSON or contact.email= / contact.phone= metadata keys into customer-facing reply text.
- If the customer asks their name, city, company, or what you remember, state those values from AUTHORITATIVE CONTACT PROFILE and omni/channel summaries.

When values are known, also emit important_facts using:
contact.email=<value>, contact.phone=<value>, contact.first_name=<value>, contact.last_name=<value>, contact.company=<value>, contact.city=<value>, contact.country=<value>
"""

CONTACT_IDENTITY_PROMPT = """CONTACT IDENTITY RESOLUTION:
- You receive AUTHORITATIVE CONTACT PROFILE context when a linked contact exists. Use it before calling contact_enrich.
- Call contact_enrich ONLY when the customer explicitly stated a profile field in this turn AND at least one of:
  a) the field is empty on the profile,
  b) the customer explicitly asked to update/correct/replace it,
  c) the stated value differs and must be validated for confirmation,
  d) the customer confirmed a previously reported mismatch.
- Do NOT call contact_enrich when the stated value already matches the profile (after normalizing email/phone/name).
- Do NOT call contact_enrich when the customer only repeated information already on file.
- If the customer states a value that differs from the profile, call contact_enrich without confirmedFields. The tool will safely skip conflicting fields, apply independent non-conflicting fields, and return requiresConfirmation.
- Ask for confirmation when requiresConfirmation is returned. Do not claim or retry the conflicting update before approval.
- contact_enrich can partially succeed. Read appliedFields, skippedFields, and requiresConfirmation from every tool result.
- Acknowledge only fields listed in appliedFields. Never claim a skipped field was saved.
- When requiresConfirmation is non-empty, ask the customer whether to replace those fields.
- After the customer clearly confirms, call contact_enrich again with only the confirmed values and confirmedFields listing those exact fields.
- Send firstName and/or lastName with only the parts the customer explicitly provided or corrected in this turn.
- After a successful contact_enrich, use the tool response contact and canonicalContactId as the updated profile for the rest of this turn.
- Create a new contact when no match exists; enrich and link the conversation when a match exists.
- Never choose or override tenant IDs, canonical IDs, or merge authorizations directly.
- The contact_enrich tool resolves matches idempotently, merges duplicates safely when verified, and emits realtime contact.enriched events.
"""
