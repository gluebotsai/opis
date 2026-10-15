import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize, Maximize2, Minimize2 } from 'lucide-react';
import type { CoworkerChatContext } from '../../config/coworker';
import CopilotMark from '../layout/CopilotMark';
import CoworkerChatPanel from './CoworkerChatPanel';
import { useCoworkerSessionOptional } from './CoworkerSessionContext';

/**
 * Split ratios (Contact Center LAYOUTS.md §3):
 * - default / chat-focused: chat 45% · content 55%
 * - content-focused: chat 35% · content 65%
 * - content full page (Dashboard only): content 100% · chat docked as floating chip
 */
type ExpandSide = 'none' | 'left' | 'right' | 'full';

type SplitExpandApi = {
  /** Widen the form/content panel (35/65). */
  focusContent: () => void;
  /** Restore default chat/content split. */
  clearContentFocus: () => void;
  /** True when content panel is widened or full-page. */
  contentExpanded: boolean;
  /** True when content is full-page (chat docked). Dashboard only. */
  contentFullPage: boolean;
  /** Enter full-page content when allowed; otherwise widen to 35/65. */
  enterFullPage: () => void;
  /** Exit full-page / widened back to default split. */
  exitFullPage: () => void;
};

const SplitExpandContext = createContext<SplitExpandApi | null>(null);

/** Optional — used by ticket detail to widen the content panel. */
export function useCoworkerSplitExpandOptional() {
  return useContext(SplitExpandContext);
}

export type CoworkerChatActionMeta = {
  reply: string;
  agent: string;
  userText: string;
};

export type CoworkerPageHandlers = {
  module?: string;
  surface?: string;
  getChatContext?: () => CoworkerChatContext | null;
  onDraftPatch?: (patch: Record<string, unknown>) => void;
  onChatActions?: (
    actions: Record<string, unknown>[],
    meta: CoworkerChatActionMeta
  ) => void | Promise<void>;
  onToolConfirm?: (
    tool: { name: string; args: Record<string, unknown> }
  ) => boolean | Promise<boolean>;
};

type PageBridgeApi = {
  setPageHandlers: (handlers: CoworkerPageHandlers | null) => void;
  handlers: CoworkerPageHandlers | null;
};

const PageBridgeContext = createContext<PageBridgeApi | null>(null);

/** Child pages inside wrapSplit register draft/patch handlers here. */
export function useCoworkerPageBridge() {
  return useContext(PageBridgeContext);
}

type CoworkerSplitWorkspaceProps = {
  pageLabel: string;
  children: React.ReactNode;
  contentTitle?: string;
  contentSubtitle?: string;
  contentHeaderActions?: React.ReactNode;
  greetingOverride?: string;
  placeholder?: string;
  suggestionChips?: string[];
  onUserMessage?: (text: string) => string | null | Promise<string | null>;
  onChatActions?: (
    actions: Record<string, unknown>[],
    meta: { reply: string; agent: string; userText: string }
  ) => void | Promise<void>;
  /** Offline / chrome only. Live answers go to LangGraph. */
  handlersFirst?: boolean;
  getChatContext?: () => CoworkerChatContext | null;
  onChatRestart?: () => void;
  /** Module label chosen by the agents router, for navigating to that module. */
  onAgentRoute?: (agent: string, userText?: string) => void;
  /** Constrain to Contact Center max content width when sidebar expanded */
  constrainWidth?: boolean;
  /**
   * Dashboard / Reports / Analytics only. When true, content expand enters
   * full-page board with co-worker docked. All other modules keep the old
   * 45/55 ↔ 35/65 split toggle.
   */
  allowFullPageExpand?: boolean;
  module?: string;
  surface?: string;
  onDraftPatch?: (patch: Record<string, unknown>) => void;
  onToolConfirm?: (
    tool: { name: string; args: Record<string, unknown> }
  ) => boolean | Promise<boolean>;
};

type MobilePane = 'chat' | 'content';

function gridClassFor(expand: ExpandSide): string {
  if (expand === 'full') {
    return 'lg:grid-cols-1';
  }
  // Content-focused → chat 35% / content 65%
  if (expand === 'right') {
    return 'lg:grid-cols-[minmax(0,35fr)_minmax(0,65fr)]';
  }
  // Default → chat 45% / content 55%
  return 'lg:grid-cols-[minmax(0,45fr)_minmax(0,55fr)]';
}

/**
 * Contact Center co-worker split — chat ~45% / content ~55% by default.
 * Dashboard: content expand → full-page + docked co-worker.
 * Other modules: content expand → 35/65 (both columns stay visible).
 */
export default function CoworkerSplitWorkspace({
  pageLabel,
  children,
  contentTitle,
  contentSubtitle,
  contentHeaderActions,
  greetingOverride,
  placeholder,
  suggestionChips,
  onUserMessage,
  onChatActions,
  handlersFirst = false,
  getChatContext,
  onChatRestart,
  onAgentRoute,
  constrainWidth = false,
  allowFullPageExpand = false,
  module,
  surface,
  onDraftPatch,
  onToolConfirm,
}: CoworkerSplitWorkspaceProps) {
  const session = useCoworkerSessionOptional();
  const [expand, setExpand] = useState<ExpandSide>('none');
  /** Below lg: one pane at a time (chat vs content) — avoids double scroll stacks on phone/tablet. */
  const [mobilePane, setMobilePane] = useState<MobilePane>('chat');
  const [pageHandlers, setPageHandlers] = useState<CoworkerPageHandlers | null>(null);
  const pageHandlersRef = useRef<CoworkerPageHandlers | null>(null);
  const setPageHandlersStable = useCallback((next: CoworkerPageHandlers | null) => {
    pageHandlersRef.current = next;
    setPageHandlers(next);
  }, []);

  useEffect(() => {
    setMobilePane('chat');
  }, [pageLabel, contentTitle]);

  const mergedGetChatContext = useCallback((): CoworkerChatContext => {
    const extra = getChatContext?.() || pageHandlers?.getChatContext?.() || {};
    return {
      ...extra,
      module: extra.module || module || pageHandlers?.module,
      surface: extra.surface || surface || pageHandlers?.surface,
      focusedEntity: extra.focusedEntity || session?.focusedEntity || undefined,
    };
  }, [getChatContext, session?.focusedEntity, module, surface, pageHandlers]);

  const mergedOnDraftPatch = useCallback(
    (patch: Record<string, unknown>) => {
      onDraftPatch?.(patch);
      pageHandlers?.onDraftPatch?.(patch);
    },
    [onDraftPatch, pageHandlers]
  );

  const mergedOnChatActions = useCallback(
    async (
      actions: Record<string, unknown>[],
      meta: CoworkerChatActionMeta
    ) => {
      const opensContent = actions.some((raw) => {
        const type = String(raw.type || '')
          .trim()
          .toLowerCase();
        if (!type) return false;
        if (type.startsWith('create_') && !raw.done && !raw.refresh) return true;
        if (type.startsWith('delete_') && String(raw.step || '') === 'confirm') return true;
        if (type === 'open_ticket' || type === 'open_kb' || type === 'open_customer') return true;
        return false;
      });
      if (opensContent) setMobilePane('content');

      await pageHandlers?.onChatActions?.(actions, meta);
      await onChatActions?.(actions, meta);
    },
    [onChatActions, pageHandlers]
  );

  const mergedOnToolConfirm = useCallback(
    async (tool: { name: string; args: Record<string, unknown> }) => {
      if (onToolConfirm) {
        const owned = await onToolConfirm(tool);
        if (owned) return true;
      }
      if (pageHandlers?.onToolConfirm) {
        return Boolean(await pageHandlers.onToolConfirm(tool));
      }
      return false;
    },
    [onToolConfirm, pageHandlers]
  );

  const focusContent = useCallback(() => setExpand('right'), []);
  const clearContentFocus = useCallback(() => setExpand('none'), []);
  const enterFullPage = useCallback(() => {
    if (allowFullPageExpand) setExpand('full');
    else setExpand('right');
  }, [allowFullPageExpand]);
  const exitFullPage = useCallback(() => setExpand('none'), []);
  const contentFullPage = allowFullPageExpand && expand === 'full';
  const contentExpanded = expand === 'right' || contentFullPage;
  const expandApi = useMemo(
    () => ({
      focusContent,
      clearContentFocus,
      contentExpanded,
      contentFullPage,
      enterFullPage,
      exitFullPage,
    }),
    [
      focusContent,
      clearContentFocus,
      contentExpanded,
      contentFullPage,
      enterFullPage,
      exitFullPage,
    ]
  );
  const pageBridge = useMemo(
    () => ({ setPageHandlers: setPageHandlersStable, handlers: pageHandlers }),
    [setPageHandlersStable, pageHandlers]
  );

  /** Chat header: toggle between default (45/55) and content-widened (35/65). */
  const toggleChatSplit = useCallback(() => {
    setExpand((s) => {
      if (s === 'full') return 'none';
      return s === 'right' ? 'none' : 'right';
    });
  }, []);

  /**
   * Content header expand:
   * - Dashboard only: full-page board + docked co-worker
   * - Everywhere else: old 45/55 ↔ 35/65 (both columns stay visible)
   */
  const toggleContentExpand = useCallback(() => {
    if (allowFullPageExpand) {
      setExpand((s) => (s === 'full' ? 'none' : 'full'));
      return;
    }
    setExpand((s) => (s === 'right' || s === 'full' ? 'none' : 'right'));
  }, [allowFullPageExpand]);

  const effectiveExpand: ExpandSide =
    !allowFullPageExpand && expand === 'full' ? 'right' : expand;
  const gridClass = gridClassFor(effectiveExpand);
  const chatExpanded = effectiveExpand === 'none' || effectiveExpand === 'left';
  const contentWidened = !allowFullPageExpand && effectiveExpand === 'right';
  const contentPanelTitle = contentTitle || pageLabel;
  const showMobileTabs = !contentFullPage;

  return (
    <SplitExpandContext.Provider value={expandApi}>
      <PageBridgeContext.Provider value={pageBridge}>
        <div className="relative h-full min-h-0 flex flex-col px-3 py-3 sm:px-6 sm:py-5 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {showMobileTabs ? (
            <div
              className="lg:hidden shrink-0 mb-3 flex rounded-xl border border-neutral-200 bg-white p-1 shadow-sm"
              role="tablist"
              aria-label="Co-worker workspace"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mobilePane === 'chat'}
                onClick={() => setMobilePane('chat')}
                className={`flex-1 min-h-11 rounded-lg px-3 text-sm font-semibold transition-colors ${
                  mobilePane === 'chat'
                    ? 'bg-neutral-950 text-white shadow-sm'
                    : 'text-neutral-600 hover:bg-neutral-50'
                }`}
              >
                Chat
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mobilePane === 'content'}
                onClick={() => setMobilePane('content')}
                className={`flex-1 min-h-11 rounded-lg px-3 text-sm font-semibold transition-colors truncate ${
                  mobilePane === 'content'
                    ? 'bg-neutral-950 text-white shadow-sm'
                    : 'text-neutral-600 hover:bg-neutral-50'
                }`}
              >
                {contentPanelTitle}
              </button>
            </div>
          ) : null}
          <div
            className={`grid grid-cols-1 ${gridClass} gap-3 sm:gap-5 flex-1 min-h-0 min-w-0 w-full transition-[grid-template-columns] duration-200 ease-out ${
              constrainWidth && !contentFullPage ? 'max-w-7xl mx-auto' : ''
            }`}
          >
            <div
              className={`min-w-0 min-h-0 h-full flex flex-col ${
                contentFullPage ? 'hidden' : ''
              } ${mobilePane !== 'chat' ? 'max-lg:hidden' : ''}`}
            >
              <CoworkerChatPanel
                pageLabel={pageLabel}
                greetingOverride={greetingOverride}
                placeholder={placeholder}
                suggestionChips={suggestionChips}
                onUserMessage={onUserMessage}
                onChatActions={mergedOnChatActions}
                handlersFirst={handlersFirst}
                getChatContext={mergedGetChatContext}
                onRestart={onChatRestart}
                onAgentRoute={onAgentRoute}
                expanded={chatExpanded}
                onToggleExpand={toggleChatSplit}
                module={module || pageHandlers?.module}
                surface={surface || pageHandlers?.surface}
                onDraftPatch={mergedOnDraftPatch}
                onToolConfirm={mergedOnToolConfirm}
              />
            </div>

            <div
              className={`rounded-2xl border border-neutral-200 bg-white shadow-sm flex h-full min-h-0 min-w-0 flex-col overflow-hidden ${
                mobilePane !== 'content' ? 'max-lg:hidden' : ''
              }`}
            >
              <div className="flex items-center justify-between gap-2 border-b border-neutral-200 px-3 py-2.5 sm:px-4 shrink-0 min-h-[48px]">
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-semibold text-neutral-900 truncate block">
                    {contentPanelTitle}
                  </span>
                  {contentSubtitle ? (
                    <span className="text-[11px] text-neutral-500 truncate block mt-0.5">
                      {contentSubtitle}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {contentHeaderActions}
                  <button
                    type="button"
                    title={
                      allowFullPageExpand
                        ? contentFullPage
                          ? 'Exit full page · show co-worker'
                          : 'Full page view · hide co-worker'
                        : contentWidened
                          ? 'Shrink board · widen chat'
                          : 'Expand board · shrink chat'
                    }
                    onClick={toggleContentExpand}
                    className="hidden lg:flex p-2 min-h-10 min-w-10 items-center justify-center rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 transition-colors"
                    aria-pressed={allowFullPageExpand ? contentFullPage : contentWidened}
                  >
                    {allowFullPageExpand ? (
                      contentFullPage ? (
                        <Minimize2 className="h-4 w-4" />
                      ) : (
                        <Maximize className="h-4 w-4" />
                      )
                    ) : contentWidened ? (
                      <Minimize2 className="h-4 w-4" />
                    ) : (
                      <Maximize2 className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
              <div className="flex flex-1 min-h-0 min-w-0 flex-col overflow-y-auto overflow-x-hidden">
                {children}
              </div>
            </div>
          </div>

          {contentFullPage ? (
            <button
              type="button"
              title="Show co-worker"
              onClick={exitFullPage}
              className="absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-4 sm:left-5 z-30 flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-950 pl-2.5 pr-3 py-2.5 min-h-11 text-white shadow-lg hover:bg-neutral-800 transition-colors"
            >
              <CopilotMark className="h-6 w-6" />
              <span className="text-[11px] font-semibold tracking-wide">Co-worker</span>
            </button>
          ) : null}
        </div>
      </PageBridgeContext.Provider>
    </SplitExpandContext.Provider>
  );
}
