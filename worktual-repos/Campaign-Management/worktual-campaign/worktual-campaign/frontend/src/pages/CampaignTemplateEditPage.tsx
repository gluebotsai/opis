import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ImageIcon, Mic, Plus } from "lucide-react";
import { AgentChatComposer, type ComposerPendingImage } from "@/components/chat/AgentChatComposer";
import { AgentThinkingIndicator } from "@/components/chat/AgentThinkingIndicator";
import {
  ChannelTemplatePreview,
  hasEmailAb,
  isEmptyTemplateFields,
  type TemplateFields,
} from "@/components/campaigns/ChannelTemplatePreview";
import { ModuleSplitWorkspace } from "@/components/layout/ModuleSplitWorkspace";
import { TemplateManualEditWorkspace } from "@/components/campaigns/TemplateManualEditWorkspace";
import {
  ComposeHtmlManualEditWorkspace,
  hasComposeCompiledHtml,
} from "@/components/campaigns/ComposeHtmlManualEditWorkspace";
import { Button } from "@/components/ui/Button";
import { CampaignTemplateEditSkeleton } from "@/pages/CampaignTemplateEditSkeleton";
import { getToken } from "@/services/api";
import {
  persistTemplateEditToDraftAndSession,
} from "@/lib/campaign-drafts";
import {
  toEditChatRows,
  visibleEditChatRows,
  ensureTemplateSeedRow,
  type EditChatRow,
} from "@/lib/template-edit-chat";
import { mergeTemplateFields } from "@/lib/template-fields-merge";
import { ChatBubbleImageStrip } from "@/components/chat/ChatImageTiles";
import {
  chatImagesFromPending,
  chatImagesFromUploads,
  resolveChatMessageImages,
  unionChatMessageImages,
} from "@/lib/chat-message-images";
import {
  fetchChannelTemplate,
  fetchSessionChannelTemplates,
  isChannelUrlKey,
  isTemplateUuid,
  syncSessionChannelTemplates,
  syntheticEditMessages,
} from "@/services/channelTemplates.api";
import {
  getAgentsSocket,
  type TemplateCard,
  type TemplateEditMessage,
} from "@/services/agents.socket";
import {
  applyTemplateFieldsFromImageUiEvent,
  unwrapImageUiPayload,
  type ImageUiEventEnvelope,
} from "@/lib/campaign-image-ui-events";
import {
  resolvePendingChatImageUpload,
  uploadTemplateImageAsset,
} from "@/services/media.api";

type ChatRow = EditChatRow;

type EditLocationState = {
  template?: TemplateCard;
  templates?: TemplateCard[];
  campaign?: { name?: string; goal?: string; objective?: string };
  listHref?: string;
} | null;

function editorReturnHref(
  draftId: string | undefined,
  navState: EditLocationState,
): string {
  if (navState?.listHref) return navState.listHref;
  if (draftId) return `/campaigns/create/${draftId}`;
  return "/campaigns/create";
}

/** Prefer the longer transcript; when tied, keep whichever carries image payloads.
 * Never drop image rows when merging a thinner reload over a richer local chat.
 */
function mergeEditChatPreferRicher(
  current: ChatRow[],
  incoming: ChatRow[],
): ChatRow[] {
  if (!incoming.length) return current;
  if (!current.length) return incoming;

  const imageCount = (rows: ChatRow[]) =>
    rows.reduce(
      (n, r) =>
        n +
        (r.imageUrls?.length ||
          (r.imageUrl?.trim() ? 1 : 0)),
      0,
    );
  const textWeight = (rows: ChatRow[]) =>
    rows.reduce((n, r) => n + (r.text?.trim().length || 0), 0);

  const curImgs = imageCount(current);
  const incImgs = imageCount(incoming);

  // Overlay image payloads from the richer-image side onto the longer sequence.
  const overlayImages = (primary: ChatRow[], donor: ChatRow[]): ChatRow[] => {
    if (!donor.length) return primary;
    const donorByText = new Map<string, ChatRow>();
    for (const row of donor) {
      const key = `${row.role}::${(row.text || "").trim()}`;
      if (row.imageUrl?.trim() || row.imageUrls?.length) {
        donorByText.set(key, row);
      }
    }
    return primary.map((row) => {
      if (row.imageUrl?.trim() || row.imageUrls?.length) return row;
      const match = donorByText.get(`${row.role}::${(row.text || "").trim()}`);
      if (!match?.imageUrl && !match?.imageUrls?.length) return row;
      const merged = unionChatMessageImages(
        resolveChatMessageImages(row),
        resolveChatMessageImages(match),
      );
      return {
        ...row,
        ...(merged.length ? { imageUrls: merged } : {}),
        imageUrl: merged[0]?.url || match.imageUrl || row.imageUrl,
        imageFilename:
          row.imageFilename ||
          match.imageFilename ||
          merged[0]?.filename,
      };
    });
  };

  if (incoming.length > current.length) {
    // Prefer incoming length, but never lose local image bubbles.
    if (curImgs > incImgs) return overlayImages(incoming, current);
    return overlayImages(incoming, current);
  }
  if (current.length > incoming.length) {
    return overlayImages(current, incoming);
  }
  if (incImgs > curImgs) return overlayImages(incoming, current);
  if (curImgs > incImgs) return overlayImages(current, incoming);
  if (textWeight(current) > textWeight(incoming)) {
    return overlayImages(current, incoming);
  }
  return overlayImages(incoming, current);
}

function mergeTemplateCard(
  prev: TemplateCard | null,
  incoming: TemplateCard,
): TemplateCard {
  const priorFields =
    prev?.fields && typeof prev.fields === "object"
      ? (prev.fields as Record<string, unknown>)
      : {};
  const nextFields =
    incoming.fields && typeof incoming.fields === "object"
      ? mergeTemplateFields(priorFields, incoming.fields as Record<string, unknown>)
      : priorFields;
  return {
    ...prev,
    ...incoming,
    fields: nextFields,
  };
}

/** Chat-style template edit space keyed by template_id. */
export function CampaignTemplateEditPage() {
  const { draftId, templateId, channel: channelParam } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state as EditLocationState) || null;
  const initial = navState?.template;

  // Never paint nav-card fields as truth — they may be the first generate.
  // Load from DB / editor_ready only.
  const [template, setTemplate] = useState<TemplateCard | null>(
    initial ?? null,
  );
  const templateRef = useRef<TemplateCard | null>(null);
  const [allTemplates, setAllTemplates] = useState<TemplateCard[]>([]);
  const [campaign, setCampaign] = useState(
    navState?.campaign || { name: "", goal: "", objective: "" },
  );
  const [launchStatus, setLaunchStatus] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatRow[]>([]);
  const [typing, setTyping] = useState(false);
  const [editProgressLabel, setEditProgressLabel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingImages, setPendingImages] = useState<ComposerPendingImage[]>(
    [],
  );
  const pendingUploadsRef = useRef<
    Map<string, Promise<{ url: string; media_id: string }>>
  >(new Map());
  const [abVariant, setAbVariant] = useState<"a" | "b">("a");
  const [abExtra, setAbExtra] = useState<Record<"a" | "b", ChatRow[]>>({
    a: [],
    b: [],
  });
  const [manualEdit, setManualEdit] = useState(false);
  const [openingManualEdit, setOpeningManualEdit] = useState(false);
  templateRef.current = template;
  const bottomRef = useRef<HTMLDivElement>(null);
  const attachRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const abVariantRef = useRef<"a" | "b">("a");
  abVariantRef.current = abVariant;

  const activeTemplateId = templateId || template?.template_id || initial?.template_id;

  useEffect(() => {
    setAbVariant("a");
    setAbExtra({ a: [], b: [] });
    setManualEdit(false);
    setMessages([]);
  }, [activeTemplateId]);
  const activeChannel = (
    template?.channel ||
    channelParam ||
    ""
  ).toLowerCase();

  const channelTabs = useMemo(() => {
    if (!template) return allTemplates;
    const batch = template.generation_batch_id;
    if (!batch) {
      const self = allTemplates.filter(
        (t) => t.template_id === template.template_id,
      );
      return self.length ? self : [template];
    }
    return allTemplates.filter((t) => t.generation_batch_id === batch);
  }, [allTemplates, template]);

  const campaignTitle = useMemo(() => {
    return campaign.name?.trim() || "Campaign template";
  }, [campaign.name]);

  const campaignGoal = useMemo(() => {
    return campaign.goal?.trim() || "Primary goal";
  }, [campaign.goal]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, typing, editProgressLabel]);

  useEffect(() => {
    if (!attachOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!attachRef.current?.contains(e.target as Node)) {
        setAttachOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [attachOpen]);

  // Load template + edit history from DB by template_id (or resolve channel legacy URL).
  useEffect(() => {
    if (!draftId) return;
    const sessionDraftId = draftId;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      // Do not wipe chat here — merge after fetch so remount / race never drops
      // richer local history (optimistic image rows) for a thinner DB reload.
      try {
        let list = await fetchSessionChannelTemplates(sessionDraftId);
        if (cancelled) return;

        // If DB empty but we have session cards from navigation, backfill then reload.
        const navCards =
          navState?.templates?.length
            ? navState.templates
            : initial
              ? [initial]
              : [];
        if (!list.length && navCards.length) {
          try {
            list = await syncSessionChannelTemplates(sessionDraftId, navCards);
          } catch {
            list = [];
          }
        }
        if (list.length) setAllTemplates(list);
        else if (navCards.length) setAllTemplates(navCards);

        const source = list.length ? list : navCards;

        let preferredId = "";
        if (templateId && source.some((t) => t.template_id === templateId)) {
          preferredId = templateId;
        } else if (isTemplateUuid(templateId)) {
          preferredId = templateId!;
        } else if (isChannelUrlKey(channelParam) || isChannelUrlKey(templateId)) {
          const channelKey = (channelParam || templateId || "").toLowerCase();
          const same = source.filter(
            (t) => t.channel.toLowerCase() === channelKey,
          );
          if (
            initial?.template_id &&
            same.some((t) => t.template_id === initial.template_id)
          ) {
            preferredId = initial.template_id;
          } else {
            preferredId = same[0]?.template_id || "";
          }
        } else if (templateId) {
          preferredId = templateId;
        }
        if (!preferredId && initial?.template_id) {
          preferredId = initial.template_id;
        }
        if (!preferredId) {
          preferredId = source[source.length - 1]?.template_id || "";
        }

        if (!preferredId) {
          if (initial?.fields || initial?.preview) {
            setTemplate(initial);
            setMessages((current) =>
              mergeEditChatPreferRicher(
                current,
                toEditChatRows(syntheticEditMessages(initial), initial.preview),
              ),
            );
          }
          return;
        }

        // Canonical URL uses template_id UUID.
        if (templateId !== preferredId) {
          navigate(
            `/campaigns/create/${draftId}/templates/${preferredId}`,
            {
              replace: true,
              state: {
                template:
                  source.find((t) => t.template_id === preferredId) || initial,
                templates: source,
                campaign: navState?.campaign,
                listHref: navState?.listHref,
              },
            },
          );
          return;
        }

        try {
          let detail = await fetchChannelTemplate(preferredId);
          if (cancelled) return;

          // Row saved before structured fields existed: repair from legacy HTML.
          const legacy = navCards.find(
            (t) => t.template_id === preferredId && t.preview,
          );
          if (isEmptyTemplateFields(detail.template.fields) && legacy) {
            try {
              await syncSessionChannelTemplates(sessionDraftId, [legacy]);
              detail = await fetchChannelTemplate(preferredId);
              if (cancelled) return;
            } catch {
              /* keep the unrepaired row */
            }
          }

          setTemplate(detail.template);
          setMessages((current) =>
            mergeEditChatPreferRicher(
              current,
              ensureTemplateSeedRow(
                toEditChatRows(
                  detail.messages,
                  detail.template.preview || legacy?.preview,
                ),
                detail.template,
              ),
            ),
          );
          setError(null);
        } catch {
          // Last chance: sync this one card, then refetch; else session fallback.
          const card =
            source.find((t) => t.template_id === preferredId) || initial;
          if (card) {
            try {
              await syncSessionChannelTemplates(sessionDraftId, [card]);
              const detail = await fetchChannelTemplate(preferredId);
              if (cancelled) return;
              setTemplate(detail.template);
              setMessages((current) =>
                mergeEditChatPreferRicher(
                  current,
                  ensureTemplateSeedRow(
                    toEditChatRows(detail.messages, detail.template.preview),
                    detail.template,
                  ),
                ),
              );
              setError(null);
              return;
            } catch {
              /* fall through */
            }
            setTemplate(card);
            setMessages((current) =>
              mergeEditChatPreferRicher(
                current,
                toEditChatRows(syntheticEditMessages(card), card.preview),
              ),
            );
            setError(null);
          } else {
            setError("Template not found in database.");
          }
        }
      } catch (err) {
        if (cancelled) return;
        if (initial) {
          setTemplate(initial);
          setMessages((current) =>
            mergeEditChatPreferRicher(
              current,
              toEditChatRows(syntheticEditMessages(initial), initial.preview),
            ),
          );
          setError(null);
        } else {
          setError(
            err instanceof Error
              ? err.message
              : "Could not load template from database.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, templateId, channelParam]);

  useEffect(() => {
    if (!draftId || !activeTemplateId) return;
    const token = getToken();
    const socket = getAgentsSocket();

    const onReady = (payload: {
      session_id?: string;
      template?: TemplateCard;
      templates?: TemplateCard[];
      messages?: TemplateEditMessage[];
      campaign?: { name?: string; goal?: string; objective?: string };
      agent_busy?: boolean;
    }) => {
      if (payload.session_id !== draftId) return;
      if (payload.templates?.length) {
        setAllTemplates(payload.templates);
      }
      if (payload.campaign) {
        setCampaign((current) => ({
          name: payload.campaign?.name || current.name,
          goal: payload.campaign?.goal || current.goal,
          objective: payload.campaign?.objective || current.objective,
        }));
      }
      if (
        payload.template &&
        payload.template.template_id === activeTemplateId
      ) {
        setTemplate((prev) =>
          mergeTemplateCard(prev, payload.template!),
        );
        if (payload.messages) {
          const incoming = ensureTemplateSeedRow(
            toEditChatRows(payload.messages, payload.template.preview),
            payload.template,
          );
          // Never shrink chat — race with HTTP load or mid-turn optimistic rows.
          setMessages((current) =>
            mergeEditChatPreferRicher(current, incoming),
          );
        }
        if (payload.agent_busy) {
          setTyping(true);
          setEditProgressLabel((cur) => cur || "Working on this template…");
        }
        setLoading(false);
      }
    };

    const onUpdated = (payload: {
      session_id?: string;
      template_id?: string;
      template?: TemplateCard;
    }) => {
      if (payload.session_id !== draftId) return;
      if (payload.template_id && payload.template_id !== activeTemplateId) {
        return;
      }
      if (!payload.template) return;
      if (payload.template.template_id !== activeTemplateId) return;
      setTemplate((prev) => mergeTemplateCard(prev, payload.template!));
      setAllTemplates((current) => {
        const next = [...current];
        const index = next.findIndex(
          (item) => item.template_id === payload.template?.template_id,
        );
        const merged = mergeTemplateCard(
          index >= 0 ? next[index]! : null,
          payload.template!,
        );
        if (index >= 0) next[index] = merged;
        else next.push(merged);
        return next;
      });
      if (draftId && payload.template.template_id && payload.template.fields) {
        void persistTemplateEditToDraftAndSession(
          draftId,
          payload.template.template_id,
          payload.template.fields as Record<string, unknown>,
          {
            channel: payload.template.channel,
            logo: payload.template.logo,
            launch_at: payload.template.launch_at,
            how_it_works: payload.template.how_it_works,
            generation_batch_id: payload.template.generation_batch_id,
          },
        );
      }
    };

    const onAgentMessage = (payload: {
      session_id?: string;
      template_id?: string;
      text?: string;
      template_changed?: boolean;
      fields?: TemplateFields | null;
    }) => {
      if (payload.session_id !== draftId) return;
      if (payload.template_id && payload.template_id !== activeTemplateId) {
        return;
      }
      // Live preview is on the right — chat keeps dynamic text only.
      if (payload.text) {
        const row: ChatRow = {
          id: `txt-${Date.now()}`,
          role: "assistant",
          kind: "text",
          text: payload.text,
        };
        setMessages((current) => [...current, row]);
        setAbExtra((current) => {
          const letter = abVariantRef.current;
          return { ...current, [letter]: [...current[letter], row] };
        });
      }
      if (payload.template_changed && payload.fields) {
        setTemplate((prev) => {
          if (!prev) return prev;
          const merged = mergeTemplateFields(
            (prev.fields || {}) as Record<string, unknown>,
            payload.fields as Record<string, unknown>,
          );
          return { ...prev, fields: merged as TemplateFields };
        });
        setAllTemplates((current) => {
          const next = [...current];
          const index = next.findIndex(
            (item) => item.template_id === activeTemplateId,
          );
          if (index < 0) return current;
          const card = next[index]!;
          const merged = mergeTemplateFields(
            (card.fields || {}) as Record<string, unknown>,
            payload.fields as Record<string, unknown>,
          );
          next[index] = {
            ...card,
            fields: merged as TemplateFields,
          };
          return next;
        });
        if (draftId && activeTemplateId) {
          void persistTemplateEditToDraftAndSession(
            draftId,
            activeTemplateId,
            payload.fields as Record<string, unknown>,
          );
        }
      }
      setTyping(false);
      setEditProgressLabel(null);
    };

    const onTyping = (payload: {
      session_id?: string;
      template_id?: string;
      typing?: boolean;
    }) => {
      if (payload.session_id !== draftId) return;
      if (payload.template_id && payload.template_id !== activeTemplateId) {
        return;
      }
      const next = Boolean(payload.typing);
      setTyping(next);
      if (next) {
        setError(null);
        setEditProgressLabel((cur) => cur || "Working on this template…");
      } else {
        setEditProgressLabel(null);
      }
    };

    const onError = (payload: { message?: string; chat_context?: string }) => {
      // Ignore create-chat errors that land on the shared socket while editing.
      if (payload.chat_context && payload.chat_context !== "edit") return;
      const msg = payload.message || "Template edit failed.";
      // Don't blank a loaded compose preview over a lookup race.
      if (
        /template not found/i.test(msg) &&
        (templateRef.current?.fields || templateRef.current?.template_id)
      ) {
        return;
      }
      setError(msg);
      setTyping(false);
      setEditProgressLabel(null);
    };

    const onStopped = (payload: { session_id?: string }) => {
      if (payload.session_id !== draftId) return;
      setTyping(false);
      setEditProgressLabel(null);
    };

    const onState = (payload: {
      session_id?: string;
      state?: {
        launch_confirmed?: boolean;
        stage?: string;
        campaign_id?: string | null;
      };
    }) => {
      if (payload.session_id !== draftId) return;
      if (payload.state?.launch_confirmed) {
        setLaunchStatus("Scheduled — visible under Campaign monitoring → Scheduled");
      } else if (payload.state?.stage === "launch_plan") {
        setLaunchStatus("Launch plan set — confirm to schedule");
      }
    };

    const applyPreviewFields = (
      tid: string,
      fields: Record<string, unknown>,
    ) => {
      setTemplate((prev) => {
        if (!prev || prev.template_id !== tid) return prev;
        const merged = mergeTemplateFields(
          (prev.fields || {}) as Record<string, unknown>,
          fields,
        );
        if (draftId) {
          void persistTemplateEditToDraftAndSession(draftId, tid, merged);
        }
        return { ...prev, fields: merged as TemplateFields };
      });
      setAllTemplates((current) => {
        const next = [...current];
        const index = next.findIndex((item) => item.template_id === tid);
        if (index < 0) return current;
        const card = next[index]!;
        const merged = mergeTemplateFields(
          (card.fields || {}) as Record<string, unknown>,
          fields,
        );
        next[index] = { ...card, fields: merged as TemplateFields };
        return next;
      });
    };

    const onUi = (payload: ImageUiEventEnvelope) => {
      if (payload.session_id && payload.session_id !== draftId) return;
      const eventTid = String(
        payload.template_id ||
          unwrapImageUiPayload(payload).template_id ||
          "",
      ).trim();
      if (
        eventTid &&
        activeTemplateId &&
        eventTid !== activeTemplateId
      ) {
        return;
      }
      if (payload.type === "template_progress") {
        const nested = unwrapImageUiPayload(payload);
        const label = String(nested.label || "").trim();
        if (label) setEditProgressLabel(label);
        return;
      }
      if (
        payload.type !== "template_image_attached" &&
        payload.type !== "image_generated" &&
        payload.type !== "image_refined" &&
        payload.type !== "template_fields_updated"
      ) {
        return;
      }
      applyTemplateFieldsFromImageUiEvent(payload.type, payload, {
        fallbackChannel: activeChannel,
        restrictTemplateId: activeTemplateId,
        defaultTemplateId: activeTemplateId,
        applyTemplateFields: applyPreviewFields,
        fetchTemplateFields: async (tid) => {
          const { template: tpl } = await fetchChannelTemplate(tid);
          return tpl?.fields ?? null;
        },
      });
    };

    const onThinking = (payload: {
      session_id?: string;
      template_id?: string;
      payload?: { steps?: Array<{ label?: string }> };
      label?: string;
    }) => {
      if (payload.session_id && payload.session_id !== draftId) return;
      if (payload.template_id && payload.template_id !== activeTemplateId) {
        return;
      }
      const steps = payload.payload?.steps;
      const fromStep =
        Array.isArray(steps) && steps[0]
          ? String(steps[0].label || "").trim()
          : "";
      const label = fromStep || String(payload.label || "").trim();
      if (label) setEditProgressLabel(label);
    };

    socket.on("editor_ready", onReady);
    socket.on("template_updated", onUpdated);
    socket.on("edit_agent_message", onAgentMessage);
    socket.on("edit_agent_typing", onTyping);
    socket.on("generation_stopped", onStopped);
    socket.on("state_update", onState);
    socket.on("ui_event", onUi);
    socket.on("thinking_progress", onThinking);
    socket.on("error", onError);
    socket.emit("open_template_editor", {
      session_id: draftId,
      token,
      channel: activeChannel,
      template_id: activeTemplateId,
    });

    return () => {
      socket.off("editor_ready", onReady);
      socket.off("template_updated", onUpdated);
      socket.off("edit_agent_message", onAgentMessage);
      socket.off("edit_agent_typing", onTyping);
      socket.off("generation_stopped", onStopped);
      socket.off("state_update", onState);
      socket.off("ui_event", onUi);
      socket.off("thinking_progress", onThinking);
      socket.off("error", onError);
    };
  }, [draftId, activeTemplateId, activeChannel]);

  const openManualEdit = async () => {
    if (!activeTemplateId || openingManualEdit) return;
    setOpeningManualEdit(true);
    try {
      const detail = await fetchChannelTemplate(activeTemplateId);
      if (detail?.template) {
        setTemplate((prev) => {
          const incoming = detail.template;
          if (
            prev?.template_id &&
            incoming.template_id &&
            prev.template_id !== incoming.template_id
          ) {
            return incoming;
          }
          return prev ? { ...prev, ...incoming } : incoming;
        });
        setAllTemplates((current) => {
          const index = current.findIndex(
            (item) => item.template_id === activeTemplateId,
          );
          if (index < 0) return current;
          const next = [...current];
          next[index] = {
            ...next[index]!,
            ...detail.template,
            fields: detail.template.fields ?? next[index]!.fields,
          };
          return next;
        });
      }
      setManualEdit(true);
    } catch {
      setManualEdit(true);
    } finally {
      setOpeningManualEdit(false);
    }
  };

  const switchChannel = (next: TemplateCard) => {
    if (!draftId) return;
    if (next.template_id === activeTemplateId) return;
    navigate(`/campaigns/create/${draftId}/templates/${next.template_id}`, {
      replace: true,
      state: {
        template: next,
        templates: allTemplates,
        campaign,
        listHref: navState?.listHref,
      },
    });
  };

  const sendEdit = (opts?: {
    text?: string;
    chat_image_uploads?: Array<{
      image_url: string;
      media_id?: string;
      filename?: string;
      source?: string;
    }>;
    imageUrl?: string;
    imageFilename?: string;
  }) => {
    const text = (opts?.text ?? input).trim();
    const uploads = opts?.chat_image_uploads || [];
    if ((!text && !uploads.length) || !template || !draftId || !activeTemplateId) {
      return;
    }
    if (typing) {
      setToast("Please wait for the current agent response.");
      window.setTimeout(() => setToast(null), 2200);
      return;
    }
    const displayText = text;
    // Image-only: show mini preview with no canned caption; agent sees chat_image_uploads.
    if (!displayText && !uploads.length) return;
    const rowImages = uploads.length
      ? chatImagesFromUploads(uploads)
      : opts?.imageUrl
        ? [{ url: opts.imageUrl, filename: opts.imageFilename }]
        : [];
    const userRow: ChatRow = {
      id: `user-${Date.now()}`,
      role: "user",
      kind: "text",
      text: displayText,
      ...(rowImages.length
        ? {
            imageUrls: rowImages,
            imageUrl: rowImages[0].url,
            imageFilename: rowImages[0].filename,
          }
        : {}),
    };
    setMessages((current) => [...current, userRow]);
    setAbExtra((current) => ({
      ...current,
      [abVariant]: [...current[abVariant], userRow],
    }));
    setInput("");
    setError(null);
    setTyping(true);
    setEditProgressLabel("Working on this template…");
    const emailAb = hasEmailAb((template.fields || {}) as TemplateFields);
    getAgentsSocket().emit("template_edit_message", {
      session_id: draftId,
      token: getToken(),
      channel: template.channel,
      template_id: activeTemplateId,
      text: emailAb
        ? `[Variant ${abVariant.toUpperCase()}] ${displayText}`.trim()
        : displayText,
      ...(uploads.length ? { chat_image_uploads: uploads } : {}),
    });
  };

  const onPickEditImage = (fileList: FileList | null) => {
    const files = Array.from(fileList || []);
    setAttachOpen(false);
    if (imageInputRef.current) imageInputRef.current.value = "";
    if (!files.length || !template || !draftId || !activeTemplateId) return;
    if (typing) {
      setToast("Wait for the current reply, then upload the image.");
      window.setTimeout(() => setToast(null), 2200);
      return;
    }
    for (const file of files) {
      const previewUrl = URL.createObjectURL(file);
      setPendingImages((cur) => [
        ...cur,
        { previewUrl, filename: file.name },
      ]);
      const uploadPromise = uploadTemplateImageAsset(file);
      pendingUploadsRef.current.set(previewUrl, uploadPromise);
      void uploadPromise
        .then((uploaded) => {
          setPendingImages((cur) =>
            cur.map((row) =>
              row.previewUrl === previewUrl
                ? {
                    ...row,
                    imageUrl: uploaded.url,
                    mediaId: uploaded.media_id,
                  }
                : row,
            ),
          );
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : "Image upload failed");
          if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
          pendingUploadsRef.current.delete(previewUrl);
          setPendingImages((cur) =>
            cur.filter((row) => row.previewUrl !== previewUrl),
          );
        });
    }
  };

  const sendWithPendingImage = () => {
    const pending = [...pendingImages];
    const caption = input.trim();
    if (!pending.length && !caption) return;
    if (typing) return;
    if (!template || !draftId || !activeTemplateId) return;

    const text = caption.trim();
    const first = pending[0];
    const filename = first?.filename || "image";
    const previewBlobs = pending
      .map((p) => (p.previewUrl?.startsWith("blob:") ? p.previewUrl : ""))
      .filter(Boolean);
    const optimisticImages = chatImagesFromPending(pending);
    if (!text && !optimisticImages.length) return;

    const userRowId = `user-${Date.now()}`;
    const userRow: ChatRow = {
      id: userRowId,
      role: "user",
      kind: "text",
      text,
      ...(optimisticImages.length
        ? {
            imageUrls: optimisticImages,
            imageUrl: optimisticImages[0].url,
            imageFilename: optimisticImages[0].filename || filename,
          }
        : {}),
    };
    setMessages((current) => [...current, userRow]);
    setAbExtra((current) => ({
      ...current,
      [abVariant]: [...current[abVariant], userRow],
    }));
    setInput("");
    const uploadMap = pendingUploadsRef.current;
    setPendingImages([]);
    pendingUploadsRef.current = new Map();
    setError(null);
    setTyping(true);
    setEditProgressLabel("Working on this template…");
    setToast(null);

    void (async () => {
      const uploads: Array<{
        image_url: string;
        media_id?: string;
        filename?: string;
        source?: string;
      }> = [];
      try {
        for (const item of pending) {
          const resolved = await resolvePendingChatImageUpload({
            imageUrl: item.imageUrl,
            mediaId: item.mediaId,
            previewUrl: item.previewUrl,
            filename: item.filename || "image",
            uploadPromise: uploadMap.get(item.previewUrl),
          });
          uploads.push({
            image_url: resolved.url,
            media_id: resolved.media_id || undefined,
            filename: item.filename || "image",
            source: "edit_chat_upload",
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Image upload failed");
        setTyping(false);
        setEditProgressLabel(null);
        for (const blob of previewBlobs) URL.revokeObjectURL(blob);
        return;
      }

      const resolvedImages = chatImagesFromUploads(uploads);
      const firstUrl = resolvedImages[0]?.url || "";
      if (resolvedImages.length && firstUrl) {
        const patch = (row: ChatRow): ChatRow =>
          row.id === userRowId
            ? {
                ...row,
                imageUrls: resolvedImages,
                imageUrl: firstUrl,
                imageFilename: resolvedImages[0]?.filename || filename,
              }
            : row;
        setMessages((current) => current.map(patch));
        setAbExtra((current) => ({
          ...current,
          [abVariant]: (current[abVariant] || []).map(patch),
        }));
      }
      for (const blob of previewBlobs) URL.revokeObjectURL(blob);

      if (!text && !uploads.length) {
        setTyping(false);
        return;
      }

      const emailAb = hasEmailAb((template.fields || {}) as TemplateFields);
      getAgentsSocket().emit("template_edit_message", {
        session_id: draftId,
        token: getToken(),
        channel: template.channel,
        template_id: activeTemplateId,
        text: emailAb
          ? `[Variant ${abVariant.toUpperCase()}] ${text}`.trim()
          : text,
        ...(uploads.length ? { chat_image_uploads: uploads } : {}),
      });
    })();
  };

  const stopGeneration = () => {
    if (!draftId) return;
    getAgentsSocket().emit("stop_generation", {
      session_id: draftId,
      chat_context: "edit",
      template_id: activeTemplateId || "",
    });
    setTyping(false);
  };

  const chatTextMessages = useMemo(
    () => messages.filter((m) => m.kind === "text"),
    [messages],
  );

  const liveFields = (template?.fields || {}) as TemplateFields;
  const liveHtml = String(
    (liveFields.compiled_html as string | undefined) ||
      (liveFields.html as string | undefined) ||
      template?.preview ||
      "",
  ).trim();
  const emailAb = hasEmailAb(liveFields);
  const chatTitle = emailAb
    ? `Template ${abVariant.toUpperCase()} chat`
    : "Template chat";
  const visibleChat = useMemo(
    () => visibleEditChatRows(messages),
    [messages],
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {manualEdit && template ? (
        hasComposeCompiledHtml(template.fields as TemplateFields) ? (
          <ComposeHtmlManualEditWorkspace
            template={
              draftId
                ? { ...template, session_id: template.session_id || draftId }
                : template
            }
            campaignTitle={campaignTitle}
            baseFields={(template.fields || {}) as TemplateFields}
            onBackToAi={() => setManualEdit(false)}
            onSaved={(next) => {
              setTemplate(next);
              setAllTemplates((prev) =>
                prev.map((t) =>
                  t.template_id === next.template_id ? { ...t, ...next } : t,
                ),
              );
              if (draftId && next.template_id && next.fields) {
                void persistTemplateEditToDraftAndSession(
                  draftId,
                  next.template_id,
                  next.fields as Record<string, unknown>,
                  {
                    channel: next.channel,
                    logo: next.logo,
                    launch_at: next.launch_at,
                    how_it_works: next.how_it_works,
                    generation_batch_id: next.generation_batch_id,
                  },
                );
              }
            }}
          />
        ) : (
        <TemplateManualEditWorkspace
          template={
            draftId
              ? { ...template, session_id: template.session_id || draftId }
              : template
          }
          campaignTitle={campaignTitle}
          campaign={campaign}
          ideaChat={chatTextMessages.map((m) => ({
            role: m.role,
            text: m.text,
          }))}
          abVariant={abVariant}
          onAbVariantChange={setAbVariant}
          onBackToAi={() => setManualEdit(false)}
          onSaved={(next) => {
            setTemplate(next);
            setAllTemplates((prev) =>
              prev.map((t) =>
                t.template_id === next.template_id ? { ...t, ...next } : t,
              ),
            );
            if (draftId && next.template_id && next.fields) {
              void persistTemplateEditToDraftAndSession(
                draftId,
                next.template_id,
                next.fields as Record<string, unknown>,
                {
                  channel: next.channel,
                  logo: next.logo,
                  launch_at: next.launch_at,
                  how_it_works: next.how_it_works,
                  generation_batch_id: next.generation_batch_id,
                },
              );
            }
          }}
        />
        )
      ) : (
      <ModuleSplitWorkspace
        leftFr={40}
        leftTitle={chatTitle}
        rightTitle="Live template"
        rightHeaderActions={
          <Button
            type="button"
            variant="secondary"
            className="h-7 px-2.5 text-xs"
            disabled={!template || openingManualEdit}
            onClick={() => void openManualEdit()}
          >
            {openingManualEdit ? "Loading…" : "Edit template"}
          </Button>
        }
        toolbar={
          <>
            <header className="rounded-2xl border border-neutral-200 bg-white px-3 py-3 shadow-sm sm:px-4">
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg hover:bg-state-hover"
                  onClick={() => navigate(editorReturnHref(draftId, navState))}
                  aria-label="Back"
                >
                  <ArrowLeft className="size-5" strokeWidth={1.75} />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold text-text-primary">
                    {campaignTitle}
                  </p>
                  <p className="truncate text-sm text-text-caption">
                    Primary Goal: {campaignGoal}
                  </p>
                  {channelTabs.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {channelTabs.map((card) => {
                        const active = card.template_id === activeTemplateId;
                        return (
                          <button
                            key={card.template_id}
                            type="button"
                            onClick={() => switchChannel(card)}
                            className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors ${
                              active
                                ? "border-neutral-900 bg-neutral-900 text-white"
                                : "border-border-default bg-surface text-text-secondary hover:bg-subtle"
                            }`}
                          >
                            {card.channel}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </div>
            </header>
            {launchStatus ? (
              <p
                className="mt-2 rounded-xl border border-border-default bg-white px-4 py-2 text-sm text-text-primary"
                role="status"
              >
                {launchStatus}
              </p>
            ) : null}
          </>
        }
        left={
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="chat-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {loading && visibleChat.length === 0 ? (
                <CampaignTemplateEditSkeleton variant="chat" />
              ) : null}

              {visibleChat.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-5 whitespace-pre-wrap ${
                      message.role === "user"
                        ? "rounded-br-md bg-neutral-900 text-white"
                        : "rounded-tl-md border border-border-default bg-surface text-text-secondary"
                    }`}
                  >
                    {resolveChatMessageImages(message).length ? (
                      <ChatBubbleImageStrip
                        images={resolveChatMessageImages(message)}
                        variant="edit-user"
                      />
                    ) : null}
                    {message.text}
                  </div>
                </div>
              ))}

              {!loading && visibleChat.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border-default bg-surface px-4 py-10 text-center text-sm text-text-caption">
                  Ask for changes — the live template updates on the right.
                </div>
              ) : null}

              {typing ? (
                <AgentThinkingIndicator
                  label={editProgressLabel || "Working on this template…"}
                />
              ) : null}

              {error ? (
                <p className="text-sm text-text-danger" role="alert">
                  {error}
                </p>
              ) : null}
              <div ref={bottomRef} />
            </div>

            <AgentChatComposer
              value={input}
              onChange={setInput}
              onSend={() => {
                if (pendingImages.length) sendWithPendingImage();
                else sendEdit();
              }}
              busy={typing}
              onStop={stopGeneration}
              disabled={!template}
              placeholder={
                template
                  ? "Describe the change you want"
                  : "Template will appear when ready"
              }
              busyPlaceholder="Type next change…"
              className="shrink-0 px-3 pb-4 pt-2"
              maxWidthClass=""
              pendingImages={pendingImages}
              onRemovePendingImage={(index) => {
                const row = pendingImages[index];
                if (row?.previewUrl?.startsWith("blob:")) {
                  URL.revokeObjectURL(row.previewUrl);
                }
                if (row?.previewUrl) {
                  pendingUploadsRef.current.delete(row.previewUrl);
                }
                setPendingImages((cur) => cur.filter((_, i) => i !== index));
              }}
              leading={
                <div className="relative shrink-0" ref={attachRef}>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => onPickEditImage(e.target.files)}
                  />
                  <button
                    type="button"
                    onClick={() => setAttachOpen((v) => !v)}
                    disabled={!template || typing}
                    className="inline-flex size-9 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Add attachment"
                    aria-expanded={attachOpen}
                  >
                    <Plus className="size-5" strokeWidth={1.75} />
                  </button>
                  {attachOpen ? (
                    <div className="absolute bottom-full left-0 z-20 mb-2 w-44 overflow-hidden rounded-xl border border-border-default bg-surface shadow-lg">
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-text-body hover:bg-surface-muted"
                        onClick={() => imageInputRef.current?.click()}
                      >
                        <ImageIcon className="size-4 shrink-0" strokeWidth={1.75} />
                        Upload image
                      </button>
                    </div>
                  ) : null}
                </div>
              }
              trailing={
                <button
                  type="button"
                  disabled
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 disabled:opacity-50"
                  aria-label="Voice input"
                  title="Voice coming soon"
                >
                  <Mic className="size-4" strokeWidth={1.75} />
                </button>
              }
            />
            {toast ? (
              <p className="px-3 pb-2 text-xs text-text-caption">{toast}</p>
            ) : null}
          </div>
        }
        right={
          <div className="chat-scroll-xs flex h-full min-h-0 flex-1 flex-col overflow-y-auto p-4">
            <p className="shrink-0 text-xs capitalize text-text-caption">
              {activeChannel || "channel"} preview
            </p>
            <div className="mt-4 min-h-0 flex-1">
              {loading && !template ? (
                <CampaignTemplateEditSkeleton variant="preview" />
              ) : template ? (
                <ChannelTemplatePreview
                  channel={activeChannel || "email"}
                  fields={liveFields}
                  html={liveHtml || undefined}
                  abVariant={abVariant}
                  onAbVariantChange={setAbVariant}
                />
              ) : (
                <p className="text-sm text-text-caption">No template loaded.</p>
              )}
            </div>
          </div>
        }
      />
      )}
    </div>
  );
}
