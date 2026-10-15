import { useEffect, useRef, useState } from "react";

import { WorkspaceChatPanel } from "@/components/workspace/workspace-chat-panel";
import { WorkspaceCustomerPanel } from "@/components/workspace/workspace-customer-panel";
import { WorkspaceInboxPanel } from "@/components/workspace/workspace-inbox-panel";
import { WorkspacePanel } from "@/components/workspace/workspace-panel";
import { useWorkspaceState } from "@/features/workspace/use-workspace-state";
import { useCopilotPage } from "@/features/assistant/copilot-page-context";
import { COPILOT_USE_SUGGESTION } from "@/features/assistant/assistant-api";
import { useMediaQuery } from "@/hooks/use-media-query";
import { MEDIA_LG, MEDIA_XL } from "@/lib/panel-chrome";
import { cn } from "@/lib/utils";
import {
  WorkspaceDispositionDialog,
  WorkspaceTransferDialog,
  WorkspaceTransferDispositionDialog,
} from "@/components/workspace/workspace-action-dialogs";

type WorkspacePanelsProps = {
  onOpenQueue?: (queueId: string) => void;
};

type WorkspaceMobilePane = "inbox" | "chat" | "customer";

export function WorkspacePanels({ onOpenQueue }: WorkspacePanelsProps) {
  const workspace = useWorkspaceState();
  const { setConversationId, setRecordLabel, setWorkspaceContact, setContactDraft } = useCopilotPage();
  const isXl = useMediaQuery(MEDIA_XL);
  const isLg = useMediaQuery(MEDIA_LG);
  const selectedConversationId = workspace.selected?.id;
  const previousConversationIdRef = useRef(selectedConversationId);
  const [mobilePane, setMobilePane] = useState<WorkspaceMobilePane>("inbox");

  useEffect(() => {
    if (
      previousConversationIdRef.current &&
      previousConversationIdRef.current !== selectedConversationId
    ) {
      setContactDraft(null);
    }
    previousConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId, setContactDraft]);

  useEffect(() => {
    const customer = workspace.selected?.customer;
    setConversationId(workspace.selected?.id);
    setRecordLabel(customer?.name);
    setWorkspaceContact(
      customer
        ? {
            contactId: customer.contactId ?? undefined,
            contactName: customer.name,
            contactEmail: customer.email,
            contactPhone: customer.phone,
          }
        : undefined,
    );
    return () => {
      setConversationId(undefined);
      setRecordLabel(undefined);
      setWorkspaceContact(undefined);
    };
  }, [
    setConversationId,
    setRecordLabel,
    setWorkspaceContact,
    workspace.selected?.customer.contactId,
    workspace.selected?.customer.email,
    workspace.selected?.customer.name,
    workspace.selected?.customer.phone,
    workspace.selected?.id,
  ]);

  useEffect(() => {
    function useSuggestion(event: Event) {
      const detail = (
        event as CustomEvent<{
          conversationId: string;
          text: string;
          copilotTurnId?: string;
        }>
      ).detail;
      if (detail.conversationId !== workspace.selected?.id) return;
      workspace.useCopilotSuggestion(detail.text, detail.copilotTurnId);
    }
    window.addEventListener(COPILOT_USE_SUGGESTION, useSuggestion);
    return () => window.removeEventListener(COPILOT_USE_SUGGESTION, useSuggestion);
  }, [workspace.selected?.id, workspace.useCopilotSuggestion]);

  function handleSelect(id: string) {
    workspace.selectConversation(id);
    if (!isXl) setMobilePane("chat");
  }

  const showInbox = isXl || (isLg && mobilePane !== "customer") || (!isLg && mobilePane === "inbox");
  const showChat = isXl || (isLg && mobilePane !== "customer") || (!isLg && mobilePane === "chat");
  const showCustomerColumn = isXl;
  const showCustomerOverlay = !isXl && mobilePane === "customer";
  const ongoingCount = !isXl ? workspace.counts.open : undefined;
  const awaitingReplyCount = !isXl
    ? workspace.conversations.reduce((sum, item) => {
        if (item.status === "resolved") return sum;
        const unread = item.unreadCount ?? 0;
        if (unread > 0) return sum + unread;
        if (
          item.id === workspace.selected?.id &&
          item.messages.at(-1)?.role === "customer"
        ) {
          return sum + 1;
        }
        return sum;
      }, 0)
    : undefined;

  return (
    <>
    <div className="relative grid h-full min-h-0 min-w-0 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-2 xl:grid-cols-[minmax(0,23%)_minmax(0,1fr)_minmax(0,30%)] xl:gap-4">
      <WorkspacePanel className={cn(!showInbox && "hidden")}>
        <WorkspaceInboxPanel
          conversations={workspace.conversations}
          selectedId={workspace.selectedId}
          tab={workspace.tab}
          search={workspace.search}
          counts={workspace.counts}
          loading={workspace.loading}
          loadingMore={workspace.loadingMore}
          hasMore={workspace.inboxHasMore[workspace.tab]}
          loadError={workspace.loadError}
          onTabChange={workspace.setTab}
          onSearchChange={workspace.setSearch}
          onSelect={handleSelect}
          onRefresh={() => {
            void workspace.refreshConversations();
          }}
          onLoadMore={() => {
            void workspace.loadMoreInbox();
          }}
        />
      </WorkspacePanel>

      <WorkspacePanel
        className={cn(
          !showChat && "hidden",
          isLg && !isXl && "border-l-[0.6px] border-[#bfbfbf]",
        )}
      >
        <WorkspaceChatPanel
          conversation={workspace.selected}
          loading={workspace.loading}
          draft={workspace.draft}
          focusMessageId={workspace.focusedMessageId}
          conversationLoading={workspace.conversationLoadingId === workspace.selectedId}
          messagesLoading={workspace.messagesLoading}
          messagesLoadingMore={workspace.messagesLoadingMore}
          hasMoreMessages={workspace.hasMoreMessages}
          replySending={workspace.replySending}
          resolveLoading={workspace.resolveLoading}
          transferLoading={workspace.transferLoading}
          transferBlocking={workspace.selectedTransferBlocking}
          transferCancelLoading={workspace.transferCancelLoading}
          transferNotice={workspace.transferNotice}
          onDraftChange={workspace.setDraft}
          onSend={workspace.sendReply}
          onResolve={workspace.openDispositionDialog}
          onTransfer={workspace.openTransferDialog}
          onCancelTransfer={() => void workspace.cancelSelectedTransfer()}
          onDismissTransferNotice={workspace.dismissTransferNotice}
          onLoadOlderMessages={
            workspace.selected
              ? () => workspace.loadOlderMessages(workspace.selected!.id)
              : undefined
          }
          aiSuggestion={workspace.aiSuggestion}
          onUseAiSuggestion={workspace.useInlineAiSuggestion}
          onSendAiSuggestion={workspace.sendInlineAiSuggestion}
          onDismissAiSuggestion={workspace.dismissInlineAiSuggestion}
          onApproveAiAction={workspace.approveInlineAiAction}
          onDeclineAiAction={workspace.declineInlineAiAction}
          onBack={!isLg ? () => setMobilePane("inbox") : undefined}
          onCustomerInfo={!isXl ? () => setMobilePane("customer") : undefined}
          ongoingCount={ongoingCount}
          awaitingReplyCount={awaitingReplyCount}
        />
      </WorkspacePanel>

      {showCustomerColumn ? (
        <WorkspacePanel id="workspace-ai-panel">
          <WorkspaceCustomerPanel
            conversation={workspace.selected}
            loading={workspace.loading}
            detailsReady={workspace.detailsReady}
            activeConversationId={workspace.selectedId}
            activeHistoryMessageId={workspace.focusedMessageId}
            onSelectHistory={workspace.selectHistoryInteraction}
            onOpenQueue={onOpenQueue}
          />
        </WorkspacePanel>
      ) : null}

      {showCustomerOverlay ? (
        <div className="absolute inset-0 z-20 min-h-0 min-w-0 animate-in fade-in slide-in-from-right-4 duration-200">
          <WorkspacePanel id="workspace-ai-panel">
            <WorkspaceCustomerPanel
              conversation={workspace.selected}
              loading={workspace.loading}
              detailsReady={workspace.detailsReady}
              activeConversationId={workspace.selectedId}
              activeHistoryMessageId={workspace.focusedMessageId}
              onSelectHistory={(conversationId, messageId) => {
                workspace.selectHistoryInteraction(conversationId, messageId);
                setMobilePane("chat");
              }}
              onOpenQueue={onOpenQueue}
              onBack={() => setMobilePane("chat")}
            />
          </WorkspacePanel>
        </div>
      ) : null}
    </div>
    {workspace.dispositionDialogOpen && workspace.selected ? (
      <WorkspaceDispositionDialog
        conversationId={workspace.selected.id}
        dispositions={workspace.dispositionOptions}
        optionsLoading={workspace.dispositionOptionsLoading}
        busy={workspace.resolveLoading}
        dismissible={workspace.dispositionDismissible}
        resolutionLocked={workspace.voiceTransferWrapUp}
        nonFinal={workspace.voiceMergeParticipantWrapUp}
        defaultResolution={workspace.voiceTransferWrapUp ? "transferred" : undefined}
        onClose={workspace.closeDispositionDialog}
        onSubmit={(details) => void workspace.resolveSelected(details)}
      />
    ) : null}
    {workspace.transferDialogOpen ? (
      <WorkspaceTransferDialog
        queues={workspace.transferQueues}
        agents={workspace.transferAgents}
        optionsLoading={workspace.transferOptionsLoading}
        targetsLoading={workspace.transferTargetsLoading}
        targetError={workspace.transferTargetsError}
        nextCursor={workspace.transferTargetsNextCursor}
        busy={workspace.transferLoading}
        onClose={workspace.closeTransferDialog}
        mode={workspace.voiceConsultInvite ? "voice-invite" : "transfer"}
        onSubmit={(input) => void workspace.transferSelected(input)}
        onLoadTargets={workspace.loadTransferTargets}
      />
    ) : null}
    {workspace.transferDispositionConversationId ? (
      <WorkspaceTransferDispositionDialog
        conversationId={workspace.transferDispositionConversationId}
        transfer={
          workspace.allConversations.find(
            (conversation) =>
              conversation.id === workspace.transferDispositionConversationId,
          )?.transfer
        }
        dispositions={workspace.dispositionOptions}
        optionsLoading={workspace.dispositionOptionsLoading}
        busy={workspace.transferDispositionLoading}
        onClose={workspace.closeTransferDispositionDialog}
        onSubmit={(details) => void workspace.submitTransferDisposition(details)}
      />
    ) : null}
    </>
  );
}
