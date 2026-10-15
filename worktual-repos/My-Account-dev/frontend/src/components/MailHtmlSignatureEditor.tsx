// @ts-nocheck
import { useEffect, useRef } from "react";

import {
  insertHtmlAtCursor,
  looksLikeFullSignatureHtml,
  looksLikeHtmlSource,
  normalizePastedHtml,
} from "../lib/mailHtmlPaste.js";

/**
 * HTML-preserving signature editor.
 * TipTap/ProseMirror strips email signature markup (nested tables, VML, styles).
 * contentEditable keeps pasted Outlook/Gmail HTML intact for preview + send.
 */
export function MailHtmlSignatureEditor({
  value = "",
  onChange,
  minHeight = 280,
  placeholder = "Paste your email signature here…",
}) {
  const surfaceRef = useRef(null);
  const skipSyncRef = useRef(false);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || skipSyncRef.current) {
      return;
    }
    const next = value || "";
    if (surface.innerHTML !== next) {
      surface.innerHTML = next;
    }
  }, [value]);

  function emitChange() {
    const surface = surfaceRef.current;
    if (!surface) {
      return;
    }
    skipSyncRef.current = true;
    onChange?.(surface.innerHTML);
    queueMicrotask(() => {
      skipSyncRef.current = false;
    });
  }

  function handlePaste(event) {
    const clipboard = event.clipboardData;
    if (!clipboard) {
      return;
    }

    const htmlData = clipboard.getData("text/html");
    const textData = clipboard.getData("text/plain");
    const payload = htmlData?.trim()
      ? normalizePastedHtml(htmlData)
      : looksLikeHtmlSource(textData)
        ? normalizePastedHtml(textData)
        : "";

    if (!payload) {
      return;
    }

    event.preventDefault();
    const surface = surfaceRef.current;
    if (!surface) {
      return;
    }

    surface.focus();
    const replaceAll =
      looksLikeFullSignatureHtml(payload) || !String(surface.innerText || "").trim();

    if (replaceAll) {
      surface.innerHTML = payload;
    } else {
      insertHtmlAtCursor(payload);
    }

    emitChange();
  }

  return (
    <div className="mail-html-signature-editor">
      <p className="mail-html-signature-editor__hint">
        Paste from Outlook, Gmail, or a browser page to keep the full layout (logo, tables, links,
        icons).
      </p>
      <div
        ref={surfaceRef}
        aria-label="Signature HTML editor"
        className="mail-html-signature-editor__surface"
        contentEditable
        data-placeholder={placeholder}
        onBlur={emitChange}
        onInput={emitChange}
        onPaste={handlePaste}
        role="textbox"
        spellCheck
        style={{ minHeight }}
        suppressContentEditableWarning
      />
    </div>
  );
}
