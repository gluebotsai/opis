/**
 * Shared types for co-worker routes.
 * Intelligence lives in Python ai-service `crm-agent`.
 */

/** User-visible chat when the LLM is down or a coworker turn fails. */
export const COWORKER_LLM_ERROR_SPEECH = "something went wrong";
export const COWORKER_GENERIC_TURN_FAIL = "I couldn't finish that just now. Try again.";
export const COWORKER_TOOL_LOOP_FAIL =
  "I couldn't finish generating that. Send the topic again and I'll retry.";

const INTERNAL_FAIL_RE =
  /repeated tool call|tool loop|budget exhausted|deadline exceeded|tool cycle|no module named|modulenotfounderror|importerror|traceback \(most recent|psycopg|file ".*\.py"/i;

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error.trim();
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message || "").trim();
  }
  return "";
}

/** Chat copy for a failed turn — never leak driver/import/stack internals. */
export function coworkerFailureSpeech(result: {
  error?: unknown;
  assistantText?: string;
}): string {
  const assistant = String(result.assistantText || "").trim();
  const err = errorMessage(result.error);
  const blob = `${assistant} ${err}`;
  if (
    /repeated tool call|tool loop|budget exhausted|deadline exceeded|tool cycle/i.test(
      blob,
    )
  ) {
    return COWORKER_TOOL_LOOP_FAIL;
  }
  if (assistant && !INTERNAL_FAIL_RE.test(assistant)) return assistant;
  if (err && !INTERNAL_FAIL_RE.test(err)) return err;
  return COWORKER_GENERIC_TURN_FAIL;
}

export type CoworkerMessage = {
  role: "assistant" | "user";
  text: string;
};

export function lastUserText(messages: CoworkerMessage[]): string | null {
  const last = [...messages].reverse().find((m) => m.role === "user");
  return last?.text?.trim() || null;
}
