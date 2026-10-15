/** Stick to latest only when the user is already near the bottom. */
export function isChatStuckToBottom(scroller: HTMLElement | null): boolean {
  if (!scroller) return true;
  const gap = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
  return gap < 96;
}

export function scrollChatToBottom(
  scroller: HTMLElement | null,
  end: HTMLElement | null,
  force = false,
): void {
  if (!end) return;
  if (!force && !isChatStuckToBottom(scroller)) return;
  end.scrollIntoView({ behavior: "smooth", block: "end" });
}
