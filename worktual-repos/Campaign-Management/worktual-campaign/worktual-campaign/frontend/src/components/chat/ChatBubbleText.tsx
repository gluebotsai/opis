import {
  looksLikeBrokenChatHtml,
  looksLikeChatHtml,
  sanitizeChatHtml,
  stripIncompleteTrailingTag,
} from "@/lib/chat-html";

/** Assistant/user bubble body — HTML when agent returns Jun30-style tags. */
export function ChatBubbleText({
  text,
  role,
}: {
  text: string;
  role: "user" | "assistant";
}) {
  const raw = text || "";
  if (role === "assistant") {
    const cleaned = stripIncompleteTrailingTag(raw);
    if (looksLikeBrokenChatHtml(raw) && !looksLikeChatHtml(cleaned)) {
      // Truncated markup only — show the readable text, never a raw ``<p``.
      return <>{cleaned || raw}</>;
    }
    if (looksLikeChatHtml(cleaned)) {
      const html = sanitizeChatHtml(cleaned);
      if (html.trim()) {
        return (
          <div
            className="chat-html [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-1 [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-neutral-300 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-neutral-300 [&_td]:px-2 [&_td]:py-1 [&_b]:font-semibold [&_strong]:font-semibold [&_a]:font-medium [&_a]:text-blue-600 [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-blue-800"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      }
    }
  }
  return <>{raw}</>;
}
