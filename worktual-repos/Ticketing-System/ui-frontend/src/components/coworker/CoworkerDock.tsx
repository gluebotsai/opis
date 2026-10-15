import React from 'react';
import { X } from 'lucide-react';
import CopilotMark from '../layout/CopilotMark';
import CoworkerChatPanel from './CoworkerChatPanel';
import { useCoworker } from './CoworkerContext';

type CoworkerDockProps = {
  pageLabel: string;
  suggestionChips?: string[];
  onUserMessage?: (text: string) => string | null | Promise<string | null>;
  /** When true, hide the floating dock (page owns its own chat split). */
  hidden?: boolean;
};

const DEFAULT_CHIPS = [
  'my tickets',
  'open tickets',
  'create ticket',
  'find customer',
  'KB articles',
  'teams',
];

export default function CoworkerDock({
  pageLabel,
  suggestionChips = DEFAULT_CHIPS,
  onUserMessage,
  hidden = false,
}: CoworkerDockProps) {
  const { open, openChat, closeChat, toggleChat } = useCoworker();

  if (hidden) return null;

  return (
    <>
      {/* Edge tab — Pattern B collapsed affordance */}
      {!open && (
        <button
          type="button"
          id="coworker-edge-tab"
          title="Open Worktual co-worker"
          onClick={openChat}
          className="fixed right-0 top-1/2 z-40 -translate-y-1/2 flex flex-col items-center gap-1.5 rounded-l-2xl border border-r-0 border-neutral-200 bg-white px-2 py-3 shadow-md hover:bg-neutral-50 transition-colors"
        >
          <CopilotMark className="h-7 w-7" />
          <span className="text-[10px] font-semibold tracking-wide text-neutral-600">Ask</span>
        </button>
      )}

      {/* Backdrop on small screens */}
      {open && (
        <button
          type="button"
          aria-label="Close co-worker"
          className="fixed inset-0 z-40 bg-black/20 lg:bg-transparent lg:pointer-events-none"
          onClick={closeChat}
        />
      )}

      {/* Slide-over chat */}
      <aside
        id="coworker-dock-panel"
        className={`fixed z-50 top-14 bottom-0 right-0 w-full max-w-[400px] p-3 sm:p-4 transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full pointer-events-none'
        }`}
        aria-hidden={!open}
      >
        <div className="relative h-full min-h-0">
          <button
            type="button"
            title="Close co-worker"
            onClick={closeChat}
            className="absolute top-2.5 right-2.5 z-10 p-2 rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
          <CoworkerChatPanel
            pageLabel={pageLabel}
            className="h-full shadow-lg"
            placeholder="Ask anything — results open on the page…"
            suggestionChips={suggestionChips}
            onUserMessage={onUserMessage}
            expanded={open}
            onToggleExpand={toggleChat}
          />
        </div>
      </aside>
    </>
  );
}
