/** String campaign id for pino JSON (`"campaignId":"1370"`) — Prisma BigInt-safe. */
export function logCampaignId(id: unknown): string {
  if (id == null || id === "") return "";
  return String(id);
}

export function sendLogCtx(args: {
  campaignId: unknown;
  batchId?: string;
  channel?: string;
  recipientId?: string;
}): Record<string, string> {
  const out: Record<string, string> = {
    campaignId: logCampaignId(args.campaignId),
  };
  if (args.batchId) out.batchId = args.batchId;
  if (args.channel) out.channel = args.channel;
  if (args.recipientId) out.recipientId = args.recipientId;
  return out;
}
