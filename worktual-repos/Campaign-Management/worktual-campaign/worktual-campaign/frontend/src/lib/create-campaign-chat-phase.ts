/** Unified chat phase for create-campaign typing vs template progress UX. */

export type CreateCampaignChatPhase =
  | "idle"
  | "awaiting_reply"
  | "template_progress"
  | "pulling_templates";

export type TemplateProgressLike = {
  status: "started" | "generating" | "completed" | "failed";
} | null | undefined;

export function templateProgressBlocksInput(
  progress: TemplateProgressLike,
): boolean {
  return Boolean(progress && progress.status !== "failed");
}

export function deriveCreateCampaignChatPhase(opts: {
  typing: boolean;
  sending: boolean;
  templateProgress: TemplateProgressLike;
  templatesPulling: boolean;
}): CreateCampaignChatPhase {
  if (opts.templatesPulling) return "pulling_templates";
  if (templateProgressBlocksInput(opts.templateProgress)) return "template_progress";
  if (opts.typing || opts.sending) return "awaiting_reply";
  return "idle";
}

export function showTypingIndicator(phase: CreateCampaignChatPhase): boolean {
  return phase === "awaiting_reply";
}

export function composerBusy(
  phase: CreateCampaignChatPhase,
  templateProgress: TemplateProgressLike,
): boolean {
  return (
    phase === "awaiting_reply" ||
    phase === "template_progress" ||
    phase === "pulling_templates" ||
    templateProgressBlocksInput(templateProgress)
  );
}
