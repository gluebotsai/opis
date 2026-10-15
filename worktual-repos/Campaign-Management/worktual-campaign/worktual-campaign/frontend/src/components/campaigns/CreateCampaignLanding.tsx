import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarPlus,
  FileText,
  LayoutTemplate,
  MessageSquarePlus,
  PlusCircle,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CampaignDraftDeleteControl } from "@/components/campaigns/CampaignDraftDeleteControl";
import { Skeleton, SkeletonText } from "@/components/skeleton";
import {
  campaignCannotDeleteMessage,
  deleteCampaignDraftAsync,
  displayDraftName,
  formatDraftListTime,
  getCampaignDraft,
  isCampaignDeleteLocked,
  CAMPAIGN_DRAFT_PAGE_SIZE,
  listCampaignDraftsPageAsync,
  statusLabel,
  type CampaignChatDraft,
  type ChatMessage,
} from "@/lib/campaign-drafts";
import {
  deselectTemplate,
  listSelectedTemplates,
} from "@/lib/selected-campaign-templates";
import {
  chatPathForDraft,
  startCreateCampaignChat,
} from "@/lib/start-create-campaign-chat";
import {
  DEFAULT_PACK_ID,
  getActivePackId,
  isB2cPack,
  subscribeActivePack,
} from "@/lib/industry-packs";

type B2cStarter = {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  seed: Partial<CampaignChatDraft>;
};

function b2cStarterSeed(input: {
  name: string;
  goal: string;
  objective: string;
  channels: string[];
  userAsk: string;
}): Partial<CampaignChatDraft> {
  const now = new Date().toISOString();
  const messages: ChatMessage[] = [
    {
      id: crypto.randomUUID(),
      role: "user",
      text: input.userAsk,
      createdAt: now,
    },
  ];
  return {
    name: input.name,
    goal: input.goal,
    objective: input.objective,
    channels: input.channels,
    audience: "Not set yet",
    schedule: "Not set yet",
    status: "drafting",
    dirty: true,
    messages,
  };
}

const B2C_STARTERS: B2cStarter[] = [
  {
    id: "launch",
    label: "Product launch",
    hint: "New offer",
    icon: Sparkles,
    seed: b2cStarterSeed({
      name: "Product launch campaign",
      goal: "Announce a new product to engaged customers.",
      objective:
        "Drive awareness and clicks with email and WhatsApp for interested customers.",
      channels: ["email", "whatsapp"],
      userAsk:
        "Create a product launch marketing campaign for engaged customers. Email and WhatsApp. Suggest audience (city/segment) and a consumer-friendly schedule.",
    }),
  },
  {
    id: "winback",
    label: "Win-back",
    hint: "Re-engage",
    icon: Wallet,
    seed: b2cStarterSeed({
      name: "Win-back campaign",
      goal: "Re-engage lapsed customers with a simple offer.",
      objective: "Bring inactive customers back with email and push.",
      channels: ["email", "push"],
      userAsk:
        "Create a win-back marketing campaign for inactive customers. Email and app push. Suggest audience and schedule. Do not invent discount percentages.",
    }),
  },
  {
    id: "festive",
    label: "Festive offer",
    hint: "Seasonal",
    icon: Sparkles,
    seed: b2cStarterSeed({
      name: "Festive offer campaign",
      goal: "Promote a seasonal offer before the festive peak.",
      objective: "Multi-channel festive marketing to active customers.",
      channels: ["email", "whatsapp", "push"],
      userAsk:
        "Create a festive offer marketing campaign for active customers. Prefer email, WhatsApp, and app push. Do not invent discount %. Suggest audience and schedule.",
    }),
  },
  {
    id: "referral",
    label: "Refer & earn",
    hint: "Acquisition",
    icon: FileText,
    seed: b2cStarterSeed({
      name: "Refer & earn invite",
      goal: "Grow acquisitions with a customer referral campaign.",
      objective: "Invite engaged customers to refer friends with factual reward copy.",
      channels: ["email", "whatsapp"],
      userAsk:
        "Create a refer-and-earn marketing campaign for engaged customers. Email and WhatsApp. Keep referral rewards factual — do not invent payout amounts. Suggest audience and schedule.",
    }),
  },
];

function QuickStart({
  icon: Icon,
  title,
  hint,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-start gap-3 rounded-xl border border-border-default bg-surface px-3.5 py-3 text-left transition-colors hover:bg-subtle"
    >
      <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
        <Icon className="size-4" strokeWidth={1.75} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-text-primary">{title}</span>
        <span className="mt-0.5 block text-xs text-text-caption">{hint}</span>
      </span>
    </button>
  );
}

function DraftListSkeleton() {
  return (
    <ul
      className="divide-y divide-border-default"
      aria-busy="true"
      aria-label="Loading drafts"
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <li
          key={i}
          className="flex items-start gap-3 px-4 py-3.5 sm:px-5"
        >
          <Skeleton width={8} height={8} borderRadius={999} className="mt-1.5" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton
                width={120 + (i % 3) * 24}
                height={14}
                borderRadius={6}
              />
              <Skeleton width={56} height={18} borderRadius={999} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Skeleton width={48} height={16} borderRadius={999} />
              <Skeleton width={64} height={16} borderRadius={999} />
            </div>
            <SkeletonText width={70 - i * 8} height={12} />
          </div>
          <Skeleton width={48} height={12} borderRadius={6} className="shrink-0" />
        </li>
      ))}
    </ul>
  );
}

export function CreateCampaignLanding({
  chatBasePath = "/campaigns/create",
}: {
  chatBasePath?: string;
}) {
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState<CampaignChatDraft[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(true);
  const [draftPage, setDraftPage] = useState(0);
  const [draftTotal, setDraftTotal] = useState(0);
  const [selectedTemplates, setSelectedTemplates] = useState(() =>
    listSelectedTemplates(),
  );

  const packId = useSyncExternalStore(
    subscribeActivePack,
    getActivePackId,
    () => DEFAULT_PACK_ID,
  );

  const b2c = isB2cPack();

  const refresh = useCallback(() => {
    setDraftsLoading(true);
    void listCampaignDraftsPageAsync({
      limit: CAMPAIGN_DRAFT_PAGE_SIZE,
      offset: draftPage * CAMPAIGN_DRAFT_PAGE_SIZE,
    })
      .then(({ drafts: rows, total }) => {
        setDrafts(rows);
        setDraftTotal(total);
      })
      .catch(() => {
        setDrafts([]);
        setDraftTotal(0);
      })
      .finally(() => setDraftsLoading(false));
    setSelectedTemplates(listSelectedTemplates());
  }, [packId, draftPage]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openNewChat = (seed?: Partial<CampaignChatDraft>) => {
    const draft = startCreateCampaignChat({
      chatBasePath,
      seed,
    });
    navigate(chatPathForDraft(draft.id, chatBasePath));
  };

  const openTemplateLibrary = () => {
    navigate(`${chatBasePath}/templates`);
  };

  const openRecommendations = () => {
    navigate(`${chatBasePath}/recommendations`);
  };

  const openCreateEvents = () => {
    navigate(`${chatBasePath}/events`);
  };

  const handleDelete = async (id: string) => {
    const row =
      drafts.find((d) => d.id === id) ?? getCampaignDraft(id) ?? null;
    if (row && isCampaignDeleteLocked(row.status)) {
      throw new Error(campaignCannotDeleteMessage(row.status));
    }
    await deleteCampaignDraftAsync(id);
    refresh();
  };

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">
            Create campaign
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-text-caption">
            {b2c
              ? "Get AI recommendations, pick a library template, or start a blank chat for your customers."
              : "Get AI recommendations, pick a library template, design events/forms, or start a blank chat."}
          </p>
        </div>
        <Button
          type="button"
          variant="brand"
          className="h-9 shrink-0"
          onClick={() => openNewChat()}
        >
          <MessageSquarePlus className="mr-1.5 size-4" strokeWidth={1.75} />
          New chat
        </Button>
      </div>

      <div
        className={`mb-6 grid gap-2 sm:grid-cols-2 ${
          b2c ? "lg:grid-cols-3" : "lg:grid-cols-4"
        }`}
      >
        <QuickStart
          icon={Sparkles}
          title="Recommendation"
          hint="AI campaign ideas"
          onClick={openRecommendations}
        />
        <QuickStart
          icon={LayoutTemplate}
          title="Template Gallery"
          hint="select template"
          onClick={openTemplateLibrary}
        />
        {!b2c ? (
          <QuickStart
            icon={CalendarPlus}
            title="Create events"
            hint="Design forms"
            onClick={openCreateEvents}
          />
        ) : null}
      </div>

      {selectedTemplates.length > 0 ? (
        <section className="mb-6 rounded-xl border border-border-default bg-surface p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-text-primary">
              Selected templates ({selectedTemplates.length})
            </p>
            <Button
              type="button"
              variant="secondary"
              className="h-8 text-xs"
              onClick={openTemplateLibrary}
            >
              Manage selection
            </Button>
          </div>
          <ul className="flex flex-wrap gap-2">
            {selectedTemplates.map((t) => (
              <li
                key={t.id}
                className="inline-flex items-center gap-2 rounded-full border border-border-default bg-subtle px-3 py-1.5 text-xs text-text-primary"
              >
                <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 uppercase">
                  {t.channels[0]}
                </span>
                <span className="font-medium">{t.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${t.name}`}
                  className="text-text-caption hover:text-text-danger"
                  onClick={() => {
                    deselectTemplate(t.id);
                    refresh();
                  }}
                >
                  <X className="size-3.5" strokeWidth={2} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-xl border border-border-default bg-surface">
        <div className="flex items-center justify-between border-b border-border-default px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">Draft</h2>
          <span className="text-xs text-text-caption">
            {draftsLoading ? "…" : `${draftTotal} saved`}
          </span>
        </div>

        {draftsLoading ? (
          <DraftListSkeleton />
        ) : drafts.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <span className="mx-auto inline-flex size-12 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
              <PlusCircle className="size-6" strokeWidth={1.75} />
            </span>
            <p className="mt-4 text-sm font-medium text-text-primary">
              {b2c ? "No customer drafts yet" : "No drafts yet"}
            </p>
            <p className="mt-1 text-sm text-text-caption">
              {b2c
                ? "Pick a starter below or open a blank chat for your customers."
                : "Start a new chat — if you leave mid-way, you can save and resume here."}
            </p>
            {b2c ? (
              <div className="mx-auto mt-5 grid max-w-2xl gap-2 sm:grid-cols-2 text-left">
                {B2C_STARTERS.map((s) => (
                  <QuickStart
                    key={s.id}
                    icon={s.icon}
                    title={s.label}
                    hint={s.hint}
                    onClick={() => openNewChat(s.seed)}
                  />
                ))}
              </div>
            ) : null}
            <Button
              type="button"
              variant={b2c ? "secondary" : "brand"}
              className="mt-5"
              onClick={() => openNewChat()}
            >
              {b2c ? "Blank customer chat" : "New chat"}
            </Button>
          </div>
        ) : (
          <>
          <ul className="max-h-[min(560px,60vh)] overflow-y-auto divide-y divide-border-default">
            {drafts.map((draft) => (
              <li
                key={draft.id}
                className="flex items-stretch gap-1 px-2 py-1 sm:px-3"
              >
                <button
                  type="button"
                  onClick={() => navigate(`${chatBasePath}/${draft.id}`)}
                  className="flex min-w-0 flex-1 items-start gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-subtle"
                >
                  <span className="mt-0.5 size-2 shrink-0 rounded-full bg-brand" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium text-text-primary">
                        {displayDraftName(draft)}
                      </p>
                      <span className="rounded-full bg-subtle px-2 py-0.5 text-[10px] font-medium tracking-wide text-text-caption uppercase">
                        {statusLabel(draft.status)}
                      </span>
                    </div>
                    {draft.channels.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {draft.channels.map((ch) => (
                          <span
                            key={ch}
                            className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700"
                          >
                            {ch}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <p className="mt-1 line-clamp-1 text-xs text-text-caption">
                      {draft.messages.length > 0
                        ? draft.messages[draft.messages.length - 1]?.text
                        : "No messages yet"}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-text-caption">
                    {formatDraftListTime(draft)}
                  </span>
                </button>
                <div
                  className="shrink-0 self-center"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <CampaignDraftDeleteControl
                    name={displayDraftName(draft)}
                    status={draft.status}
                    onConfirm={async () => {
                      try {
                        if (drafts.length <= 1 && draftPage > 0) {
                          setDraftPage((p) => Math.max(0, p - 1));
                        }
                        await handleDelete(draft.id);
                        return { ok: true };
                      } catch (err) {
                        const msg =
                          err instanceof Error ? err.message : "";
                        return {
                          ok: false,
                          error:
                            msg && isCampaignDeleteLocked(draft.status)
                              ? msg
                              : "Could not delete this draft. Try again.",
                        };
                      }
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
          {Math.ceil(draftTotal / CAMPAIGN_DRAFT_PAGE_SIZE) > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-default px-4 py-3">
              <span className="text-xs text-text-caption">
                {draftTotal === 0
                  ? "0 drafts"
                  : (() => {
                      const start = draftPage * CAMPAIGN_DRAFT_PAGE_SIZE + 1;
                      const end =
                        drafts.length === 0
                          ? 0
                          : Math.min(
                              start + drafts.length - 1,
                              draftTotal,
                            );
                      return `${start}–${end} of ${draftTotal}`;
                    })()}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  disabled={draftPage <= 0 || draftsLoading}
                  onClick={() => setDraftPage((p) => Math.max(0, p - 1))}
                >
                  Previous
                </Button>
                <span className="text-xs text-text-caption">
                  Page {draftPage + 1} of{" "}
                  {Math.max(1, Math.ceil(draftTotal / CAMPAIGN_DRAFT_PAGE_SIZE))}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  disabled={
                    draftPage >=
                      Math.ceil(draftTotal / CAMPAIGN_DRAFT_PAGE_SIZE) - 1 ||
                    draftsLoading
                  }
                  onClick={() =>
                    setDraftPage((p) =>
                      Math.min(
                        Math.ceil(draftTotal / CAMPAIGN_DRAFT_PAGE_SIZE) - 1,
                        p + 1,
                      ),
                    )
                  }
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
          </>
        )}
      </section>
    </div>
  );
}
