import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, FileText } from "lucide-react";
import type { AppModule } from "@/config/modules";
import {
  displayDraftName,
  formatDraftListTime,
  listCampaignDrafts,
  listCampaignDraftsPageAsync,
  type CampaignChatDraft,
} from "@/lib/campaign-drafts";
import { markCreateDraftActive } from "@/lib/create-campaign-active-session";
import {
  CREATE_CAMPAIGN_DRAFTS_HREF,
  draftOpenPath,
} from "@/lib/start-create-campaign-chat";

const PREVIEW_LIMIT = 5;
/** Server already returns listable drafts; fetch a small page for the sidebar. */
const FETCH_LIMIT = 30;

type Props = {
  mod: AppModule;
  collapsed?: boolean;
  active: boolean;
  navItemClass: (active: boolean, collapsed?: boolean) => string;
  onNavigate?: () => void;
};

function localPreview(): CampaignChatDraft[] {
  return listCampaignDrafts().slice(0, PREVIEW_LIMIT);
}

export function SidebarDraftsItem({
  mod,
  collapsed = false,
  active,
  navItemClass,
  onNavigate,
}: Props) {
  const Icon = mod.icon || FileText;
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<CampaignChatDraft[]>(() => localPreview());
  const [loading, setLoading] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadGen = useRef(0);
  const fetchedOnce = useRef(false);

  const clearCloseTimer = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const loadDrafts = (opts?: { force?: boolean }) => {
    // Instant paint from local cache.
    const local = localPreview();
    if (local.length > 0) setDrafts(local);

    if (fetchedOnce.current && !opts?.force) return;

    const gen = ++loadGen.current;
    setLoading(local.length === 0);
    void listCampaignDraftsPageAsync({ limit: FETCH_LIMIT, offset: 0 })
      .then(({ drafts: rows }) => {
        if (gen !== loadGen.current) return;
        fetchedOnce.current = true;
        setDrafts(rows.slice(0, PREVIEW_LIMIT));
      })
      .catch(() => {
        if (gen !== loadGen.current) return;
        setDrafts(localPreview());
      })
      .finally(() => {
        if (gen !== loadGen.current) return;
        setLoading(false);
      });
  };

  const showPanel = () => {
    clearCloseTimer();
    setOpen(true);
    loadDrafts();
  };

  const hidePanel = () => {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setOpen(false), 180);
  };

  useEffect(() => () => clearCloseTimer(), []);

  const draftList = (
    <div className="mt-1 overscroll-contain rounded-xl border border-white/10 bg-white/[0.03]">
      <ul className="flex flex-col gap-0.5 py-1">
        {loading && drafts.length === 0 ? (
          <li className="px-3 py-2 text-xs text-white/45">Loading…</li>
        ) : null}
        {!loading && drafts.length === 0 ? (
          <li className="px-3 py-2 text-xs text-white/45">No drafts yet</li>
        ) : null}
        {drafts.map((draft) => {
          const label = displayDraftName(draft);
          return (
            <li key={draft.id}>
              <Link
                to={draftOpenPath(draft)}
                state={{
                  listHref: CREATE_CAMPAIGN_DRAFTS_HREF,
                  campaignName: draft.name,
                }}
                onClick={() => {
                  markCreateDraftActive(draft.id);
                  onNavigate?.();
                  setOpen(false);
                }}
                className="flex items-start justify-between gap-2 rounded-lg px-3 py-2 text-left no-underline transition hover:bg-white/5"
              >
                <span className="min-w-0 flex-1 truncate text-xs text-white/85">
                  {label}
                </span>
                <span className="shrink-0 text-[10px] text-white/40">
                  {formatDraftListTime(draft)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-white/10 px-1 py-1">
        <Link
          to={mod.href}
          onClick={() => {
            onNavigate?.();
            setOpen(false);
          }}
          className="block rounded-lg px-3 py-2 text-xs font-medium text-white/70 no-underline hover:bg-white/5 hover:text-white"
        >
          View all drafts
        </Link>
      </div>
    </div>
  );

  return (
    <li
      className="relative"
      onMouseEnter={collapsed ? undefined : showPanel}
      onMouseLeave={collapsed ? undefined : hidePanel}
    >
      <div
        className={`flex items-center ${collapsed ? "justify-center" : "gap-0.5"}`}
      >
        <Link
          to={mod.href}
          onClick={() => onNavigate?.()}
          title={collapsed ? mod.label : undefined}
          className={`min-w-0 flex-1 ${navItemClass(active, collapsed)}`}
        >
          <Icon className="size-4 shrink-0 opacity-90" strokeWidth={1.75} />
          {!collapsed ? (
            <span className="truncate text-inherit">{mod.label}</span>
          ) : null}
        </Link>
        {!collapsed ? (
          <button
            type="button"
            aria-label={open ? "Hide recent drafts" : "Show recent drafts"}
            aria-expanded={open}
            onClick={() => {
              if (open) {
                setOpen(false);
                return;
              }
              showPanel();
            }}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-white/60 hover:bg-white/5 hover:text-white"
          >
            <ChevronDown
              className={`size-4 transition ${open ? "rotate-180" : ""}`}
              strokeWidth={1.75}
            />
          </button>
        ) : null}
      </div>

      {open && !collapsed ? draftList : null}
    </li>
  );
}
