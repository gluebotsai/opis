"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Copy,
  LayoutTemplate,
  MessageSquarePlus,
  PlusCircle,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDeleteButton } from "@/components/ui/ConfirmDeleteButton";
import {
  createEmptyDraft,
  deleteCampaignDraft,
  formatRelativeTime,
  listCampaignDrafts,
  statusLabel,
  upsertCampaignDraft,
  type CampaignChatDraft,
} from "@/lib/campaign-drafts";
import {
  listCampaignRecommendations,
  type CampaignRecommendation,
} from "@/lib/campaign-recommendations";
import {
  listCampaignTemplates,
  type CampaignTemplate,
} from "@/lib/campaign-templates";
import { listPastCampaigns, type PastCampaign } from "@/lib/past-campaigns";

export function CreateCampaignLanding({
  chatBasePath = "/campaigns/create",
  templatesHref = "/templates",
}: {
  chatBasePath?: string;
  templatesHref?: string;
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<CampaignChatDraft[]>([]);
  const [picker, setPicker] = useState<"template" | "clone" | null>(null);
  const [templates, setTemplates] = useState<CampaignTemplate[]>([]);
  const [pastCampaigns, setPastCampaigns] = useState<PastCampaign[]>([]);

  const refresh = useCallback(() => {
    setDrafts(listCampaignDrafts());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openNewChat = (seed?: Partial<CampaignChatDraft>) => {
    const draft = createEmptyDraft(seed);
    upsertCampaignDraft(draft);
    router.push(`${chatBasePath}/${draft.id}`);
  };

  const openTemplatePicker = () => {
    setTemplates(listCampaignTemplates());
    setPicker("template");
  };

  const openClonePicker = () => {
    setPastCampaigns(listPastCampaigns());
    setPicker("clone");
  };

  const startFromTemplate = (template: CampaignTemplate) => {
    setPicker(null);
    openNewChat({
      name: `Template · ${template.name}`,
      goal: template.goal,
      channels: [...template.channels],
      audience: template.audience,
      status: "drafting",
      dirty: true,
      flowSteps: [...template.flowSteps],
      messages: [
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: template.starterMessage,
          createdAt: new Date().toISOString(),
        },
      ],
    });
  };

  const clonePast = (campaign: PastCampaign) => {
    setPicker(null);
    openNewChat({
      name: `Clone · ${campaign.name}`,
      goal: campaign.goal,
      channels: [...campaign.channels],
      audience: campaign.audience,
      schedule: "Suggested: copy prior window",
      status: "drafting",
      dirty: true,
      flowSteps: [...campaign.flowSteps],
      messages: [
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: `Cloned “${campaign.name}”. Say what to change in chat.`,
          createdAt: new Date().toISOString(),
        },
      ],
    });
  };

  const handleDelete = (id: string) => {
    deleteCampaignDraft(id);
    refresh();
  };

  const recommendations = listCampaignRecommendations();

  const startFromRecommendation = (rec: CampaignRecommendation) => {
    openNewChat({
      name: rec.title,
      goal: rec.goal,
      channels: [...rec.channels],
      audience: rec.audience,
      schedule: rec.timingLabel,
      status: "drafting",
      dirty: true,
      flowSteps: [...rec.flowSteps],
      messages: [
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: rec.starterMessage,
          createdAt: new Date().toISOString(),
        },
      ],
    });
  };

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-text-primary">
          Create campaign
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-text-caption">
          Start a new chat or resume a draft you left mid-conversation.
        </p>
      </div>

      <div className="mb-6 grid gap-2 sm:grid-cols-3">
        <QuickStart
          icon={MessageSquarePlus}
          title="New chat"
          hint="Empty chat"
          onClick={() => openNewChat()}
        />
        <QuickStart
          icon={LayoutTemplate}
          title="Use template"
          hint="From template library"
          onClick={openTemplatePicker}
        />
        <QuickStart
          icon={Copy}
          title="Clone past"
          hint="From old campaigns"
          onClick={openClonePicker}
        />
      </div>
      <p className="mb-6 -mt-3 text-xs text-text-caption">
        Manage channel templates in the{" "}
        <Link href={templatesHref} className="text-text-link hover:underline">
          template library
        </Link>
        .
      </p>

      <section className="rounded-xl border border-border-default bg-surface">
        <div className="flex items-center justify-between border-b border-border-default px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">Draft</h2>
          <span className="text-xs text-text-caption">
            {drafts.length} saved
          </span>
        </div>

        {drafts.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <span className="mx-auto inline-flex size-12 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
              <PlusCircle className="size-6" strokeWidth={1.75} />
            </span>
            <p className="mt-4 text-sm font-medium text-text-primary">
              No drafts yet
            </p>
            <p className="mt-1 text-sm text-text-caption">
              Start a new chat — if you leave mid-way, you can save and resume
              here.
            </p>
            <Button
              type="button"
              variant="brand"
              className="mt-5"
              onClick={() => openNewChat()}
            >
              New chat
            </Button>
          </div>
        ) : (
          <ul className="max-h-[min(560px,60vh)] overflow-y-auto divide-y divide-border-default">
            {drafts.map((draft) => (
              <li
                key={draft.id}
                className="flex items-stretch gap-1 px-2 py-1 sm:px-3"
              >
                <button
                  type="button"
                  onClick={() => router.push(`${chatBasePath}/${draft.id}`)}
                  className="flex min-w-0 flex-1 items-start gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-subtle"
                >
                  <span className="mt-0.5 size-2 shrink-0 rounded-full bg-brand" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium text-text-primary">
                        {draft.name}
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
                    {formatRelativeTime(draft.updatedAt)}
                  </span>
                </button>
                <div
                  className="shrink-0 self-center"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <ConfirmDeleteButton
                    name={draft.name}
                    entityLabel="draft"
                    compact
                    consequence="This permanently removes the draft conversation."
                    onConfirm={async () => {
                      handleDelete(draft.id);
                      return { ok: true };
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-border-default bg-surface">
        <div className="flex items-center justify-between border-b border-border-default px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-brand" strokeWidth={1.75} />
            <h2 className="text-sm font-semibold text-text-primary">
              Recommendations
            </h2>
          </div>
          <span className="text-xs text-text-caption">
            Based on upcoming events
          </span>
        </div>
        <ul className="divide-y divide-border-default">
          {recommendations.map((rec) => (
            <li key={rec.id}>
              <button
                type="button"
                onClick={() => startFromRecommendation(rec)}
                className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-subtle sm:px-5"
              >
                <span className="mt-0.5 size-2 shrink-0 rounded-full bg-brand" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-text-primary">
                      {rec.title}
                    </p>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                      {rec.timingLabel}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-text-caption">
                    {rec.eventName} · {rec.goal} · {rec.audience}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {rec.channels.map((ch) => (
                      <span
                        key={ch}
                        className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700"
                      >
                        {ch}
                      </span>
                    ))}
                  </div>
                </div>
                <span className="shrink-0 text-xs font-medium text-text-link">
                  Start
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {picker === "template" ? (
        <PickerDialog
          title="Use template"
          description="Pick a saved template from your library."
          empty="No templates yet — create one in the template library."
          onClose={() => setPicker(null)}
          footer={
            <Link
              href={templatesHref}
              className="text-sm text-text-link hover:underline"
              onClick={() => setPicker(null)}
            >
              Open template library
            </Link>
          }
        >
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => startFromTemplate(t)}
              className="w-full rounded-lg px-3 py-3 text-left hover:bg-subtle"
            >
              <p className="text-sm font-medium text-text-primary">{t.name}</p>
              {t.description ? (
                <p className="mt-0.5 text-xs text-text-caption">
                  {t.description}
                </p>
              ) : null}
              <div className="mt-1.5 flex flex-wrap gap-1">
                {t.channels.map((ch) => (
                  <span
                    key={ch}
                    className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700"
                  >
                    {ch}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </PickerDialog>
      ) : null}

      {picker === "clone" ? (
        <PickerDialog
          title="Clone past campaign"
          description="Choose an old campaign to start a new chat from."
          empty="No past campaigns available yet."
          onClose={() => setPicker(null)}
        >
          {pastCampaigns.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => clonePast(c)}
              className="w-full rounded-lg px-3 py-3 text-left hover:bg-subtle"
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-text-primary">{c.name}</p>
                <span className="rounded-full bg-subtle px-2 py-0.5 text-[10px] font-medium tracking-wide text-text-caption uppercase">
                  {c.status}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-text-caption">
                {c.goal} · {c.audience}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {c.channels.map((ch) => (
                  <span
                    key={ch}
                    className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700"
                  >
                    {ch}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </PickerDialog>
      ) : null}
    </div>
  );
}

function QuickStart({
  icon: Icon,
  title,
  hint,
  onClick,
}: {
  icon: typeof MessageSquarePlus;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-xl border border-border-default bg-surface px-3 py-3 text-left text-sm hover:border-border-strong hover:bg-subtle"
    >
      <Icon className="size-4 shrink-0 text-brand" strokeWidth={1.75} />
      <span>
        <span className="font-medium text-text-primary">{title}</span>
        <span className="mt-0.5 block text-xs text-text-caption">{hint}</span>
      </span>
    </button>
  );
}

function PickerDialog({
  title,
  description,
  empty,
  onClose,
  children,
  footer,
}: {
  title: string;
  description: string;
  empty: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const items = Array.isArray(children)
    ? children
    : children
      ? [children]
      : [];
  const hasItems = items.filter(Boolean).length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      <div
        role="dialog"
        aria-modal
        aria-labelledby="campaign-picker-title"
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-border-default bg-surface shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border-default px-5 py-4">
          <div>
            <h2
              id="campaign-picker-title"
              className="text-base font-semibold text-text-primary"
            >
              {title}
            </h2>
            <p className="mt-1 text-sm text-text-caption">{description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-text-caption hover:bg-subtle hover:text-text-primary"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {hasItems ? (
            <div className="divide-y divide-border-default">{children}</div>
          ) : (
            <p className="px-3 py-8 text-center text-sm text-text-caption">
              {empty}
            </p>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border-default px-5 py-3">
          <div>{footer}</div>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
