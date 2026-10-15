export const CALL_CHANNEL = "call";

export function isCallChannel(channel: string | null | undefined): boolean {
  const value = channel?.trim().toLowerCase();
  return value === "call" || value === "voice" || value === "phone";
}
