export type EmailUrgency = "normal" | "high" | "critical";

export function urgencyToPriority(urgency: EmailUrgency | string | null | undefined): number {
  const normalized = (urgency ?? "normal").trim().toLowerCase();
  if (normalized === "critical") return 2;
  if (normalized === "high") return 1;
  return 0;
}

export function isHighPriority(priority: number): boolean {
  return priority >= 1;
}
