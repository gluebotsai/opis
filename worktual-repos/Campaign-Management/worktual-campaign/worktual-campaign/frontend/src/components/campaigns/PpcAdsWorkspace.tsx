import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  LayoutTemplate,
  Megaphone,
  MessageSquarePlus,
  Search,
  Share2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CampaignDraftDeleteControl } from "@/components/campaigns/CampaignDraftDeleteControl";
import { ConfirmDeleteButton } from "@/components/ui/ConfirmDeleteButton";
import { ContactChatBar } from "@/components/contacts/ContactChatBar";
import { PpcPlanForm, type PpcPlanFormValues } from "@/components/campaigns/PpcPlanForm";
import { ChannelTemplatePreview } from "@/components/campaigns/ChannelTemplatePreview";
import {
  deleteCampaignDraftAsync,
  formatRelativeTime,
  isCampaignDeleteLocked,
  listCampaignDraftsAsync,
  statusLabel,
  type CampaignChatDraft,
} from "@/lib/campaign-drafts";
import {
  listPpcTemplates,
  PPC_PLATFORMS,
  ppcNetworkLabel,
  type PpcAdTemplate,
  type PpcNetwork,
} from "@/lib/ppc-templates-store";
import {
  deletePpcPlanFormDraft,
  listPpcPlanFormDrafts,
  savePpcPlanFormDraft,
  type PpcPlanFormDraft,
} from "@/lib/ppc-plan-form-store";
import { chatPathForDraft } from "@/lib/start-create-campaign-chat";
import { startPpcCampaignChat } from "@/lib/start-ppc-campaign-chat";

const PPC_BASE = "/campaigns/create/ppc";
const CREATE_BASE = "/campaigns/create";

function isPpcDraft(draft: CampaignChatDraft): boolean {
  return (draft.channels || []).some((c) =>
    String(c).trim().toLowerCase().includes("ppc"),
  );
}

function draftMentionsNetwork(
  draft: CampaignChatDraft,
  network: PpcNetwork,
): boolean {
  const needle = network === "google" ? "google" : "meta";
  const other = network === "google" ? "meta" : "google";
  const blob = [
    draft.name,
    draft.goal,
    ...(draft.messages || []).map((m) => m.text),
  ]
    .join("\n")
    .toLowerCase();

  if (
    network === "meta" &&
    (blob.includes("facebook") || blob.includes("instagram"))
  ) {
    return true;
  }
  if (blob.includes(needle)) return true;
  if (
    !blob.includes(other) &&
    !blob.includes("facebook") &&
    !blob.includes("instagram")
  ) {
    return true;
  }
  return false;
}

function parseNetworkParam(
  raw: string | undefined,
): PpcNetwork | "invalid" | undefined {
  if (raw == null) return undefined;
  if (raw === "meta" || raw === "google") return raw;
  return "invalid";
}

/**
 * PPC ads hub under Create campaign.
 * Hub: platform modules.
 * Platform page: manual plan form + designed templates + drafted chats.
 */
export function PpcAdsWorkspace({
  listHref = CREATE_BASE,
}: {
  listHref?: string;
}) {
  const navigate = useNavigate();
  const { network: networkParam } = useParams<{ network?: string }>();
  const parsed = parseNetworkParam(networkParam);
  const network = parsed === "invalid" ? undefined : parsed;
  const isPlatform = network === "meta" || network === "google";
  const invalidNetwork = parsed === "invalid";

  const [drafts, setDrafts] = useState<CampaignChatDraft[]>([]);
  const [formDrafts, setFormDrafts] = useState<PpcPlanFormDraft[]>([]);
  const [formNotice, setFormNotice] = useState("");

  const refresh = useCallback(() => {
    void listCampaignDraftsAsync()
      .then((rows) => setDrafts(rows.filter(isPpcDraft)))
      .catch(() => setDrafts([]));
    setFormDrafts(listPpcPlanFormDrafts());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const platformDrafts = useMemo(() => {
    if (!isPlatform || !network) return [];
    return drafts
      .filter((d) => draftMentionsNetwork(d, network))
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  }, [drafts, isPlatform, network]);

  const platformFormDrafts = useMemo(() => {
    if (!isPlatform || !network) return [];
    return formDrafts.filter((d) => d.network === network);
  }, [formDrafts, isPlatform, network]);

  const designed = useMemo(
    () => (isPlatform && network ? listPpcTemplates(network) : []),
    [isPlatform, network],
  );

  if (invalidNetwork) {
    return <Navigate to={PPC_BASE} replace />;
  }

  const openCreatePpc = (opts?: {
    network?: PpcNetwork;
    initialUserMessage?: string;
    fromTemplate?: PpcAdTemplate;
    fromPlan?: { name: string; plan: PpcAdTemplate["plan"] };
  }) => {
    const { path } = startPpcCampaignChat({
      chatBasePath: CREATE_BASE,
      network: opts?.network,
      initialUserMessage: opts?.initialUserMessage,
      fromTemplate: opts?.fromTemplate,
      fromPlan: opts?.fromPlan,
    });
    navigate(path, {
      state: {
        listHref:
          isPlatform && network ? `${PPC_BASE}/${network}` : PPC_BASE,
      },
    });
  };

  const onChatBarSend = (text: string) => {
    openCreatePpc({
      network: isPlatform && network ? network : undefined,
      initialUserMessage: text,
    });
  };

  const saveForm = (values: PpcPlanFormValues, networkId: PpcNetwork) => {
    savePpcPlanFormDraft({
      name: values.campaignName,
      network: networkId,
      plan: values.plan,
    });
    refresh();
    setFormNotice("Plan card saved locally.");
  };

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col bg-subtle">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 pb-28 sm:px-6 sm:py-8">
        {isPlatform && network ? (
          <PlatformTemplatesView
            network={network}
            designed={designed}
            drafts={platformDrafts}
            formDrafts={platformFormDrafts}
            formNotice={formNotice}
            onBack={() => navigate(PPC_BASE)}
            onCreate={() => openCreatePpc({ network })}
            onUseTemplate={(t) => openCreatePpc({ fromTemplate: t })}
            onSaveForm={(values) => saveForm(values, network)}
            onSaveFormAndChat={(values) => {
              saveForm(values, network);
              openCreatePpc({
                network,
                fromPlan: { name: values.campaignName, plan: values.plan },
              });
            }}
            onDeleteDraft={(id) => {
              const row = drafts.find((d) => d.id === id);
              if (row && isCampaignDeleteLocked(row.status)) return;
              void deleteCampaignDraftAsync(id).then(() => refresh());
            }}
            onDeleteFormDraft={(id) => {
              deletePpcPlanFormDraft(id);
              refresh();
            }}
            onOpenFormDraft={(row) =>
              openCreatePpc({
                network: row.network,
                fromPlan: { name: row.name, plan: row.plan },
              })
            }
          />
        ) : (
          <PpcHubView
            listHref={listHref}
            onCreate={() => openCreatePpc()}
            onOpenPlatform={(n) => navigate(`${PPC_BASE}/${n}`)}
          />
        )}
      </div>

      <ContactChatBar
        placeholder={
          isPlatform && network
            ? `Ask about ${ppcNetworkLabel(network)} PPC…`
            : "Ask about PPC ads…"
        }
        onSend={onChatBarSend}
      />
    </div>
  );
}

function PpcHubView({
  listHref,
  onCreate,
  onOpenPlatform,
}: {
  listHref: string;
  onCreate: () => void;
  onOpenPlatform: (network: PpcNetwork) => void;
}) {
  const navigate = useNavigate();

  return (
    <>
      <button
        type="button"
        onClick={() => navigate(listHref)}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" strokeWidth={1.75} />
        Create campaign
      </button>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-text-primary">
            <Megaphone className="size-5 text-brand" strokeWidth={1.75} />
            PPC ads
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-text-caption">
            Open Meta or Google to fill a plan form, or chat to refine. Plan
            cards only — no live publish yet.
          </p>
        </div>
        <Button
          type="button"
          variant="brand"
          className="h-9 shrink-0"
          onClick={onCreate}
        >
          <MessageSquarePlus className="mr-1.5 size-4" strokeWidth={1.75} />
          Create PPC ads
        </Button>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-text-primary">
          Platforms
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {PPC_PLATFORMS.map((p) => {
            const Icon = p.id === "google" ? Search : Share2;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onOpenPlatform(p.id)}
                className="flex items-start gap-3 rounded-xl border border-border-default bg-surface px-4 py-4 text-left transition-colors hover:border-border-strong hover:bg-subtle"
              >
                <span className="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-900">
                  <Icon className="size-5" strokeWidth={1.75} />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-text-primary">
                    {p.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-text-caption">
                    {p.hint} · fill plan form fields
                  </span>
                  <span className="mt-2 block text-xs font-medium text-brand">
                    Open form →
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}

function PlatformTemplatesView({
  network,
  designed,
  drafts,
  formDrafts,
  formNotice,
  onBack,
  onCreate,
  onUseTemplate,
  onSaveForm,
  onSaveFormAndChat,
  onDeleteDraft,
  onDeleteFormDraft,
  onOpenFormDraft,
}: {
  network: PpcNetwork;
  designed: PpcAdTemplate[];
  drafts: CampaignChatDraft[];
  formDrafts: PpcPlanFormDraft[];
  formNotice: string;
  onBack: () => void;
  onCreate: () => void;
  onUseTemplate: (t: PpcAdTemplate) => void;
  onSaveForm: (values: PpcPlanFormValues) => void;
  onSaveFormAndChat: (values: PpcPlanFormValues) => void;
  onDeleteDraft: (id: string) => void;
  onDeleteFormDraft: (id: string) => void;
  onOpenFormDraft: (row: PpcPlanFormDraft) => void;
}) {
  const label = ppcNetworkLabel(network);

  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" strokeWidth={1.75} />
        PPC ads
      </button>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">{label}</h1>
          <p className="mt-1 max-w-2xl text-sm text-text-caption">
            Fill the {label} plan fields below, or start from a designed
            template. PPC only — not email/SMS/WhatsApp.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="h-9 shrink-0"
          onClick={onCreate}
        >
          <MessageSquarePlus className="mr-1.5 size-4" strokeWidth={1.75} />
          Chat instead
        </Button>
      </div>

      <section className="mb-8">
        <PpcPlanForm
          network={network}
          onSave={onSaveForm}
          onSaveAndChat={onSaveFormAndChat}
        />
        {formNotice ? (
          <p className="mt-2 text-xs text-text-caption">{formNotice}</p>
        ) : null}
      </section>

      {formDrafts.length > 0 ? (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold text-text-primary">
            Saved form plans
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {formDrafts.map((row) => (
              <li
                key={row.id}
                className="rounded-xl border border-border-default bg-surface p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-text-primary">
                      {row.name}
                    </p>
                    <p className="mt-0.5 text-xs text-text-caption">
                      {row.plan.objective}
                      {row.plan.creative_format
                        ? ` · ${row.plan.creative_format}`
                        : ""}
                      {row.plan.campaign_type
                        ? ` · ${row.plan.campaign_type}`
                        : ""}
                    </p>
                  </div>
                  <ConfirmDeleteButton
                    name={row.name}
                    entityLabel="plan"
                    compact
                    consequence="Removes this saved form plan."
                    onConfirm={async () => {
                      onDeleteFormDraft(row.id);
                      return { ok: true };
                    }}
                  />
                </div>
                <div className="mt-3 max-h-64 overflow-hidden">
                  <ChannelTemplatePreview channel="ppc" fields={row.plan} />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  className="mt-2 h-8 text-xs"
                  onClick={() => onOpenFormDraft(row)}
                >
                  Refine with AI →
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <LayoutTemplate className="size-4 text-brand" strokeWidth={1.75} />
            Designed templates
          </h2>
          <span className="text-xs text-text-caption">{designed.length}</span>
        </div>
        {designed.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border-default bg-surface px-4 py-10 text-center text-sm text-text-caption">
            No designed templates for {label} yet.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {designed.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onUseTemplate(t)}
                  className="flex h-full w-full flex-col rounded-xl border border-border-default bg-surface px-4 py-4 text-left transition-colors hover:border-border-strong hover:bg-subtle"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-amber-900 uppercase">
                      {ppcNetworkLabel(t.network)}
                    </span>
                    <span className="rounded-full bg-subtle px-2 py-0.5 text-[10px] font-medium tracking-wide text-text-caption uppercase">
                      {t.status}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-text-primary">
                    {t.name}
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs text-text-caption">
                    {t.description}
                  </p>
                  <p className="mt-3 text-xs font-medium text-brand">
                    Start from template →
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-border-default bg-surface">
        <div className="flex items-center justify-between border-b border-border-default px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">
            Chat drafts
          </h2>
          <span className="text-xs text-text-caption">
            {drafts.length} saved
          </span>
        </div>

        {drafts.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-text-primary">
              No {label} PPC chat drafts yet
            </p>
            <p className="mt-1 text-sm text-text-caption">
              Use the form above or Chat instead.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border-default">
            {drafts.map((draft) => (
              <li
                key={draft.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3"
              >
                <Link
                  to={chatPathForDraft(draft.id, CREATE_BASE)}
                  state={{ listHref: PPC_BASE }}
                  className="min-w-0 flex-1 hover:opacity-90"
                >
                  <p className="truncate text-sm font-medium text-text-primary">
                    {draft.name || `Untitled ${label} PPC`}
                  </p>
                  <p className="mt-0.5 text-xs text-text-caption">
                    {statusLabel(draft.status)} ·{" "}
                    {formatRelativeTime(draft.updatedAt)}
                  </p>
                </Link>
                <CampaignDraftDeleteControl
                  name={draft.name || `Untitled ${label} PPC`}
                  status={draft.status}
                  onConfirm={async () => {
                    onDeleteDraft(draft.id);
                    return { ok: true };
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
