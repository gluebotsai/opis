/** Worktual Semrush gateway — CRM never holds Semrush OAuth/MCP secrets. */

export function isSemrushGatewayConfigured(): boolean {
  return Boolean(process.env.SEMRUSH_GATEWAY_TOKEN?.trim());
}

export function isSemrushQuotaError(message: string | null | undefined): boolean {
  const raw = (message || "").toUpperCase();
  return raw.includes("DAILY_HIT_LIMIT") || raw.includes("MONTHLY_UNIT_LIMIT");
}
