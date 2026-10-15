import { useEffect, useRef, useState } from "react";
import {
  prepareActivityEmailPreview,
  prepareEmailBodyForDisplay,
  wrapEmailHtmlForDisplay,
} from "@/lib/email-body";
import { RichStructuredContent } from "@/components/content/RichStructuredContent";

function PlainEmailContent({ text }: { text: string }) {
  if (!text.trim()) {
    return (
      <p className="text-sm text-text-caption">
        No message body was logged for this activity.
      </p>
    );
  }

  return <RichStructuredContent text={text} variant="compact" />;
}

export function HtmlEmailFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;

    const resize = () => {
      try {
        const doc = frame.contentDocument;
        if (!doc?.body) return;
        const height = Math.max(
          doc.body.scrollHeight,
          doc.documentElement?.scrollHeight ?? 0,
          120,
        );
        frame.style.height = `${height}px`;
      } catch {
        // sandboxed doc may be unavailable briefly
      }
    };

    let observer: ResizeObserver | undefined;
    const watch = () => {
      resize();
      const doc = frame.contentDocument;
      if (!doc?.body || typeof ResizeObserver === "undefined") return;
      observer?.disconnect();
      observer = new ResizeObserver(() => resize());
      observer.observe(doc.body);
      if (doc.documentElement) observer.observe(doc.documentElement);
    };

    frame.addEventListener("load", watch);
    const id = window.setTimeout(watch, 80);
    return () => {
      frame.removeEventListener("load", watch);
      window.clearTimeout(id);
      observer?.disconnect();
    };
  }, [html]);

  return (
    <iframe
      ref={ref}
      sandbox="allow-same-origin"
      referrerPolicy="no-referrer"
      title="Email message"
      srcDoc={wrapEmailHtmlForDisplay(html)}
      className="mt-1 w-full min-h-[120px] rounded-lg border border-border-default bg-white"
    />
  );
}

function ActivityPlainBlock({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  return (
    <p
      className={`whitespace-pre-wrap break-words text-[13px] leading-6 text-text-primary ${className}`.trim()}
    >
      {text}
    </p>
  );
}

/** Compact timeline card: latest reply + optional collapsed thread. */
function ActivityEmailPreview({
  text,
  subject,
}: {
  text: string;
  subject?: string;
}) {
  const [showQuoted, setShowQuoted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { main, quoted } = prepareActivityEmailPreview(text, subject);
  const longMain = main.length > 280 || main.split("\n").length > 5;
  const shownMain =
    !expanded && longMain
      ? `${main.split("\n").slice(0, 4).join("\n").slice(0, 280).trimEnd()}…`
      : main;

  return (
    <div className="mt-1.5 w-full min-w-0 rounded-lg border border-border-default/70 bg-subtle/50 px-3.5 py-3">
      <ActivityPlainBlock text={shownMain} />
      {longMain ? (
        <button
          type="button"
          className="mt-1.5 text-xs font-medium text-text-link hover:underline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
      {quoted ? (
        <div className="mt-2.5 border-t border-border-default/60 pt-2">
          <button
            type="button"
            className="text-xs font-medium text-text-secondary hover:text-text-link hover:underline"
            onClick={() => setShowQuoted((v) => !v)}
          >
            {showQuoted ? "Hide earlier messages" : "Show earlier messages"}
          </button>
          {showQuoted ? (
            <ActivityPlainBlock
              text={quoted}
              className="mt-2 max-h-40 overflow-y-auto text-text-caption"
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function EmailBodyContent({
  text,
  subject,
  variant = "full",
}: {
  text: string;
  subject?: string;
  /** Activity feeds: latest reply only, no nested HTML thread. */
  variant?: "full" | "activity";
}) {
  if (variant === "activity") {
    return <ActivityEmailPreview text={text} subject={subject} />;
  }

  const prepared = prepareEmailBodyForDisplay(text, subject);
  if (prepared.mode === "html") {
    return <HtmlEmailFrame html={prepared.content} />;
  }

  return <PlainEmailContent text={prepared.content} />;
}
