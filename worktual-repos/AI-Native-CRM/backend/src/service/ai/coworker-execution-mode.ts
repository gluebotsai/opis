/** Whether this org/user runs the native coworker orchestrator (ai-service). */
export function coworkerExecutionMode(
  organizationId: string | null,
  userId: string | null,
): "legacy" | "native" {
  if (process.env.COWORKER_NATIVE_ENABLED?.trim().toLowerCase() !== "true") {
    return "legacy";
  }
  const allow = new Set(
    (process.env.COWORKER_NATIVE_ALLOWLIST || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (
    allow.has("*") ||
    (organizationId ? allow.has(organizationId) : false) ||
    (organizationId && userId ? allow.has(`${organizationId}:${userId}`) : false)
  ) {
    return "native";
  }
  return "legacy";
}
