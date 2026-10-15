

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  File,
  ImageIcon,
  Library,
  Mic,
  Plus,
  Upload,
  X,
} from "lucide-react";
import { AgentChatComposer } from "@/components/chat/AgentChatComposer";
import { Button } from "@/components/ui/Button";
import { ConfirmDeleteButton } from "@/components/ui/ConfirmDeleteButton";
import {
  CAMPAIGN_CHANNELS,
  VISIBLE_CAMPAIGN_CHANNELS,
  type CampaignChannel,
  type CampaignChannelId,
} from "@/lib/campaign-channels";
import { formatRelativeTime } from "@/lib/campaign-drafts";
import { startCreateCampaignChat } from "@/lib/start-create-campaign-chat";
import {
  deleteCampaignTemplate,
  listApprovedTemplatesForChannel,
  listCampaignTemplates,
  loadCampaignTemplates,
  saveCampaignTemplate,
  subscribeCampaignTemplates,
  type CampaignTemplate,
} from "@/lib/campaign-templates";

export function TemplateLibraryClient({
  createBasePath = "/campaigns/create",
}: {
  createBasePath?: string;
}) {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<CampaignTemplate[]>([]);
  const [filterChannel, setFilterChannel] = useState<CampaignChannelId | "all">(
    "all",
  );
  const [activeChannel, setActiveChannel] = useState<CampaignChannel | null>(
    null,
  );
  const [channelTemplates, setChannelTemplates] = useState<CampaignTemplate[]>(
    [],
  );
  const [addOpen, setAddOpen] = useState(false);
  const [composer, setComposer] = useState("");
  const [attachOpen, setAttachOpen] = useState(false);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const refresh = useCallback(() => {
    void loadCampaignTemplates().then((rows) => setTemplates(rows));
  }, []);

  useEffect(() => {
    refresh();
    return subscribeCampaignTemplates(() => {
      setTemplates(listCampaignTemplates());
    });
  }, [refresh]);

  useEffect(() => {
    if (!attachOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (
        attachMenuRef.current &&
        !attachMenuRef.current.contains(e.target as Node)
      ) {
        setAttachOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [attachOpen]);

  const openChannel = (channel: CampaignChannel) => {
    setActiveChannel(channel);
    setFilterChannel(channel.id);
    setChannelTemplates(listApprovedTemplatesForChannel(channel.id));
    setAddOpen(false);
  };

  const closeChannel = () => {
    setActiveChannel(null);
    setAddOpen(false);
  };

  const refreshChannelLists = (channelId: CampaignChannelId) => {
    setChannelTemplates(listApprovedTemplatesForChannel(channelId));
    refresh();
  };

  const useInCampaign = (template: CampaignTemplate) => {
    closeChannel();
    const draft = startCreateCampaignChat({
      chatBasePath: createBasePath,
      useLibrarySelection: false,
      seed: {
        name: `Template · ${template.name}`,
        goal: template.goal,
        channels: [...template.channels],
        audience: template.audience,
        status: "drafting",
        dirty: true,
        libraryRun: true,
        usedLibraryTemplateIds: [template.id],
        flowSteps: [...template.flowSteps],
        messages: [
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text:
              template.starterMessage ||
              `Your selected library template “${template.name}” is the creative starting point. Shall we continue with that campaign idea, or do you want a different idea for these templates?`,
            createdAt: new Date().toISOString(),
          },
        ],
        ...(template.fields
          ? {
              timelineTemplates: [
                {
                  id: crypto.randomUUID(),
                  afterMessageIndex: 0,
                  createdAt: new Date().toISOString(),
                  cards: [
                    {
                      template_id: template.id,
                      channel:
                        template.primaryChannel === "web_push"
                          ? "web"
                          : template.primaryChannel === "app_push"
                            ? "push"
                            : template.primaryChannel,
                      fields: template.fields,
                      how_it_works: template.flowSteps?.join(" → "),
                    },
                  ],
                },
              ],
            }
          : {}),
      },
    });
    navigate(`${createBasePath}/${draft.id}`, {
      state: { listHref: `${createBasePath}/templates` },
    });
  };

  const handleDelete = (id: string) => {
    void deleteCampaignTemplate(id).then(() => {
      refresh();
      if (activeChannel) refreshChannelLists(activeChannel.id);
    });
  };

  const submitComposer = () => {
    const text = composer.trim();
    if (!text) return;
    const channelId: CampaignChannelId =
      filterChannel === "all" ? "email" : filterChannel;
    const channel =
      CAMPAIGN_CHANNELS.find((c) => c.id === channelId) ?? CAMPAIGN_CHANNELS[0];
    void saveCampaignTemplate({
      name: text.slice(0, 48),
      description: "Created from template library chat bar",
      primaryChannel: channel.id,
      channels: [channel.label],
      bodyPreview: text,
      contentBody: text,
      approvalStatus: "approved",
      starterMessage: `Started from template “${text.slice(0, 48)}”.`,
      flowSteps: [
        "Audience enters campaign",
        `First touch: ${channel.label}`,
      ],
    }).then(() => {
      setComposer("");
      setFilterChannel(channel.id);
      refresh();
      inputRef.current?.focus();
    });
  };

  const onFilesSelected = (files: FileList | null, kind: "image" | "file") => {
    setAttachOpen(false);
    if (!files?.length) return;
    const names = Array.from(files)
      .map((f) => f.name)
      .join(", ");
    setComposer((prev) =>
      prev
        ? `${prev}\n[${kind === "image" ? "Image" : "File"}: ${names}]`
        : `[${kind === "image" ? "Image" : "File"}: ${names}]`,
    );
    inputRef.current?.focus();
  };

  const onMic = () => {
    setAttachOpen(false);
    setComposer((prev) =>
      prev ? `${prev}\n[Voice note attached]` : "[Voice note attached]",
    );
    inputRef.current?.focus();
  };

  const visibleTemplates =
    filterChannel === "all"
      ? templates
      : templates.filter((t) => t.primaryChannel === filterChannel);

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col">
      <div className="flex-1 px-4 pt-6 pb-4 sm:px-6 sm:pt-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-text-primary">
            Template library
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-text-caption">
            Manage approved templates by channel. Use Create campaign to start
            chats from templates or past campaigns.
          </p>
        </div>

        <div className="mb-6">
          <p className="mb-2 text-xs font-medium tracking-wide text-text-caption uppercase">
            Channels
          </p>
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            {VISIBLE_CAMPAIGN_CHANNELS.map((channel) => {
              const Icon = channel.icon;
              const active = filterChannel === channel.id;
              return (
                <button
                  key={channel.id}
                  type="button"
                  onClick={() => openChannel(channel)}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-3 text-left text-sm ${
                    active
                      ? "border-brand bg-violet-50"
                      : "border-border-default bg-surface hover:border-border-strong hover:bg-subtle"
                  }`}
                >
                  <Icon
                    className="size-4 shrink-0 text-brand"
                    strokeWidth={1.75}
                  />
                  <span>
                    <span className="font-medium text-text-primary">
                      {channel.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-text-caption">
                      {channel.hint}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {filterChannel !== "all" ? (
            <button
              type="button"
              onClick={() => setFilterChannel("all")}
              className="mt-2 text-xs text-text-link hover:underline"
            >
              Show all channels
            </button>
          ) : null}
        </div>

        <section className="rounded-xl border border-border-default bg-surface">
          <div className="flex items-center justify-between border-b border-border-default px-4 py-3">
            <h2 className="text-sm font-semibold text-text-primary">
              {filterChannel === "all"
                ? "All templates"
                : `${CAMPAIGN_CHANNELS.find((c) => c.id === filterChannel)?.label ?? ""} templates`}
            </h2>
            <span className="text-xs text-text-caption">
              {visibleTemplates.length} saved
            </span>
          </div>

          {visibleTemplates.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <span className="mx-auto inline-flex size-12 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
                <Library className="size-6" strokeWidth={1.75} />
              </span>
              <p className="mt-4 text-sm font-medium text-text-primary">
                No templates yet
              </p>
              <p className="mt-1 text-sm text-text-caption">
                Open a channel to add approved templates, or type below.
              </p>
            </div>
          ) : (
            <ul className="max-h-[min(480px,50vh)] divide-y divide-border-default overflow-y-auto">
              {visibleTemplates.map((t) => (
                <li
                  key={t.id}
                  className="flex items-start gap-3 px-4 py-3 sm:px-5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-text-primary">
                        {t.name}
                      </p>
                      <span className="rounded-full bg-subtle px-2 py-0.5 text-[10px] font-medium tracking-wide text-text-caption uppercase">
                        {t.approvalStatus}
                      </span>
                      <span className="text-xs text-text-caption">
                        {formatRelativeTime(t.updatedAt)}
                      </span>
                    </div>
                    {t.externalTemplateId ? (
                      <p className="mt-0.5 font-mono text-[11px] text-text-caption">
                        ID: {t.externalTemplateId}
                      </p>
                    ) : null}
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
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => useInCampaign(t)}
                  >
                    Use
                  </Button>
                  <ConfirmDeleteButton
                    name={t.name}
                    entityLabel="template"
                    compact
                    consequence="This permanently removes the template from your library."
                    onConfirm={async () => {
                      handleDelete(t.id);
                      return { ok: true };
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <AgentChatComposer
        value={composer}
        onChange={setComposer}
        onSend={submitComposer}
        inputRef={inputRef}
        placeholder="Describe a template to save…"
        className="sticky bottom-0 z-30 mt-auto shrink-0 px-3 pt-2 pb-4 sm:px-6"
        leading={
          <div className="relative shrink-0" ref={attachMenuRef}>
            <button
              type="button"
              onClick={() => setAttachOpen((v) => !v)}
              className="inline-flex size-9 items-center justify-center rounded-full text-white/90 hover:bg-white/10"
              aria-label="Add attachment"
              aria-expanded={attachOpen}
            >
              <Plus className="size-5" strokeWidth={1.75} />
            </button>
            {attachOpen ? (
              <div className="absolute bottom-full left-0 z-40 mb-2 w-44 overflow-hidden rounded-xl border border-border-default bg-surface shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    setAttachOpen(false);
                    imageRef.current?.click();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-text-secondary hover:bg-subtle"
                >
                  <ImageIcon className="size-4" strokeWidth={1.75} />
                  Upload image
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAttachOpen(false);
                    fileRef.current?.click();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-text-secondary hover:bg-subtle"
                >
                  <File className="size-4" strokeWidth={1.75} />
                  Upload file
                </button>
                <button
                  type="button"
                  onClick={() => void onMic()}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-text-secondary hover:bg-subtle"
                >
                  <Mic className="size-4" strokeWidth={1.75} />
                  Voice (mic)
                </button>
              </div>
            ) : null}
            <input
              ref={imageRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                onFilesSelected(e.target.files, "image");
                e.target.value = "";
              }}
            />
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                onFilesSelected(e.target.files, "file");
                e.target.value = "";
              }}
            />
          </div>
        }
        trailing={
          <button
            type="button"
            onClick={() => void onMic()}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-white/70 hover:bg-white/10"
            aria-label="Voice"
            title="Voice"
          >
            <Mic className="size-4" strokeWidth={1.75} />
          </button>
        }
      />

      {activeChannel ? (
        <ChannelPopup
          channel={activeChannel}
          templates={channelTemplates}
          addOpen={addOpen}
          onOpenAdd={() => setAddOpen(true)}
          onCloseAdd={() => setAddOpen(false)}
          onClose={closeChannel}
          onUseTemplate={useInCampaign}
          onDeleteTemplate={handleDelete}
          onTemplateAdded={() => {
            refreshChannelLists(activeChannel.id);
            setAddOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function ChannelPopup({
  channel,
  templates,
  addOpen,
  onOpenAdd,
  onCloseAdd,
  onClose,
  onUseTemplate,
  onDeleteTemplate,
  onTemplateAdded,
}: {
  channel: CampaignChannel;
  templates: CampaignTemplate[];
  addOpen: boolean;
  onOpenAdd: () => void;
  onCloseAdd: () => void;
  onClose: () => void;
  onUseTemplate: (t: CampaignTemplate) => void;
  onDeleteTemplate: (id: string) => void;
  onTemplateAdded: () => void;
}) {
  const Icon = channel.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      <div
        role="dialog"
        aria-modal
        aria-labelledby="channel-popup-title"
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border-default bg-surface shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border-default px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex size-10 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
              <Icon className="size-5" strokeWidth={1.75} />
            </span>
            <div>
              <h2
                id="channel-popup-title"
                className="text-base font-semibold text-text-primary"
              >
                {channel.label}
              </h2>
              <p className="mt-0.5 text-sm text-text-caption">
                {channel.regulated
                  ? "Approved templates for this channel."
                  : "Saved templates for this channel."}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-text-caption hover:bg-subtle"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-text-primary">
                Approved templates
              </h3>
              <Button type="button" variant="secondary" onClick={onOpenAdd}>
                <Upload className="size-3.5" strokeWidth={1.75} />
                {channel.regulated ? "Add approved" : "Add template"}
              </Button>
            </div>
            {templates.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border-default px-3 py-6 text-center text-sm text-text-caption">
                No approved templates yet.
              </p>
            ) : (
              <ul className="divide-y divide-border-default overflow-hidden rounded-lg border border-border-default">
                {templates.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-stretch gap-1"
                  >
                    <button
                      type="button"
                      onClick={() => onUseTemplate(t)}
                      className="min-w-0 flex-1 px-3 py-3 text-left hover:bg-subtle"
                    >
                      <p className="text-sm font-medium text-text-primary">
                        {t.name}
                      </p>
                      {t.externalTemplateId ? (
                        <p className="mt-0.5 font-mono text-[11px] text-text-caption">
                          ID: {t.externalTemplateId}
                        </p>
                      ) : null}
                      {t.bodyPreview ? (
                        <p className="mt-1 line-clamp-2 text-xs text-text-caption">
                          {t.bodyPreview}
                        </p>
                      ) : null}
                    </button>
                    <div className="shrink-0 self-center pr-2">
                      <ConfirmDeleteButton
                        name={t.name}
                        entityLabel="template"
                        compact
                        consequence="Removes this template from the library."
                        onConfirm={async () => {
                          onDeleteTemplate(t.id);
                          return { ok: true };
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="flex justify-end border-t border-border-default px-5 py-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>

      {addOpen ? (
        <AddApprovedTemplateForm
          channel={channel}
          onCancel={onCloseAdd}
          onSaved={onTemplateAdded}
        />
      ) : null}
    </div>
  );
}

function AddApprovedTemplateForm({
  channel,
  onCancel,
  onSaved,
}: {
  channel: CampaignChannel;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [externalId, setExternalId] = useState("");
  const [body, setBody] = useState("");

  const save = () => {
    if (!name.trim()) {
      window.alert("Template name is required.");
      return;
    }
    if (channel.regulated && !externalId.trim()) {
      window.alert(
        channel.id === "sms"
          ? "DLT Template ID is required for SMS."
          : "WhatsApp template name / ID is required.",
      );
      return;
    }
    void saveCampaignTemplate({
      name: name.trim(),
      primaryChannel: channel.id,
      externalTemplateId: externalId.trim(),
      channels: [channel.label],
      bodyPreview: body.trim(),
      contentBody: body.trim(),
      approvalStatus: "approved",
      description: channel.regulated
        ? `Imported approved ${channel.label} template`
        : `Saved ${channel.label} template`,
      starterMessage: externalId.trim()
        ? `Started from approved ${channel.label} template ${externalId.trim()}.`
        : `Started from ${channel.label} template “${name.trim()}”.`,
      flowSteps: [
        "Audience enters campaign",
        `First touch: ${channel.label}`,
      ],
    })
      .then(() => onSaved())
      .catch((err) => {
        window.alert(
          err instanceof Error ? err.message : "Could not save template",
        );
      });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal
        aria-labelledby="add-template-title"
        className="w-full max-w-md rounded-xl border border-border-default bg-surface shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border-default px-5 py-4">
          <div>
            <h2
              id="add-template-title"
              className="text-base font-semibold text-text-primary"
            >
              Add {channel.label} template
            </h2>
            <p className="mt-1 text-sm text-text-caption">
              {channel.regulated
                ? "Paste details from DLT / Meta after approval."
                : "Save a template for this channel."}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex size-8 items-center justify-center rounded-lg text-text-caption hover:bg-subtle"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <label className="block">
            <span className="text-xs font-medium text-text-caption">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-text-primary focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-border-focus/20"
            />
          </label>
          {channel.regulated ? (
            <label className="block">
              <span className="text-xs font-medium text-text-caption">
                {channel.id === "sms"
                  ? "DLT Template ID"
                  : "WhatsApp template name / ID"}
              </span>
              <input
                value={externalId}
                onChange={(e) => setExternalId(e.target.value)}
                placeholder={
                  channel.id === "sms" ? "PROMO_SALE_12" : "cart_recovery_en"
                }
                className="mt-1 w-full rounded-lg border border-border-default bg-surface px-3 py-2 font-mono text-sm text-text-primary focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-border-focus/20"
              />
            </label>
          ) : null}
          <label className="block">
            <span className="text-xs font-medium text-text-caption">
              Body preview
            </span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              className="mt-1 w-full resize-none rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-text-primary focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-border-focus/20"
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-border-default px-5 py-3">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="brand" onClick={save}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
