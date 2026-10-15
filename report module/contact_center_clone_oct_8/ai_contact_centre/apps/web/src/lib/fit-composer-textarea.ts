/** Grow a composer textarea up to `maxLines`, then enable vertical scroll. */
export function fitComposerTextarea(textarea: HTMLTextAreaElement, maxLines = 4) {
  const style = window.getComputedStyle(textarea);
  const lineHeight = Number.parseFloat(style.lineHeight) || 20;
  const padding =
    Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
  const maxHeight = lineHeight * maxLines + padding;

  textarea.style.height = "0px";
  const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = textarea.scrollHeight > maxHeight + 1 ? "auto" : "hidden";
}
