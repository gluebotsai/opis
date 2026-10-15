/** Plain sentence for the contact-page “Nurture skipped” banner. */

export function skippedReason(input: {
  decision?: string | null;
  skipReason?: string | null;
  lastError?: string | null;
  rationale?: string | null;
}): string {
  const code = (input.skipReason || input.lastError || "").trim();
  const fromModel = plainSkipReason(input.rationale);
  if (fromModel) return fromModel;
  if (input.decision === "skip_not_interested") {
    return "they asked not to be contacted";
  }
  return reasonFromCode(code);
}

function plainSkipReason(rationale: string | null | undefined): string | null {
  const text = rationale?.trim().replace(/\s+/g, " ") ?? "";
  if (!text || text.length > 180 || /[`"{}]/.test(text)) return null;
  const coded = reasonFromCode(text);
  if (coded !== "no reason was recorded" && !text.includes(" ")) return coded;
  if (!text.includes(" ")) return null;
  return text.replace(/\.$/, "");
}

function reasonFromCode(code: string): string {
  const key = code.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!key) return "no reason was recorded";
  if (key === "contact_assigned_to_sales" || key === "assigned_to_rep") {
    return "this lead is assigned to a sales rep, so they own the follow-up";
  }
  if (key === "score_sales_ready") {
    return "the lead score is high enough for sales to take over";
  }
  if (key === "not_an_open_lead") return "this contact is no longer an open lead";
  if (key === "marketing_opt_out") return "they opted out of marketing";
  if (key === "contact_not_found") return "the contact could not be found";
  if (key === "no_owner_mailbox" || key === "no_owner") {
    return "assign an owner with a connected mailbox";
  }
  if (key === "no_email") return "contact has no email";
  if (key === "no_channel" || key === "no_email_or_phone") {
    return "there is no email or phone on file";
  }
  if (key === "no_nurture_transport" || key === "no_crm_bot_mailbox") {
    return "voice, Campaign, and the CRM bot mailbox are not available";
  }
  if (key.length <= 80 && !key.includes("\n")) return code.trim();
  return "no reason was recorded";
}
