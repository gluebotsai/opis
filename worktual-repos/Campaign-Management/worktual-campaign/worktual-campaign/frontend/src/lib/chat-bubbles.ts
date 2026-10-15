/** Co-worker chat bubbles — matched to contact-center messageBubbleClassName. */
export function chatBubbleClass(
  role: "user" | "assistant",
  maxWidth = "max-w-[90%]",
  /** Use for Jun30 HTML replies so block tags are not forced onto one pre line. */
  opts?: { html?: boolean },
): string {
  const whiteSpace = opts?.html ? "whitespace-normal" : "whitespace-pre-wrap";
  // min-w-0 + overflow-wrap: long emails / tokens wrap inside padding (no clipped last glyph).
  const base =
    `min-w-0 rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed break-words [overflow-wrap:anywhere] ${whiteSpace}`;
  if (role === "user") {
    return `${base} ${maxWidth} rounded-tr-sm bg-[#111111] text-white`;
  }
  return `${base} ${maxWidth} rounded-tl-none bg-neutral-100 text-neutral-800`;
}

/** @deprecated use chatBubbleClass */
export const CHAT_BUBBLE_USER = chatBubbleClass("user");
/** @deprecated use chatBubbleClass */
export const CHAT_BUBBLE_ASSISTANT = chatBubbleClass("assistant");
