import { FileSpreadsheet, FileText } from "lucide-react";
import type { RefObject } from "react";
import type { CoworkerAttachment, CoworkerEmailDraft, CoworkerMessage } from "./types";
import { emailAddresses } from "@/lib/coworker/email-addresses";
import { RichStructuredContent } from "@/components/content/RichStructuredContent";
import { AnalyticsVisual } from "@/components/analytics/AnalyticsVisual";
import { OntologyProgressTrail } from "@/components/analytics/OntologyProgressTrail";
import type { OntologyProgressStep } from "@/services/agent-stream";
import { companionTextForAnalytics } from "@/lib/coworker/analytics-companion-text";
import { reportsCardFollowUp } from "@/lib/coworker/reports-follow-up";
import {
  decorateAssistantMessageHtml,
  isCoworkerChatHtml,
  plainSpeechToChatHtml,
} from "@/lib/coworker/assistant-message-html";
import "@/styles/assistant-message-html.css";

function formatBytes(size: number): string {
  if (size < 1024) return `${size} bytes`;
  if (size < 1024 * 1024) {
    const kb = size / 1024;
    return kb < 10 ? `${kb.toFixed(1)} KB` : `${Math.round(kb)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function splitContactCsv(text: string): { intro: string; csv: string } | null {
  const lines = text.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const header = lines[i].toLowerCase();
    if (
      header.includes(",") &&
      header.includes("email") &&
      (header.includes("first_name") ||
        header.includes("firstname") ||
        header.includes("last_name") ||
        /(^|,)\s*name\s*(,|$)/.test(header))
    ) {
      start = i;
      break;
    }
  }
  if (start < 0 || start >= lines.length - 1) return null;
  const csv = lines.slice(start).join("\n").trim();
  if (!csv.includes("\n")) return null;
  return { intro: lines.slice(0, start).join("\n").trim(), csv };
}

function csvCardFromText(text: string): CoworkerAttachment | null {
  const block = splitContactCsv(text);
  if (!block) return null;
  const named = block.intro.match(/Import attached CSV \(([^)]+)\)/i);
  const name = named?.[1]?.trim() || "contacts.csv";
  return { name, size: new Blob([block.csv]).size, kind: "csv" };
}

function AttachmentCard({
  attachment,
  align,
}: {
  attachment: CoworkerAttachment;
  align: "start" | "end";
}) {
  const csv = attachment.kind === "csv";
  return (
    <div
      className={`flex max-w-[90%] items-center gap-2.5 rounded-2xl border border-neutral-200 bg-white px-3 py-2 ${
        align === "end" ? "shadow-sm" : ""
      }`}
    >
      <span
        className={`inline-flex size-9 shrink-0 items-center justify-center rounded-lg ${
          csv ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"
        }`}
      >
        {csv ? (
          <FileSpreadsheet className="size-5" strokeWidth={1.75} />
        ) : (
          <FileText className="size-5" strokeWidth={1.75} />
        )}
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-neutral-900">
          {attachment.name}
        </p>
        <p className="text-xs text-neutral-500">{formatBytes(attachment.size)}</p>
      </div>
    </div>
  );
}

function ontologyProgress(msg: CoworkerMessage): OntologyProgressStep[] {
  const raw = msg.analytics?.audit?.progress;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (step): step is OntologyProgressStep =>
      Boolean(step) &&
      typeof step === "object" &&
      typeof (step as OntologyProgressStep).label === "string",
  );
}

function AssistantBody({ text }: { text: string }) {
  const html = plainSpeechToChatHtml(text);
  if (isCoworkerChatHtml(html)) {
    return (
      <div
        className="assistant-message-html"
        dangerouslySetInnerHTML={{ __html: decorateAssistantMessageHtml(html) }}
      />
    );
  }
  return <RichStructuredContent text={text} variant="chat" />;
}

function AssistantText({ text }: { text: string }) {
  const csvBlock = splitContactCsv(text);
  if (csvBlock) {
    return (
      <div className="max-w-[90%] min-w-0 text-[14px] leading-relaxed text-neutral-800">
        {csvBlock.intro ? <AssistantBody text={csvBlock.intro} /> : null}
        <pre
          className={`max-h-48 overflow-auto whitespace-pre rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-[11px] leading-4 text-neutral-800 ${
            csvBlock.intro ? "mt-1.5" : ""
          }`}
        >
          {csvBlock.csv}
        </pre>
      </div>
    );
  }
  return (
    <div className="max-w-[90%] min-w-0 text-[14px] leading-relaxed text-neutral-800">
      <AssistantBody text={text} />
    </div>
  );
}

function EmailDraftCard({
  draft,
  busy,
  onSendNow,
}: {
  draft: CoworkerEmailDraft;
  busy?: boolean;
  onSendNow?: () => void;
}) {
  const sent = draft.status === "sent";
  return (
    <div className="w-full max-w-[90%] rounded-2xl border border-neutral-200 bg-white px-3.5 py-3 text-[14px] text-neutral-800">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
        {sent ? "Sent" : draft.status === "scheduled" ? "Scheduled draft" : "Draft"}
      </p>
      <div className="mt-1 text-sm text-neutral-600">
        <p>To</p>
        <ul className="mt-0.5 space-y-0.5">
          {emailAddresses(draft.to).map((email) => (
              <li key={email}>{email}</li>
            ))}
        </ul>
      </div>
      <p className="mt-1 font-medium text-neutral-900">{draft.subject}</p>
      <div className="mt-2 max-h-64 space-y-2 overflow-auto text-[13px] leading-relaxed text-neutral-800">
        {draft.body
          .split(/\n{2,}/)
          .map((paragraph) => paragraph.trim())
          .filter(Boolean)
          .map((paragraph, index) => (
            <p key={index} className="whitespace-pre-wrap">
              {paragraph}
            </p>
          ))}
      </div>
      {draft.sendAt && !sent ? (
        <p className="mt-2 text-xs text-neutral-500">Sends {draft.sendAt}</p>
      ) : null}
      {draft.error ? (
        <p className="mt-2 text-xs text-red-600">{draft.error}</p>
      ) : null}
      {!sent && onSendNow ? (
        <button
          type="button"
          disabled={busy}
          onClick={onSendNow}
          className="mt-3 rounded-full bg-[#111111] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {busy ? "Sending…" : "Send now"}
        </button>
      ) : null}
    </div>
  );
}

export function CoworkerMessageList({
  messages,
  bottomRef,
  onSendEmailNow,
  sendingEmailId,
}: {
  messages: CoworkerMessage[];
  bottomRef?: RefObject<HTMLDivElement | null>;
  onSendEmailNow?: (messageId: string) => void;
  sendingEmailId?: string | null;
}) {
  return (
    <div className="flex flex-col gap-3 px-4 py-4 sm:px-5">
      {messages.map((msg) => {
        const hasAnalytics = msg.role === "assistant" && Boolean(msg.analytics);
        const progress = msg.role === "assistant" ? ontologyProgress(msg) : [];
        const isOntology =
          String(msg.analytics?.audit?.source || "") === "ontology_layer";

        if (hasAnalytics) {
          const companionText = companionTextForAnalytics(
            msg.text,
            msg.analytics,
          );
          const showCard = Boolean(
            (msg.analytics?.visual || (msg.analytics?.visuals?.length ?? 0) > 0) &&
              (!isOntology || (msg.analytics?.visual?.kpis?.length ?? 0) > 0),
          );
          const parts = reportsCardFollowUp(
            companionText,
            msg.analytics,
            showCard,
          );
          return (
            <div
              key={msg.id}
              data-message-id={msg.id}
              className="flex w-full flex-col items-start gap-2.5"
            >
              {progress.length ? <OntologyProgressTrail steps={progress} /> : null}
              {parts.body.trim() ? <AssistantText text={parts.body} /> : null}
              {showCard ? (
                <div className="w-full min-w-0 max-w-full">
                  <AnalyticsVisual analytics={msg.analytics!} presentation="chat" />
                </div>
              ) : null}
              {parts.followUp.trim() ? (
                <AssistantText text={parts.followUp} />
              ) : null}
            </div>
          );
        }

        if (msg.role === "user" && msg.hidden && !msg.attachment) {
          return null;
        }

        if (msg.role === "assistant") {
          return (
            <div
              key={msg.id}
              data-message-id={msg.id}
              className="flex flex-col items-start gap-2"
            >
              {msg.attachment ? (
                <AttachmentCard attachment={msg.attachment} align="start" />
              ) : null}
              {msg.text.trim() ? <AssistantText text={msg.text} /> : null}
              {msg.emailDraft ? (
                <EmailDraftCard
                  draft={msg.emailDraft}
                  busy={sendingEmailId === msg.id}
                  onSendNow={
                    onSendEmailNow ? () => onSendEmailNow(msg.id) : undefined
                  }
                />
              ) : null}
            </div>
          );
        }

        const pastedCsv = msg.attachment ? null : csvCardFromText(msg.text);
        return (
          <div
            key={msg.id}
            data-message-id={msg.id}
            className="flex flex-col items-end gap-2"
          >
            {msg.attachment ? (
              <AttachmentCard attachment={msg.attachment} align="end" />
            ) : pastedCsv ? (
              <AttachmentCard attachment={pastedCsv} align="end" />
            ) : null}
            {msg.text.trim() && !pastedCsv ? (
              <div className="flex w-full justify-end">
                <div className="max-w-[90%] rounded-2xl rounded-tr-sm bg-[#111111] px-3.5 py-2.5 text-[14px] leading-relaxed text-white">
                  <p className="whitespace-pre-wrap">{msg.text}</p>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
