// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef } from "react";

function wrapHtmlDocument(html = "") {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <base target="_blank" />
    <style>
      html,
      body {
        width: 100% !important;
        min-height: 100%;
        margin: 0;
        padding: 0;
      }
      body {
        color: #1a1a1a;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 14px;
        line-height: 1.6;
        word-wrap: break-word;
        overflow-wrap: anywhere;
      }
      body > table,
      body table[width] {
        width: 100% !important;
        max-width: none !important;
      }
      table[width="600"],
      td[width="600"],
      .wrapper,
      .container {
        width: 100% !important;
        max-width: none !important;
      }
      center {
        display: block;
        width: 100% !important;
        text-align: left;
      }
      img {
        max-width: 100% !important;
        height: auto !important;
      }
      pre,
      code {
        white-space: pre-wrap;
        word-break: break-word;
      }
      table {
        max-width: 100%;
      }
    </style>
  </head>
  <body>${html}</body>
</html>`;
}

export function MailMessageBody({
  htmlBody = "",
  textBody = "",
  /** Floor for iframe height sync (read pane default 200). Compose signature uses a smaller floor. */
  minHeight = 200,
  /** Optional cap so tall signatures don’t inflate the host layout (scroll inside parent). */
  maxHeight = null,
}) {
  const iframeRef = useRef(null);
  const wrapRef = useRef(null);
  const floor = Math.max(0, Number(minHeight) || 0);

  const srcDoc = useMemo(() => {
    if (!htmlBody?.trim()) {
      return "";
    }

    return wrapHtmlDocument(htmlBody);
  }, [htmlBody]);

  const syncIframeHeight = useCallback(() => {
    const iframe = iframeRef.current;
    const wrap = wrapRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !wrap) {
      return;
    }

    const wrapperHeight = Math.max(wrap.clientHeight, floor);
    const contentHeight = doc?.body ? doc.body.scrollHeight : wrapperHeight;
    let next = Math.max(wrapperHeight, contentHeight);
    const cap = Number(maxHeight);
    if (Number.isFinite(cap) && cap > 0) {
      next = Math.min(next, cap);
    }
    iframe.style.height = `${next}px`;
  }, [floor, maxHeight]);

  useEffect(() => {
    if (!srcDoc) {
      return undefined;
    }

    const wrap = wrapRef.current;
    if (!wrap) {
      return undefined;
    }

    syncIframeHeight();

    const observer = new ResizeObserver(() => {
      syncIframeHeight();
    });

    observer.observe(wrap);
    return () => observer.disconnect();
  }, [srcDoc, syncIframeHeight]);

  if (srcDoc) {
    return (
      <div ref={wrapRef} className="mail-read-pane__html-wrap">
        <iframe
          ref={iframeRef}
          className="mail-read-pane__html"
          onLoad={syncIframeHeight}
          sandbox="allow-same-origin"
          srcDoc={srcDoc}
          title="Email body"
        />
      </div>
    );
  }

  const lines = String(textBody || "").split("\n");
  if (!lines.length || (lines.length === 1 && !lines[0])) {
    return <p className="mail-read-pane__empty-body">No message content.</p>;
  }

  return lines.map((line, index) => (
    <p key={`${index}-${line.slice(0, 12)}`}>{line || "\u00A0"}</p>
  ));
}

export function hasHtmlMailBody(htmlBody = "") {
  return Boolean(String(htmlBody || "").trim());
}
