import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AlertCircle, Loader2 } from "lucide-react";
import {
  buildCampaignEmbedSrc,
  campaignNavigatePath,
  campaignPathForCrmPathname,
  campaignPostMessageOrigin,
  crmPathnameForCampaignLocation,
  isCampaignInboundMessage,
  resolveCampaignIframeBase,
} from "@/lib/campaign-portal-nav";
import {
  clearMarketingEmbedCache,
  loadMarketingEmbedSession,
  peekMarketingEmbedSession,
} from "@/lib/marketing-embed-perf";
import type { MarketingEmbedSession } from "@/services/marketing";

const AUTH_REFRESH_MS = 8 * 60 * 1000;
/** Soft reveal if Campaign READY is late — keep short so spinner does not dominate. */
const READY_FALLBACK_MS = 5_000;

type PortalState =
  | { phase: "loading" }
  | { phase: "unavailable"; message: string }
  | {
      phase: "ready";
      session: MarketingEmbedSession;
      iframeSrc: string;
    };

function postCampaignAuth(
  iframe: HTMLIFrameElement | null,
  uiBaseUrl: string,
  token: string,
) {
  if (!iframe?.contentWindow) return;
  iframe.contentWindow.postMessage(
    { type: "worktual:campaign-auth", token },
    campaignPostMessageOrigin(uiBaseUrl),
  );
}

function sessionToPortalState(
  session: MarketingEmbedSession,
  pathname: string,
  search: string,
): PortalState {
  const iframeBase = resolveCampaignIframeBase(session.uiOrigin);
  if (!iframeBase || !session.token) {
    return {
      phase: "unavailable",
      message: session.uiOrigin?.includes("/campaign-proxy")
        ? "CAMPAIGN_UI_URL must be the Campaign host (e.g. https://rebuild-campaign.worktual.com), not CRM /campaign-proxy."
        : session.uiOrigin
          ? "Campaign UI origin is invalid. Check CAMPAIGN_UI_URL."
          : "Campaign connect is not configured. Set MARKETING_MS_URL, CAMPAIGN_UI_URL, and JWT_ACCESS_SECRET (same secret as Campaign CRM_JWT_ACCESS_SECRET).",
    };
  }
  const path = campaignPathForCrmPathname(pathname, search);
  return {
    phase: "ready",
    session,
    iframeSrc: buildCampaignEmbedSrc(iframeBase, path, session.token),
  };
}

type MarketingPortalPageProps = {
  /** When false, iframe stays mounted (keep-alive) but soft-nav / overlay are paused. */
  active?: boolean;
};

export function MarketingPortalPage({ active = true }: MarketingPortalPageProps) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const campaignPath = useMemo(
    () => campaignPathForCrmPathname(pathname, search),
    [pathname, search],
  );

  const [state, setState] = useState<PortalState>(() => {
    const peek = peekMarketingEmbedSession();
    if (!peek) return { phase: "loading" };
    return sessionToPortalState(peek, pathname, search);
  });
  const [iframeReady, setIframeReady] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const sessionRef = useRef<MarketingEmbedSession | null>(
    peekMarketingEmbedSession(),
  );
  const lastNavPathRef = useRef<string | null>(
    state.phase === "ready"
      ? campaignPathForCrmPathname(pathname, search)
      : null,
  );
  const syncingFromCampaignRef = useRef(false);
  const locationRef = useRef({ pathname, search });
  locationRef.current = { pathname, search };

  const applySession = useCallback((session: MarketingEmbedSession) => {
    sessionRef.current = session;
    const next = sessionToPortalState(
      session,
      locationRef.current.pathname,
      locationRef.current.search,
    );
    if (next.phase === "ready") {
      lastNavPathRef.current = campaignPathForCrmPathname(
        locationRef.current.pathname,
        locationRef.current.search,
      );
    }
    setState(next);
  }, []);

  const loadSession = useCallback(
    async (options: { force?: boolean } = {}) => {
      const force = Boolean(options.force);
      if (force) {
        setState({ phase: "loading" });
        setIframeReady(false);
        lastNavPathRef.current = null;
      } else {
        const peek = peekMarketingEmbedSession();
        if (peek) {
          applySession(peek);
        } else {
          setState({ phase: "loading" });
        }
      }

      try {
        const session = await loadMarketingEmbedSession({ force });
        applySession(session);
      } catch (err) {
        clearMarketingEmbedCache();
        setState({
          phase: "unavailable",
          message:
            err instanceof Error
              ? err.message
              : "Could not open Campaign. Try again in a moment.",
        });
      }
    },
    [applySession],
  );

  useEffect(() => {
    void loadSession({ force: false });
  }, [loadSession]);

  useEffect(() => {
    if (!active || state.phase !== "ready") return;
    const { session } = state;
    const iframeBase = resolveCampaignIframeBase(session.uiOrigin);
    if (!iframeBase) return;

    const allowedOrigin = campaignPostMessageOrigin(iframeBase);

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== allowedOrigin) return;
      if (!isCampaignInboundMessage(event.data)) return;

      if (event.data.type === "worktual:campaign-ready") {
        setIframeReady(true);
        return;
      }

      // LOCATION → parent URL only. Never post NAVIGATE in response.
      if (event.data.type === "worktual:campaign-location") {
        const locationPath =
          typeof event.data.path === "string" ? event.data.path : null;
        if (!locationPath) return;
        const crmTarget = crmPathnameForCampaignLocation(locationPath);
        if (!crmTarget) return;

        const targetUrl = new URL(crmTarget, "http://crm.local");
        const current = `${pathname}${search}`;
        const next = `${targetUrl.pathname}${targetUrl.search}`;
        if (current === next) return;

        syncingFromCampaignRef.current = true;
        navigate(next, { replace: true });
      }
    };

    window.addEventListener("message", onMessage);
    const readyTimer = window.setTimeout(() => {
      setIframeReady(true);
    }, READY_FALLBACK_MS);

    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(readyTimer);
    };
  }, [active, navigate, pathname, search, state]);

  useEffect(() => {
    if (!active || state.phase !== "ready") return;
    const session = sessionRef.current;
    if (!session?.token) return;
    const iframeBase = resolveCampaignIframeBase(session.uiOrigin);
    if (!iframeBase) return;

    if (syncingFromCampaignRef.current) {
      syncingFromCampaignRef.current = false;
      lastNavPathRef.current = campaignPath;
      return;
    }

    if (lastNavPathRef.current === campaignPath) return;

    if (iframeReady && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        {
          type: "worktual:campaign-navigate",
          path: campaignNavigatePath(campaignPath),
        },
        campaignPostMessageOrigin(iframeBase),
      );
      lastNavPathRef.current = campaignPath;
    }
  }, [active, campaignPath, iframeReady, state]);

  useEffect(() => {
    if (!active || state.phase !== "ready") return;
    const session = sessionRef.current;
    if (!session?.token) return;
    const iframeBase = resolveCampaignIframeBase(session.uiOrigin);
    if (!iframeBase) return;

    const refresh = () => {
      postCampaignAuth(iframeRef.current, iframeBase, session.token);
    };

    refresh();
    const timer = window.setInterval(refresh, AUTH_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [active, state]);

  const onIframeLoad = () => {
    const session = sessionRef.current;
    const iframeBase = resolveCampaignIframeBase(session?.uiOrigin ?? null);
    if (!iframeBase || !session?.token) return;
    postCampaignAuth(iframeRef.current, iframeBase, session.token);
  };

  if (state.phase === "loading") {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center bg-[#f3f4f6] px-6 py-16">
        <Loader2 className="size-8 animate-spin text-text-caption" />
        <p className="mt-4 text-sm font-medium text-text-primary">
          Connecting to Campaign…
        </p>
        <p className="mt-1 text-sm text-text-caption">
          Opening the Campaign workspace for your organization.
        </p>
      </div>
    );
  }

  if (state.phase === "unavailable") {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center bg-[#f3f4f6] px-6 py-16 text-center">
        <span className="inline-flex size-12 items-center justify-center rounded-xl bg-surface text-text-caption">
          <AlertCircle className="size-6" strokeWidth={1.75} />
        </span>
        <p className="mt-4 text-sm font-medium text-text-primary">
          Campaign unavailable
        </p>
        <p className="mt-1 max-w-md text-sm text-text-caption">
          {state.message}
        </p>
        <button
          type="button"
          onClick={() => void loadSession({ force: true })}
          className="mt-6 rounded-lg border border-border-default bg-surface px-4 py-2 text-sm font-medium text-text-primary hover:border-border-strong"
        >
          Retry
        </button>
      </div>
    );
  }

  const { iframeSrc } = state;

  // Overlay uses z-index only — never display:none / visibility:hidden / opacity:0 on the iframe
  // (Chromium freezes cross-origin iframe JS and READY never fires).
  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col bg-[#f3f4f6]">
      {!iframeReady ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#f3f4f6]">
          <Loader2 className="size-8 animate-spin text-text-caption" />
          <p className="mt-4 text-sm font-medium text-text-primary">
            Opening Campaign workspace…
          </p>
        </div>
      ) : null}
      <iframe
        ref={iframeRef}
        title="Campaign workspace"
        src={iframeSrc}
        onLoad={onIframeLoad}
        className="h-full min-h-0 w-full flex-1 border-0 bg-[#f3f4f6]"
        allow="clipboard-write"
      />
    </div>
  );
}
