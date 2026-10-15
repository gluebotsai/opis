/** Meta approval row from campaign.launchPlan.whatsapp (monitor UI). */

export type WhatsAppLaunchMeta = {
  status?: string;
  template_name?: string;
  approved_at?: string | null;
  rejected_reason?: string | null;
  last_status_checked_at?: string | null;
};

export function readWhatsAppLaunchMeta(
  launchPlan: Record<string, unknown> | null | undefined,
): WhatsAppLaunchMeta | null {
  if (!launchPlan || typeof launchPlan !== "object") return null;
  const wa = launchPlan.whatsapp;
  if (!wa || typeof wa !== "object") return null;
  const row = wa as Record<string, unknown>;
  const status = String(row.status || "").trim().toLowerCase();
  if (!status) return null;
  return {
    status,
    template_name: row.template_name ? String(row.template_name) : undefined,
    approved_at: row.approved_at ? String(row.approved_at) : null,
    rejected_reason: row.rejected_reason
      ? String(row.rejected_reason)
      : null,
    last_status_checked_at: row.last_status_checked_at
      ? String(row.last_status_checked_at)
      : null,
  };
}

export function formatWhatsAppMetaBadge(meta: WhatsAppLaunchMeta): string {
  const st = (meta.status || "").toUpperCase();
  const name = meta.template_name ? ` · ${meta.template_name}` : "";
  if (st === "PENDING") {
    return `Meta approval: PENDING${name} — sends start after approval at launch time.`;
  }
  if (st === "APPROVED") {
    return `Meta approval: APPROVED${name}.`;
  }
  if (st === "REJECTED") {
    const why = meta.rejected_reason ? ` (${meta.rejected_reason})` : "";
    return `Meta approval: REJECTED${name}${why}.`;
  }
  return `Meta: ${st}${name}.`;
}
