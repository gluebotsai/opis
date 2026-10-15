import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { WorkspaceChannelIcon } from "@/components/workspace/workspace-channel-icon";
import { useNavigate } from "react-router";
import {
  WORKSPACE_PRESENCE_UPDATED,
  WORKSPACE_VOICE_OPENED,
  workspaceApi,
  type PresenceState,
} from "@/features/workspace/api";
import { incomingOfferReducer } from "@/features/workspace/incoming-offer-snapshot";
import { useAgentOfferRing } from "@/features/workspace/use-agent-offer-ring";
import { useAgentPresence } from "@/features/workspace/use-agent-presence";
import { useWorkspaceSocket } from "@/features/workspace/use-workspace-socket";
import { useSipCallStatus } from "@/features/voice/use-sip-call-status";
import { notifyPresenceUpdated } from "@/features/workspace/presence-session";
import type { WorkspaceConversation } from "@/features/workspace/types";
import { incomingOfferTitle, isVoiceChannel } from "@/features/workspace/workspace-utils";
import {
  acceptInboundSipCall,
  getSipCallStatus,
  markConsultConversationOwned,
  markConsultMerged,
  notifyInboundConsultAnswered,
  rejectInboundSipCall,
  setInboundOfferAudible,
  setSipAcdCallContext,
} from "@/features/voice/sip-ua";
import {
  isRealAcdSessionId,
  sameVoiceSessionId,
  shouldApplyVoiceOpenedEvent,
  shouldHoldConsultWorkspace,
  shouldOpenWorkspaceOnAcdEvent,
} from "@/features/voice/voice-workspace-open";
import {
  clearPendingVoiceConsultWorkspace,
  getPendingVoiceConsultWorkspace,
  rememberInboundVoiceConsultSession,
  rememberVoiceConsultOffer,
} from "@/features/voice/voice-consult-workspace";
import { persistWorkspaceSelection } from "@/features/workspace/workspace-session";
import type { AuthUser } from "@/types/auth";

const VOICE_RECOVERY_DELAYS_MS = [0, 250, 750, 1_500, 3_000, 5_000, 8_000, 12_000];
const PENDING_VOICE_EVENT_TTL_MS = 60_000;

function isVoiceTransferOffer(conversation: WorkspaceConversation | null): boolean {
  return Boolean(
    conversation &&
      isVoiceChannel(conversation.channel) &&
      (conversation.transfer?.fromUserId ||
        conversation.transfer?.fromAgentId ||
        conversation.transfer?.state === "offered"),
  );
}

export function WorkspaceGlobalOffer({ user }: { user: AuthUser }) {
  const navigate = useNavigate();
  const { presenceState } = useAgentPresence();
  const sip = useSipCallStatus();
  const [offer, setOffer] = useState<WorkspaceConversation | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingVoiceCall, setPendingVoiceCall] = useState<{
    conversation: WorkspaceConversation;
    sessionId: string | null;
    receivedAt: number;
    acdUserAccepted?: boolean;
  } | null>(null);
  const pendingVoiceCallRef = useRef<typeof pendingVoiceCall>(null);
  const openedVoiceSessionRef = useRef<string | null>(null);
  const recoveryRef = useRef<{ generation: number; sessionId: string } | null>(null);
  const recoveryGenerationRef = useRef(0);
  const canReceiveOffers = presenceState === "ready";
  const sipInboundOffer = sip.inboundOffer && sip.callState === "ringing";
  const offerGenerationRef = useRef(0);
  const liveOfferGenerationRef = useRef(0);
  const [offerSnapshot, dispatchOffer] = useReducer(incomingOfferReducer, null);
  const workspacePath = user.role === "admin" ? "/admin/workspace" : "/agent/workspace";

  const openWorkspaceForCall = useCallback(
    (
      conversation: WorkspaceConversation,
      sessionId: string,
      reason: string,
    ) => {
      if (!isRealAcdSessionId(sessionId)) return;
      const conversationId = conversation.id;
      console.info("[voice][workspace] open.requested", {
        reason,
        conversationId,
        sessionId,
        sipState: getSipCallStatus().callState,
        path: `${workspacePath}?conversationId=${conversationId}`,
      });
      setSipAcdCallContext(sessionId, conversationId);
      openedVoiceSessionRef.current = sessionId;
      persistWorkspaceSelection(conversationId);
      navigate(`${workspacePath}?conversationId=${conversationId}`);
      window.dispatchEvent(
        new CustomEvent(WORKSPACE_VOICE_OPENED, {
          detail: {
            conversation,
            sessionId,
          },
        }),
      );
      console.info("[voice][workspace] open.completed", {
        reason,
        conversationId,
        sessionId,
      });
    },
    [navigate, workspacePath],
  );

  const openPendingAcdWorkspace = useCallback((reason: string) => {
    const current = getSipCallStatus();
    const pending =
      pendingVoiceCallRef.current ?? getPendingVoiceConsultWorkspace();
    const acdUserAccepted =
      pending != null &&
      "acdUserAccepted" in pending &&
      (pending as { acdUserAccepted?: boolean }).acdUserAccepted === true;
    if (
      shouldHoldConsultWorkspace({ secondaryConsultOnly: current.secondaryConsultOnly }) ||
      !shouldOpenWorkspaceOnAcdEvent({
        callState: current.callState,
        inboundOffer: current.inboundOffer,
        direction:
          current.direction ??
          (pending?.conversation.direction === "outbound" ? "outbound" : current.direction),
        acdUserAccepted,
      })
    ) {
      return;
    }
    const sessionId = isRealAcdSessionId(current.acdSessionId)
      ? current.acdSessionId
      : pending?.sessionId;
    if (!pending || !isRealAcdSessionId(sessionId)) return;
    if (Date.now() - pending.receivedAt > PENDING_VOICE_EVENT_TTL_MS) {
      pendingVoiceCallRef.current = null;
      setPendingVoiceCall(null);
      return;
    }
    if (
      isRealAcdSessionId(current.acdSessionId) &&
      !sameVoiceSessionId(current.acdSessionId, sessionId)
    ) {
      pendingVoiceCallRef.current = null;
      setPendingVoiceCall(null);
      return;
    }
    if (sameVoiceSessionId(openedVoiceSessionRef.current, sessionId)) return;
    openWorkspaceForCall(pending.conversation, sessionId, reason);
    clearPendingVoiceConsultWorkspace(pending.conversation.id);
    pendingVoiceCallRef.current = null;
    setPendingVoiceCall(null);
  }, [openWorkspaceForCall]);

  const recoverAcdWorkspace = useCallback((reason: string) => {
    const current = getSipCallStatus();
    const sessionId = current.acdSessionId;
    const recoveryKey = isRealAcdSessionId(sessionId) ? sessionId : null;
    if (
      !recoveryKey ||
      shouldHoldConsultWorkspace({ secondaryConsultOnly: current.secondaryConsultOnly }) ||
      !shouldOpenWorkspaceOnAcdEvent({
        callState: current.callState,
        inboundOffer: current.inboundOffer,
        direction: current.direction,
      }) ||
      (isRealAcdSessionId(sessionId) &&
        sameVoiceSessionId(openedVoiceSessionRef.current, sessionId))
    ) {
      return;
    }
    if (
      recoveryRef.current &&
      recoveryRef.current.sessionId === recoveryKey
    ) {
      return;
    }

    const generation = ++recoveryGenerationRef.current;
    recoveryRef.current = { generation, sessionId: recoveryKey };
    console.info("[voice][workspace] recovery.started", {
      reason,
      sessionId,
      callState: current.callState,
    });

    void (async () => {
      let lastError: unknown = null;
      try {
        for (const [attemptIndex, delay] of VOICE_RECOVERY_DELAYS_MS.entries()) {
          if (delay > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, delay));
          }
          if (recoveryGenerationRef.current !== generation) return;
          if (
            isRealAcdSessionId(sessionId) &&
            sameVoiceSessionId(openedVoiceSessionRef.current, sessionId)
          ) return;

          const latest = getSipCallStatus();
          if (
            !isRealAcdSessionId(sessionId) ||
            !sameVoiceSessionId(latest.acdSessionId, sessionId) ||
            shouldHoldConsultWorkspace({ secondaryConsultOnly: latest.secondaryConsultOnly }) ||
            !shouldOpenWorkspaceOnAcdEvent({
              callState: latest.callState,
              inboundOffer: latest.inboundOffer,
              direction: latest.direction,
            })
          ) {
            return;
          }

          try {
            console.info("[voice][workspace] recovery.attempt", {
              reason,
              sessionId,
              attempt: attemptIndex + 1,
              callState: latest.callState,
            });
            const linked = await workspaceApi.ensureVoiceCall({
              sessionId: isRealAcdSessionId(sessionId) ? sessionId : null,
              destination: latest.destination,
            });
            if (
              isRealAcdSessionId(sessionId) &&
              !sameVoiceSessionId(linked.sessionId, sessionId)
            ) {
              console.warn("[voice][workspace] recovery.session-mismatch", {
                reason,
                expectedSessionId: sessionId,
                linkedSessionId: linked.sessionId,
                conversationId: linked.conversation.id,
              });
              continue;
            }
            if (recoveryGenerationRef.current !== generation) return;
            if (
              isRealAcdSessionId(sessionId) &&
              sameVoiceSessionId(openedVoiceSessionRef.current, sessionId)
            ) return;
            const confirmed = getSipCallStatus();
            if (
              !isRealAcdSessionId(sessionId) ||
              !sameVoiceSessionId(confirmed.acdSessionId, sessionId) ||
              shouldHoldConsultWorkspace({ secondaryConsultOnly: confirmed.secondaryConsultOnly }) ||
              !shouldOpenWorkspaceOnAcdEvent({
                callState: confirmed.callState,
                inboundOffer: confirmed.inboundOffer,
                direction: confirmed.direction,
              })
            ) {
              return;
            }
            openWorkspaceForCall(
              linked.conversation,
              linked.sessionId,
              `${reason}-session-recovery`,
            );
            console.info("[voice][workspace] recovery.succeeded", {
              reason,
              sessionId: linked.sessionId,
              conversationId: linked.conversation.id,
              attempt: attemptIndex + 1,
            });
            pendingVoiceCallRef.current = null;
            setPendingVoiceCall(null);
            return;
          } catch (error) {
            lastError = error;
            console.warn("[voice][workspace] recovery.attempt-failed", {
              reason,
              sessionId,
              attempt: attemptIndex + 1,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        console.error("[voice][workspace] recovery.timed-out", {
          reason,
          sessionId,
          error: lastError instanceof Error ? lastError.message : String(lastError ?? ""),
        });
      } finally {
        if (recoveryRef.current?.generation === generation) {
          recoveryRef.current = null;
        }
      }
    })();
  }, [openWorkspaceForCall]);

  useAgentOfferRing(Boolean(offerSnapshot?.playLocalRing));

  useEffect(() => {
    const generation = ++offerGenerationRef.current;
    if (sipInboundOffer) {
      liveOfferGenerationRef.current = generation;
      dispatchOffer({
        type: "sip",
        active: true,
        id: sip.acdSessionId ?? "sip-offer",
        generation,
      });
      setInboundOfferAudible(true);
      return;
    }
    setInboundOfferAudible(false);
    if (offer && canReceiveOffers && !isVoiceTransferOffer(offer)) {
      dispatchOffer({ type: "digital", conversation: offer, generation });
      return;
    }
    dispatchOffer({ type: "clear", generation });
  }, [canReceiveOffers, offer, sip.acdSessionId, sipInboundOffer]);

  useEffect(() => {
    if (!canReceiveOffers) {
      setOffer((current) => (isVoiceTransferOffer(current) ? current : null));
      return;
    }
    const seen = liveOfferGenerationRef.current;
    void workspaceApi
      .listConversationSummaries()
      .then((items) => {
        if (liveOfferGenerationRef.current !== seen) return;
        const generation = ++offerGenerationRef.current;
        const hydrated =
          items.find(
            (item) => item.offerPending && item.assignedUserId === user.id && !isVoiceChannel(item.channel),
          ) ?? null;
        dispatchOffer({ type: "hydrate", conversation: hydrated, generation });
        setOffer(hydrated);
      })
      .catch(() => undefined);
  }, [canReceiveOffers, user.id]);

  useEffect(() => {
    function handlePresence(event: Event) {
      const presence = (event as CustomEvent<{ state: PresenceState }>).detail;
      if (presence.state !== "ready") {
        setOffer((current) => (isVoiceTransferOffer(current) ? current : null));
      }
    }
    window.addEventListener(WORKSPACE_PRESENCE_UPDATED, handlePresence);
    return () => window.removeEventListener(WORKSPACE_PRESENCE_UPDATED, handlePresence);
  }, []);

  useEffect(() => {
    openPendingAcdWorkspace("sip-active");
    recoverAcdWorkspace("sip-active");
  }, [openPendingAcdWorkspace, recoverAcdWorkspace, sip.callState, sip.inboundOffer]);

  useEffect(() => () => {
    recoveryGenerationRef.current += 1;
    recoveryRef.current = null;
  }, []);

  useEffect(() => {
    if (
      sip.callState === "idle" &&
      (sip.awaitingDisposition || sip.remoteEnded)
    ) {
      pendingVoiceCallRef.current = null;
      setPendingVoiceCall(null);
    }
  }, [sip.awaitingDisposition, sip.callState, sip.remoteEnded]);

  const handleOffer = useCallback(
    (conversation: WorkspaceConversation, options?: { allowWhenNotReady?: boolean }) => {
      if (presenceState !== "ready" && !options?.allowWhenNotReady) return;
      if (conversation.assignedUserId !== user.id) return;
      if (!conversation.offerPending) return;
      if (isVoiceChannel(conversation.channel)) return;
      liveOfferGenerationRef.current = ++offerGenerationRef.current;
      setOffer({ ...conversation, offerPending: true, status: "waiting" });
    },
    [presenceState, user.id],
  );

  useWorkspaceSocket({
    onConversationAssigned: handleOffer,
    onConversationOffer: handleOffer,
    onConversationTransferred: handleOffer,
    onConversationTransferOffered: (event) => {
      if (event.conversation && event.transfer.fromUserId !== user.id) {
        const conversation = {
          ...event.conversation,
          transfer: event.transfer,
        };
        if (isVoiceChannel(conversation.channel)) {
          const current = getSipCallStatus();
          const pending = rememberVoiceConsultOffer(conversation);
          const linked =
            current.inboundTransferOffer && isRealAcdSessionId(current.acdSessionId)
              ? rememberInboundVoiceConsultSession(current.acdSessionId) ?? pending
              : pending;
          pendingVoiceCallRef.current = linked;
          setPendingVoiceCall(linked);
          if (
            current.inboundTransferOffer &&
            isRealAcdSessionId(current.acdSessionId)
          ) {
            setSipAcdCallContext(current.acdSessionId, conversation.id);
            if (current.callState === "active") {
              notifyInboundConsultAnswered();
            }
          }
          if (
            !current.inboundOffer &&
            shouldOpenWorkspaceOnAcdEvent({
              callState: current.callState,
              inboundOffer: current.inboundOffer,
              direction: current.direction,
            })
          ) {
            openPendingAcdWorkspace("transfer-offered");
          }
          return;
        }
        handleOffer(
          {
            ...conversation,
            assignedUserId: user.id,
            offerPending: true,
            status: "waiting",
          },
          { allowWhenNotReady: true },
        );
      }
    },
    onConversationAccepted: (conversation) => {
      setOffer((current) => (current?.id === conversation.id ? null : current));
    },
    onConversationRejected: (conversation) => {
      setOffer((current) => (current?.id === conversation.id ? null : current));
    },
    onConversationQueued: (conversation) => {
      setOffer((current) => (current?.id === conversation.id ? null : current));
    },
    onConversationTransferRejected: (event) => {
      setOffer((current) => (current?.id === event.conversationId ? null : current));
    },
    onConversationTransferExpired: (event) => {
      const current = getSipCallStatus();
      clearPendingVoiceConsultWorkspace(event.conversationId);
      pendingVoiceCallRef.current = null;
      setPendingVoiceCall(null);
      setOffer((current) => (current?.id === event.conversationId ? null : current));
      if (
        current.secondaryConsultOnly &&
        current.conversationId === event.conversationId
      ) {
        navigate(workspacePath, { replace: true });
      }
    },
    onConversationTransferCancelled: (event) => {
      const current = getSipCallStatus();
      clearPendingVoiceConsultWorkspace(event.conversationId);
      pendingVoiceCallRef.current = null;
      setPendingVoiceCall(null);
      setOffer((current) => (current?.id === event.conversationId ? null : current));
      if (
        current.secondaryConsultOnly &&
        current.conversationId === event.conversationId
      ) {
        navigate(workspacePath, { replace: true });
      }
    },
    onVoiceConsultUpdated: (event) => {
      if (event.merged) markConsultMerged();
    },
    onVoiceCallOpened: (conversation, sessionId, options) => {
      const current = getSipCallStatus();
      if (
        current.transferConsultRole === "secondary" &&
        conversation.assignedUserId === user.id
      ) {
        markConsultConversationOwned();
      }
      console.info("[voice][acd] voice.call.opened.received", {
        conversationId: conversation.id,
        sessionId,
        sipState: current.callState,
        currentSessionId: current.acdSessionId,
      });
      if (!shouldApplyVoiceOpenedEvent({
        callState: current.callState,
        currentSessionId: current.acdSessionId,
        eventSessionId: sessionId,
      })) {
        console.warn("[voice][acd] voice.call.opened.stale", {
          activeSessionId: current.acdSessionId,
          eventSessionId: sessionId,
          conversationId: conversation.id,
        });
        return;
      }
      const pending = {
        conversation,
        sessionId,
        receivedAt: Date.now(),
        acdUserAccepted: true,
      };
      pendingVoiceCallRef.current = pending;
      setPendingVoiceCall(pending);
      console.info("[voice][acd] voice.call.opened.pending", {
        conversationId: conversation.id,
        sessionId,
        sipState: current.callState,
        inboundOffer: current.inboundOffer,
      });
      if (current.callState !== "idle") {
        setSipAcdCallContext(sessionId, conversation.id);
      }
      if (
        shouldHoldConsultWorkspace({
          secondaryConsultOnly: getSipCallStatus().secondaryConsultOnly,
          consultAnswered: options?.consultAnswered,
        })
      ) {
        return;
      }
      if (
        isRealAcdSessionId(sessionId) &&
        shouldOpenWorkspaceOnAcdEvent({
          callState: current.callState,
          inboundOffer: current.inboundOffer,
          direction: current.direction ?? (conversation.direction === "outbound" ? "outbound" : "inbound"),
          acdUserAccepted: true,
        })
      ) {
        openWorkspaceForCall(conversation, sessionId, "acd-call-opened");
        pendingVoiceCallRef.current = null;
        setPendingVoiceCall(null);
      }
    },
    onPresenceUpdated: (state) => {
      notifyPresenceUpdated(state);
    },
    onReconnect: () => {
      console.info("[voice][socket] reconnected", {
        callState: getSipCallStatus().callState,
        sessionId: getSipCallStatus().acdSessionId,
      });
      recoverAcdWorkspace("socket-reconnect");
    },
  });

  if (offerSnapshot?.source === "sip" && offerSnapshot.showBanner) {
    return createPortal(
      <div className="fixed right-4 top-3 z-50 flex max-w-[34rem] items-center gap-2 rounded-xl border-[0.6px] border-[#bfbfbf] bg-neutral-900 px-2.5 py-1.5 text-white shadow-lg">
        <WorkspaceChannelIcon channel="voice" className="size-7 rounded-lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">
            {sip.inboundTransferOffer ? "Transfer request" : incomingOfferTitle("voice")}
          </p>
          {sip.inboundTransferOffer || sip.destination ? (
            <p className="truncate text-[11px] text-neutral-300">
              {sip.inboundTransferOffer
                ? sip.destination
                  ? `${sip.destination} · Accept to consult`
                  : "Accept to consult with the other agent"
                : sip.destination}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            const before = getSipCallStatus();
            console.info("[voice][sip] inbound.accept-clicked", {
              sip: {
                callState: before.callState,
                inboundOffer: before.inboundOffer,
                acdSessionId: before.acdSessionId,
                conversationId: before.conversationId,
              },
              pendingVoiceCall: pendingVoiceCall
                ? { conversationId: pendingVoiceCall.conversation.id, sessionId: pendingVoiceCall.sessionId }
                : null,
            });
            setBusy(true);
            acceptInboundSipCall();
            openPendingAcdWorkspace("accept-click");
            recoverAcdWorkspace("accept-click");
            setBusy(false);
          }}
          className="ml-1 inline-flex h-[38px] items-center gap-1.5 rounded-lg bg-emerald-500 px-3 text-sm font-semibold text-white hover:bg-emerald-400 disabled:opacity-50"
        >
          <Check className="size-[18px]" />
          Accept
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            console.info("[voice][sip] inbound.reject-clicked", {
              sessionId: getSipCallStatus().acdSessionId,
              conversationId: getSipCallStatus().conversationId,
            });
            setBusy(true);
            pendingVoiceCallRef.current = null;
            setPendingVoiceCall(null);
            rejectInboundSipCall();
            setBusy(false);
          }}
          className="inline-flex h-[38px] items-center rounded-lg bg-red-500 px-3 text-sm font-semibold text-white hover:bg-red-400 disabled:opacity-50"
        >
          Reject
        </button>
      </div>,
      document.body,
    );
  }

  if (
    !offer ||
    !offerSnapshot ||
    offerSnapshot.source !== "digital" ||
    !offerSnapshot.showBanner ||
    (!canReceiveOffers && !isVoiceTransferOffer(offer))
  ) {
    return null;
  }
  if (isVoiceTransferOffer(offer) && isVoiceChannel(offer.channel)) return null;

  const sourceName =
    offer.transfer?.sourceAgentName ??
    offer.transfer?.fromAgentName ??
    offer.transfer?.sourceUserName;
  const isTransferOffer = Boolean(
    offer.transfer?.fromUserId ||
      offer.transfer?.fromAgentId ||
      offer.transfer?.state === "offered",
  );
  const waitingForVoiceSip = isTransferOffer && isVoiceChannel(offer.channel);

  async function accept() {
    if (!offer || busy) return;
    setBusy(true);
    try {
      await workspaceApi.acceptOffer(offer.id);
      setOffer(null);
      navigate(`${workspacePath}?conversationId=${offer.id}`);
    } catch {
      setOffer(null);
      void workspaceApi
        .listConversationSummaries()
        .then((items) =>
          setOffer(
            items.find(
              (item) => item.offerPending && item.assignedUserId === user.id,
            ) ?? null,
          ),
        )
        .catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!offer || busy) return;
    const pendingOffer = offer;
    setBusy(true);
    try {
      await workspaceApi.rejectOffer(pendingOffer.id);
      setOffer(null);
    } catch {
      setOffer(null);
      // If offer expiry won the race, the server set Away. The explicit
      // Reject click still means this agent must become Not Ready.
      await workspaceApi
        .updatePresence("not_ready", "offer_rejected")
        .then((presence) => notifyPresenceUpdated(presence.state))
        .catch(() => undefined);
      void workspaceApi
        .listConversationSummaries()
        .then((items) =>
          setOffer(
            items.find(
              (item) => item.offerPending && item.assignedUserId === user.id,
            ) ?? null,
          ),
        )
        .catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-[34rem] items-center gap-2 rounded-xl bg-neutral-900 px-2.5 py-1.5 text-white shadow-lg">
      <WorkspaceChannelIcon channel={offer.channel} className="size-7 rounded-lg" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold">
          {isTransferOffer
            ? `Transfer from ${
                sourceName ||
                (offer.transfer?.fromAgentId
                  ? `Agent ${offer.transfer.fromAgentId}`
                  : "another agent")
              }`
            : incomingOfferTitle(offer.channel)}
        </p>
        {isTransferOffer && offer.transfer?.notes ? (
          <p className="truncate text-[11px] text-neutral-300">{offer.transfer.notes}</p>
        ) : null}
      </div>
      {waitingForVoiceSip ? (
        <span className="px-2 text-[11px] font-medium text-neutral-300">
          Connecting voice…
        </span>
      ) : (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => void accept()}
            className="ml-1 inline-flex h-7 items-center gap-1 rounded-lg bg-emerald-500 px-2 text-[11px] font-semibold text-white hover:bg-emerald-400 disabled:opacity-50"
          >
            <Check className="size-3.5" />
            Accept
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void reject()}
            className="inline-flex h-7 items-center rounded-lg bg-red-500 px-2.5 text-[11px] font-semibold text-white hover:bg-red-400 disabled:opacity-50"
          >
            Reject
          </button>
        </>
      )}
    </div>
  );
}
