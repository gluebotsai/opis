import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, Zap } from "lucide-react";
import { useEmbedPageReady } from "@/hooks/useEmbedPageReady";
import { launchOnDemandApi } from "@/services/on-demand.service";

function extractEmails(text: string): string[] {
  const matches = text.match(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  );
  return matches ? [...new Set(matches.map((e) => e.toLowerCase()))] : [];
}

function extractCustomerIds(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(
    /(?:customer|cdp|contact)\s*(?:id|ids)?\s*(?:is|=|:|-)?\s*([A-Za-z0-9._:-]{8,64})/gi,
  )) {
    const id = String(m[1] || "").trim();
    if (id && !id.includes("@")) out.add(id);
  }
  for (const m of text.matchAll(/\b(\d{10,22})\b/g)) out.add(m[1]);
  for (const m of text.matchAll(/\b(CDP-[A-Za-z0-9._:-]{4,160})\b/gi)) {
    out.add(m[1]);
  }
  return [...out];
}

/**
 * On-demand send agent chat — launches via API (all Phase-1 channels).
 */
export function OnDemandSendChatPage() {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEmbedPageReady(true);
  const [messages, setMessages] = useState<
    Array<{ id: string; role: "user" | "assistant"; text: string }>
  >([
    {
      id: "welcome",
      role: "assistant",
      text:
        "I’m the On-demand send agent. Tell me who to reach (email, phone, or customer id) and why — " +
        "I’ll analyse the request, write channel templates, then launch " +
        "email, push, web, and WhatsApp through Phase 1 workers.",
    },
  ]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy || done) return;

    setInput("");
    setBusy(true);
    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: "user", text },
    ]);

    try {
      const emails = extractEmails(text);
      const customerIds = extractCustomerIds(text);
      const { run, warnings } = await launchOnDemandApi({
        request_text: text,
        emails: emails.length ? emails : undefined,
        customer_ids: customerIds.length ? customerIds : undefined,
        channels: ["email", "push", "web", "whatsapp"],
        source: "agent",
      });
      setDone(true);
      const warn =
        warnings.length > 0
          ? `\nNote: ${warnings.slice(0, 2).join(" · ")}`
          : "";
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: `Accepted. Campaign ${run.id} queued for ${run.audienceHint || `${run.audienceCount} contacts`} across ${(run.channels || []).join(", ") || "channels"}. Opening On-demand…${warn}`,
        },
      ]);
      window.setTimeout(() => {
        navigate(`/campaigns?tab=on-demand&id=${encodeURIComponent(run.id)}`);
      }, 900);
    } catch (err) {
      setDone(false);
      const msg =
        err instanceof Error ? err.message : "API launch failed";
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          text:
            `Could not launch (${msg}). ` +
            "Creation-agent templates are required — keep agents running on :8005, " +
            "ensure the contact exists in CDP (email, phone, or customer id), then try again.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#f3f4f6]">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col px-4 py-4 sm:px-6">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <Link
            to="/campaigns/create"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-600 hover:text-neutral-900"
          >
            <ArrowLeft className="size-4" strokeWidth={1.75} />
            Create campaign
          </Link>
          <Link
            to="/campaigns?tab=on-demand"
            className="text-xs font-medium text-neutral-500 underline hover:text-neutral-800"
          >
            View On-demand monitor
          </Link>
        </div>

        <div className="mt-4 flex items-start gap-3">
          <span className="inline-flex size-10 items-center justify-center rounded-xl bg-neutral-900 text-white">
            <Zap className="size-5" strokeWidth={1.75} />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-neutral-900">
              On-demand send
            </h1>
            <p className="mt-1 text-sm text-neutral-500">
              Links email, app push, web push, and WhatsApp through Phase 1
              workers. Contact must exist in this organization.
            </p>
          </div>
        </div>

        {done ? (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900">
            <CheckCircle2 className="size-4 shrink-0" strokeWidth={2} />
            Send accepted. Redirecting…
          </div>
        ) : null}

        <div className="chat-scroll-xs mt-5 min-h-0 flex-1 space-y-2.5 overflow-y-auto rounded-2xl border border-neutral-200 bg-white px-3.5 py-3 shadow-sm">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`text-sm leading-relaxed ${
                m.role === "user" ? "text-right" : "text-left"
              }`}
            >
              <span
                className={`inline-block max-w-[92%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-left ${
                  m.role === "user"
                    ? "bg-neutral-900 text-white"
                    : "bg-neutral-100 text-neutral-700"
                }`}
              >
                {m.text}
              </span>
            </div>
          ))}
          {busy ? (
            <p className="inline-flex items-center gap-1.5 text-sm text-neutral-400">
              <Loader2 className="size-3.5 animate-spin" />
              Analyzing request & creating templates, then launching…
            </p>
          ) : null}
        </div>

        <form className="mt-3 shrink-0 pb-2" onSubmit={handleSubmit}>
          <div className="rounded-2xl bg-white px-4 pt-3 pb-3 shadow-xl">
            <textarea
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={busy || done}
              placeholder="e.g. Email aravindh@… a short note. Send now."
              className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-neutral-900 outline-none placeholder:text-neutral-400 disabled:opacity-60"
            />
            <div className="mt-2 flex justify-end border-t border-neutral-100 pt-2">
              <button
                type="submit"
                disabled={!input.trim() || busy || done}
                className="inline-flex size-9 items-center justify-center rounded-md bg-neutral-900 text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
                aria-label="Send"
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" strokeWidth={2} />
                ) : (
                  <ArrowRight className="size-4" strokeWidth={2} />
                )}
              </button>
            </div>
          </div>
          <p className="mt-2 text-center text-[11px] text-neutral-400">
            Creates a real campaign tagged on_demand — not shown under Live /
            Scheduled / Past.
          </p>
        </form>
      </div>
    </div>
  );
}
