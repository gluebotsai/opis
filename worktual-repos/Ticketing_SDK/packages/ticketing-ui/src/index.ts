import { WorktualApprovalsElement } from "./approvals-element.js";
import { WorktualInsightsElement } from "./insights-element.js";
import { WorktualChatElement } from "./chat-element.js";
import { WorktualChatLauncherElement } from "./launcher-element.js";
import { WorktualInboxElement } from "./inbox-element.js";
import { WorktualLoginElement } from "./login-element.js";
import {
  WorktualAssignElement,
  WorktualClassifyElement,
  WorktualDeflectionElement,
  WorktualKbElement,
  WorktualQualityElement,
  WorktualReplyDraftElement,
  WorktualResolveElement,
  WorktualSimilarElement,
  WorktualSlaElement,
  WorktualSummaryElement,
  WorktualWorkloadElement,
} from "./task-element.js";

export { WorktualApprovalsElement, WorktualChatElement, WorktualChatLauncherElement, WorktualInsightsElement };
export type { WorktualActionDetail } from "./chat-element.js";
export {
  WorktualAssignElement,
  WorktualClassifyElement,
  WorktualDeflectionElement,
  WorktualInboxElement,
  WorktualKbElement,
  WorktualLoginElement,
  WorktualQualityElement,
  WorktualReplyDraftElement,
  WorktualResolveElement,
  WorktualSimilarElement,
  WorktualSlaElement,
  WorktualSummaryElement,
  WorktualWorkloadElement,
};
export type { WorktualTaskActionDetail } from "./task-element.js";
export type { WorktualApprovalActionDetail } from "./approvals-element.js";
export type { WorktualInsightActionDetail } from "./insights-element.js";
export { approvalStrings, chatStrings, inboxStrings, insightStrings, launcherStrings, localeDir, loginStrings, taskStrings } from "./i18n.js";
export type { ApprovalStrings, ChatStrings, InboxStrings, InsightStrings, LauncherStrings, LoginStrings, TaskStrings } from "./i18n.js";
export type { WorktualLoginActionDetail } from "./login-element.js";
export type { WorktualInboxActionDetail } from "./inbox-element.js";
export type { WorktualSessionEndDetail } from "./widget-client.js";
export {
  EMBED_AUTH_MESSAGE,
  helpFrameUrl,
  mountHelpFrame,
  mountWorktualFrame,
  ticketingFrameUrl,
} from "./embed.js";
export type { WorktualFrame } from "./embed.js";

function define(tag: string, ctor: CustomElementConstructor): void {
  if (!customElements.get(tag)) customElements.define(tag, ctor);
}

export function defineWorktualChat(): void {
  if (typeof customElements === "undefined") return;
  define("worktual-chat", WorktualChatElement);
  define("worktual-chat-launcher", WorktualChatLauncherElement);
  define("worktual-summary", WorktualSummaryElement);
  define("worktual-classify-card", WorktualClassifyElement);
  define("worktual-reply-draft", WorktualReplyDraftElement);
  define("worktual-similar-tickets", WorktualSimilarElement);
  define("worktual-kb-suggest", WorktualKbElement);
  define("worktual-deflection", WorktualDeflectionElement);
  define("worktual-assign-card", WorktualAssignElement);
  define("worktual-resolve-card", WorktualResolveElement);
  define("worktual-quality-card", WorktualQualityElement);
  define("worktual-sla-card", WorktualSlaElement);
  define("worktual-workload", WorktualWorkloadElement);
  define("worktual-approvals", WorktualApprovalsElement);
  define("worktual-insights", WorktualInsightsElement);
  define("worktual-login", WorktualLoginElement);
  define("worktual-inbox", WorktualInboxElement);
}

defineWorktualChat();
