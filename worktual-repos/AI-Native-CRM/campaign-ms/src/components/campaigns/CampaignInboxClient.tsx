"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  ChevronDown,
  ExternalLink,
  FileText,
  Filter,
  Inbox as InboxIcon,
  MailOpen,
  Search,
  Send,
  SendHorizontal,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  CAMPAIGN_CHANNELS,
  channelLabel,
  type CampaignChannelId,
} from "@/lib/campaign-channels";
import {
  formatInboxTime,
  listCampaignInboxThreads,
  saveCampaignInboxThreads,
  threadHasDraft,
  threadHasSent,
  type CampaignInboxHandler,
  type CampaignInboxMessage,
  type CampaignInboxThread,
} from "@/lib/campaign-inbox";

type HandlerFilter = "all" | CampaignInboxHandler;
type ChannelFilter = "all" | CampaignChannelId;
type MailFolder = "inbox" | "drafts" | "sent";

const AI_SUGGESTIONS = [
  {
    id: "polite",
    label: "Polite reply",
    build: (t: CampaignInboxThread) =>
      `Hi ${t.contactName.split(" ")[0]}, thanks for writing in about “${t.campaignName}”. Happy to help — could you share a bit more detail so I can assist quickly?`,
  },
  {
    id: "short",
    label: "Short & clear",
    build: (t: CampaignInboxThread) =>
      `Hi ${t.contactName.split(" ")[0]}, thanks for your message. We’ll check this and get back to you shortly.`,
  },
  {
    id: "clarify",
    label: "Ask for details",
    build: () =>
      `Thanks for reaching out. To help you faster, could you share your order ID or registered phone/email?`,
  },
  {
    id: "offer",
    label: "Offer help",
    build: (t: CampaignInboxThread) =>
      `Hi ${t.contactName.split(" ")[0]}, I can help with your question on “${t.campaignName}”. What would you like me to do next?`,
  },
];

export function CampaignInboxClient({
  monitoringHref = "/marketing/campaigns",
}: {
  /** Campaign monitoring list (standalone Campaign uses /campaigns) */
  monitoringHref?: string;
}) {
  const [threads, setThreads] = useState<CampaignInboxThread[]>(() =>
    listCampaignInboxThreads(),
  );
  const [folder, setFolder] = useState<MailFolder>("inbox");
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [handlerFilter, setHandlerFilter] =
    useState<HandlerFilter>("human_needed");
  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const threadEndRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const selectedIdRef = useRef<string | null>(null);
  const replyRef = useRef("");

  selectedIdRef.current = selectedId;
  replyRef.current = reply;

  const persist = (next: CampaignInboxThread[]) => {
    setThreads(next);
    saveCampaignInboxThreads(next);
  };

  const applyDraftToList = (
    list: CampaignInboxThread[],
    threadId: string,
    body: string,
  ): CampaignInboxThread[] => {
    const trimmed = body.trim();
    return list.map((t) => {
      if (t.id !== threadId) return t;
      if (!trimmed) return { ...t, draftReply: "" };
      return {
        ...t,
        draftReply: body,
        updatedAt: new Date().toISOString(),
        preview: `Draft: ${trimmed.slice(0, 80)}`,
      };
    });
  };

  const selectThread = (id: string | null) => {
    setThreads((current) => {
      let next = current;
      if (selectedId && selectedId !== id) {
        next = applyDraftToList(current, selectedId, reply);
      }
      if (id) {
        next = next.map((t) =>
          t.id === id && t.unread ? { ...t, unread: false } : t,
        );
      }
      saveCampaignInboxThreads(next);
      const target = id ? next.find((x) => x.id === id) : null;
      setReply(target?.draftReply ?? "");
      return next;
    });
    setSelectedId(id);
  };

  const setUnread = (id: string, unread: boolean) => {
    persist(
      threads.map((t) => (t.id === id ? { ...t, unread } : t)),
    );
  };

  const applySuggestion = (build: (t: CampaignInboxThread) => string) => {
    if (!selected) return;
    setReply(build(selected));
  };

  const switchFolder = (nextFolder: MailFolder) => {
    setThreads((current) => {
      if (!selectedId) return current;
      const next = applyDraftToList(current, selectedId, reply);
      saveCampaignInboxThreads(next);
      return next;
    });
    setFolder(nextFolder);
    setSelectedId(null);
    setReply("");
  };

  useEffect(() => {
    return () => {
      // Persist draft if user navigates away mid-compose
      const id = selectedIdRef.current;
      const body = replyRef.current;
      if (!id || !body.trim()) return;
      const current = listCampaignInboxThreads();
      saveCampaignInboxThreads(
        current.map((t) =>
          t.id === id
            ? {
                ...t,
                draftReply: body,
                updatedAt: new Date().toISOString(),
                preview: `Draft: ${body.trim().slice(0, 80)}`,
              }
            : t,
        ),
      );
    };
  }, []);

  const inboxCount = threads.length;
  const draftCount = threads.filter(threadHasDraft).length;
  const sentCount = threads.filter(threadHasSent).length;
  const unreadCount = threads.filter((t) => t.unread).length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return threads.filter((t) => {
      if (folder === "drafts" && !threadHasDraft(t)) return false;
      if (folder === "sent" && !threadHasSent(t)) return false;
      if (folder === "inbox") {
        if (channelFilter !== "all" && t.channel !== channelFilter) return false;
        if (handlerFilter !== "all" && t.handler !== handlerFilter) return false;
      }
      if (!q) return true;
      return (
        t.campaignName.toLowerCase().includes(q) ||
        t.contactName.toLowerCase().includes(q) ||
        t.contactHandle.toLowerCase().includes(q) ||
        t.preview.toLowerCase().includes(q) ||
        t.draftReply.toLowerCase().includes(q) ||
        channelLabel(t.channel).toLowerCase().includes(q)
      );
    });
  }, [threads, folder, channelFilter, handlerFilter, search]);

  // Outlook: do not auto-open mail — only clear selection if it left the list
  useEffect(() => {
    if (selectedId && !filtered.some((t) => t.id === selectedId)) {
      setSelectedId(null);
      setReply("");
    }
  }, [filtered, selectedId]);

  const selected = filtered.find((t) => t.id === selectedId) ?? null;

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selected?.id, selected?.messages.length]);

  useEffect(() => {
    if (!filterOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [filterOpen]);

  const sendReply = () => {
    const text = reply.trim();
    if (!text || !selected) return;
    const now = new Date().toISOString();
    const msg: CampaignInboxMessage = {
      id: crypto.randomUUID(),
      role: "agent",
      text,
      createdAt: now,
    };
    persist(
      threads.map((t) =>
        t.id === selected.id
          ? {
              ...t,
              draftReply: "",
              updatedAt: now,
              preview: text,
              messages: [...t.messages, msg],
            }
          : t,
      ),
    );
    setReply("");
  };

  const humanCount = threads.filter((t) => t.handler === "human_needed").length;
  const botCount = threads.filter((t) => t.handler === "bot_replied").length;

  const activeFilterCount =
    (channelFilter !== "all" ? 1 : 0) + (handlerFilter !== "all" ? 1 : 0);

  const clearFilters = () => {
    setChannelFilter("all");
    setHandlerFilter("all");
    setSearch("");
  };

  const emptyCopy =
    folder === "drafts"
      ? {
          title: "No drafts",
          hint: "Start a reply and leave — it will be saved here.",
        }
      : folder === "sent"
        ? {
            title: "No sent items",
            hint: "Replies you send will appear here.",
          }
        : {
            title: "Your inbox is empty",
            hint: "Replies that need attention will show up here.",
          };

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col">
      <div className="relative z-40 overflow-visible border-b border-border-default bg-surface px-4 py-3 sm:px-6">
        {/* Outlook-style folders */}
        <div className="mb-3 flex flex-wrap gap-1 border-b border-border-default pb-2">
          <FolderTab
            active={folder === "inbox"}
            icon={InboxIcon}
            label="Inbox"
            count={inboxCount}
            badge={unreadCount > 0 ? unreadCount : undefined}
            onClick={() => switchFolder("inbox")}
          />
          <FolderTab
            active={folder === "drafts"}
            icon={FileText}
            label="Drafts"
            count={draftCount}
            onClick={() => switchFolder("drafts")}
          />
          <FolderTab
            active={folder === "sent"}
            icon={SendHorizontal}
            label="Sent"
            count={sentCount}
            onClick={() => switchFolder("sent")}
          />
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-caption"
              strokeWidth={1.75}
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search mail"
              className="w-full rounded-lg border border-border-default bg-subtle py-2.5 pr-9 pl-10 text-sm text-text-primary placeholder:text-text-placeholder focus:border-border-focus focus:bg-surface focus:outline-none focus:ring-2 focus:ring-border-focus/20"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute top-1/2 right-2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-text-caption hover:bg-surface hover:text-text-primary"
                aria-label="Clear search"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>

          {folder === "inbox" ? (
            <div className="relative shrink-0" ref={filterRef}>
              <button
                type="button"
                onClick={() => setFilterOpen((v) => !v)}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-border-default bg-surface px-3 text-sm font-medium text-text-primary hover:bg-subtle"
                aria-expanded={filterOpen}
              >
                <Filter
                  className="size-4 text-text-caption"
                  strokeWidth={1.75}
                />
                Filter
                {activeFilterCount > 0 ? (
                  <span className="rounded-full bg-brand px-1.5 py-0.5 text-[10px] text-text-on-dark">
                    {activeFilterCount}
                  </span>
                ) : null}
                <ChevronDown
                  className="size-4 text-text-caption"
                  strokeWidth={1.75}
                />
              </button>

              {filterOpen ? (
                <div className="absolute top-full right-0 left-auto z-50 mt-1.5 w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border-default bg-surface shadow-lg">
                  <div className="border-b border-border-default px-3 py-2">
                    <p className="text-xs font-medium tracking-wide text-text-caption uppercase">
                      Channels
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <FilterOption
                        active={channelFilter === "all"}
                        label="All"
                        onClick={() => setChannelFilter("all")}
                      />
                      {CAMPAIGN_CHANNELS.map((c) => (
                        <FilterOption
                          key={c.id}
                          active={channelFilter === c.id}
                          label={c.label}
                          onClick={() => setChannelFilter(c.id)}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="px-3 py-2">
                    <p className="text-xs font-medium tracking-wide text-text-caption uppercase">
                      Status
                    </p>
                    <div className="mt-2 flex flex-col gap-1">
                      <FilterOption
                        active={handlerFilter === "human_needed"}
                        label={`Human reply needed (${humanCount})`}
                        onClick={() => setHandlerFilter("human_needed")}
                        block
                      />
                      <FilterOption
                        active={handlerFilter === "bot_replied"}
                        label={`Bot replied (${botCount})`}
                        onClick={() => setHandlerFilter("bot_replied")}
                        block
                      />
                      <FilterOption
                        active={handlerFilter === "all"}
                        label="All statuses"
                        onClick={() => setHandlerFilter("all")}
                        block
                      />
                    </div>
                  </div>
                  <div className="flex justify-between border-t border-border-default px-3 py-2">
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="text-xs text-text-link hover:underline"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilterOpen(false)}
                      className="text-xs font-medium text-text-primary hover:underline"
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {folder === "inbox" &&
        (channelFilter !== "all" || handlerFilter !== "all") ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {channelFilter !== "all" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-medium text-violet-700">
                {channelLabel(channelFilter)}
                <button
                  type="button"
                  onClick={() => setChannelFilter("all")}
                  className="rounded-full hover:bg-violet-200"
                  aria-label="Clear channel filter"
                >
                  <X className="size-3" />
                </button>
              </span>
            ) : null}
            {handlerFilter === "human_needed" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-medium text-amber-800">
                Human reply needed
                <button
                  type="button"
                  onClick={() => setHandlerFilter("all")}
                  className="rounded-full hover:bg-amber-200"
                  aria-label="Clear status filter"
                >
                  <X className="size-3" />
                </button>
              </span>
            ) : null}
            {handlerFilter === "bot_replied" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-medium text-sky-800">
                Bot replied
                <button
                  type="button"
                  onClick={() => setHandlerFilter("all")}
                  className="rounded-full hover:bg-sky-200"
                  aria-label="Clear status filter"
                >
                  <X className="size-3" />
                </button>
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="flex max-h-[40vh] w-full flex-col border-b border-border-default bg-surface md:max-h-none md:w-[380px] md:shrink-0 md:border-b-0 md:border-r">
          <div className="border-b border-border-default px-4 py-2 text-xs text-text-caption">
            {filtered.length} item{filtered.length === 1 ? "" : "s"}
          </div>
          {filtered.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
              <InboxIcon
                className="size-8 text-text-caption"
                strokeWidth={1.5}
              />
              <p className="mt-3 text-sm font-medium text-text-primary">
                {emptyCopy.title}
              </p>
              <p className="mt-1 text-xs text-text-caption">{emptyCopy.hint}</p>
            </div>
          ) : (
            <ul className="flex-1 overflow-y-auto divide-y divide-border-default">
              {filtered.map((t) => {
                const active = t.id === selectedId;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => selectThread(t.id)}
                      className={`relative w-full px-4 py-3 text-left transition-colors ${
                        active
                          ? "bg-violet-50"
                          : t.unread
                            ? "bg-white hover:bg-violet-50/60"
                            : "hover:bg-subtle"
                      }`}
                    >
                      {t.unread ? (
                        <span className="absolute top-3 bottom-3 left-0 w-1 rounded-r bg-brand" />
                      ) : null}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                          {channelLabel(t.channel)}
                        </span>
                        {t.unread ? (
                          <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">
                            Unread
                          </span>
                        ) : null}
                        {folder === "drafts" || threadHasDraft(t) ? (
                          <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[10px] font-medium text-neutral-700">
                            Draft
                          </span>
                        ) : null}
                        {folder === "inbox" ? (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              t.handler === "human_needed"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-sky-100 text-sky-800"
                            }`}
                          >
                            {t.handler === "human_needed"
                              ? "Human reply needed"
                              : "Bot replied"}
                          </span>
                        ) : null}
                        <span className="ml-auto text-[11px] text-text-caption">
                          {formatInboxTime(t.updatedAt)}
                        </span>
                      </div>
                      <p
                        className={`mt-1.5 truncate text-sm ${
                          t.unread
                            ? "font-semibold text-text-primary"
                            : "font-medium text-text-primary"
                        }`}
                      >
                        {t.campaignName}
                      </p>
                      <p
                        className={`mt-0.5 truncate text-xs ${
                          t.unread
                            ? "font-medium text-text-secondary"
                            : "text-text-caption"
                        }`}
                      >
                        {t.contactName} ·{" "}
                        {folder === "drafts" && t.draftReply
                          ? t.draftReply
                          : t.preview}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-subtle">
          {!selected ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
              <p className="text-sm font-medium text-text-primary">
                Select an item to read
              </p>
              <p className="mt-1 text-sm text-text-caption">
                Nothing is open — click a message on the left.
              </p>
            </div>
          ) : (
            <>
              <header className="border-b border-border-default bg-surface px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-text-primary">
                        {selected.contactName}
                      </h2>
                      <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                        {channelLabel(selected.channel)}
                      </span>
                      {threadHasDraft(selected) ? (
                        <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[10px] font-medium text-neutral-700">
                          Draft
                        </span>
                      ) : null}
                      {selected.unread ? (
                        <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">
                          Unread
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-sm text-text-caption">
                      {selected.campaignName} · {selected.contactHandle} ·{" "}
                      {formatInboxTime(selected.updatedAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        setUnread(selected.id, !selected.unread)
                      }
                    >
                      <MailOpen className="size-3.5" strokeWidth={1.75} />
                      {selected.unread ? "Mark read" : "Mark unread"}
                    </Button>
                    <Link
                      href={monitoringHref}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-default bg-surface px-3 text-sm font-medium text-text-primary hover:bg-subtle"
                    >
                      <ExternalLink className="size-3.5" strokeWidth={1.75} />
                      Open campaign
                    </Link>
                  </div>
                </div>
              </header>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-5">
                {selected.messages.map((msg) => (
                  <ThreadBubble key={msg.id} message={msg} />
                ))}
                <div ref={threadEndRef} />
              </div>

              <div className="border-t border-border-default bg-surface px-3 pt-3 sm:px-5">
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-text-caption">
                    <Sparkles className="size-3.5 text-brand" strokeWidth={1.75} />
                    AI suggestions
                  </span>
                  {AI_SUGGESTIONS.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => applySuggestion(s.build)}
                      className="rounded-full border border-border-default bg-subtle px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:border-brand hover:bg-violet-50 hover:text-brand"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sendReply();
                }}
                className="border-t border-border-default bg-surface px-3 py-3 sm:px-5"
              >
                <p className="mb-2 text-[11px] text-text-caption">
                  Reply on {channelLabel(selected.channel)} ·{" "}
                  {selected.campaignName}
                  {reply.trim()
                    ? " · Leaving saves a draft in Drafts"
                    : null}
                </p>
                <div className="flex items-end gap-2">
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    rows={2}
                    placeholder={`Reply via ${channelLabel(selected.channel)}…`}
                    className="min-h-[44px] flex-1 resize-none rounded-lg border border-border-default bg-surface px-3 py-2.5 text-sm text-text-primary placeholder:text-text-placeholder focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-border-focus/20"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendReply();
                      }
                    }}
                  />
                  <Button
                    type="submit"
                    variant="brand"
                    disabled={!reply.trim()}
                    className="h-11 shrink-0"
                  >
                    <Send className="size-4" strokeWidth={2} />
                    Send
                  </Button>
                </div>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function FolderTab({
  active,
  icon: Icon,
  label,
  count,
  badge,
  onClick,
}: {
  active: boolean;
  icon: typeof InboxIcon;
  label: string;
  count: number;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-brand text-text-on-dark"
          : "text-text-caption hover:bg-subtle hover:text-text-primary"
      }`}
    >
      <Icon className="size-3.5" strokeWidth={1.75} />
      {label}
      <span
        className={`rounded-full px-1.5 py-0.5 text-[10px] ${
          active ? "bg-white/20" : "bg-subtle text-text-caption"
        }`}
      >
        {count}
      </span>
      {badge != null ? (
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
            active ? "bg-white text-brand" : "bg-brand text-text-on-dark"
          }`}
        >
          {badge} new
        </span>
      ) : null}
    </button>
  );
}

function FilterOption({
  active,
  label,
  onClick,
  block,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  block?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${block ? "w-full text-left" : ""} rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "bg-brand text-text-on-dark"
          : "bg-subtle text-text-caption hover:bg-neutral-200 hover:text-text-primary"
      }`}
    >
      {label}
    </button>
  );
}

function ThreadBubble({ message }: { message: CampaignInboxMessage }) {
  if (message.role === "system") {
    return (
      <div className="flex justify-center">
        <p className="rounded-full bg-surface px-3 py-1 text-[11px] text-text-caption ring-1 ring-border-default">
          {message.text} · {formatInboxTime(message.createdAt)}
        </p>
      </div>
    );
  }

  const isOutbound = message.role === "agent" || message.role === "bot";
  const isBot = message.role === "bot";

  return (
    <div className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-5 sm:max-w-[70%] ${
          isOutbound
            ? isBot
              ? "border border-sky-200 bg-sky-50 text-text-secondary"
              : "bg-brand text-text-on-dark"
            : "border border-border-default bg-surface text-text-secondary"
        }`}
      >
        <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide opacity-80">
          {message.role === "contact" ? (
            <>
              <UserRound className="size-3" strokeWidth={1.75} />
              Contact
            </>
          ) : isBot ? (
            <>
              <Bot className="size-3" strokeWidth={1.75} />
              Bot
            </>
          ) : (
            <>
              <UserRound className="size-3" strokeWidth={1.75} />
              You
            </>
          )}
          <span className="font-normal normal-case tracking-normal">
            · {formatInboxTime(message.createdAt)}
          </span>
        </div>
        {message.text}
      </div>
    </div>
  );
}
