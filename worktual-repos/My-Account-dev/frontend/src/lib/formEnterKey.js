/**
 * Block Enter in form fields from implicitly submitting the form
 * (which advances multi-step / Save & Next flows). Textareas and
 * explicit button/submit controls still receive Enter normally.
 */
export function preventEnterFormSubmit(event) {
  if (event.key !== "Enter") {
    return;
  }

  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "BUTTON") {
    return;
  }

  if (tag === "INPUT") {
    const type = (target.getAttribute("type") || "text").toLowerCase();
    if (type === "submit" || type === "button" || type === "reset") {
      return;
    }
  }

  // SELECT / INPUT text|number|etc. — do not advance the wizard on Enter.
  event.preventDefault();
  event.stopPropagation();
}
