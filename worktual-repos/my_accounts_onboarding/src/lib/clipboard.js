export async function copyTextToClipboard(text) {
  const value = String(text ?? "").trim();
  if (!value) {
    throw new Error("Nothing to copy.");
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through to legacy copy.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    const copied = document.execCommand("copy");
    if (!copied) {
      throw new Error("Copy is not supported in this browser.");
    }
    return true;
  } finally {
    document.body.removeChild(textarea);
  }
}
