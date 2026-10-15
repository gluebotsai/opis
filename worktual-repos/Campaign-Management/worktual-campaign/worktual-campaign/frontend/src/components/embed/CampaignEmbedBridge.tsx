import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  announceEmbedLocation,
  announceEmbedReadyAfterPaint,
  isEmbedContentReady,
  startEmbedNavigateListener,
  subscribeEmbedContentReady,
  toEmbedLocationPath,
} from "@/lib/embed-auth";
import { resolveCreateSoftNavPath } from "@/lib/create-campaign-active-session";

function normalizeIncomingPath(path: string): string {
  const raw = String(path || "").trim();
  const q = raw.indexOf("?");
  const pathname = q >= 0 ? raw.slice(0, q) : raw;
  const search = q >= 0 ? raw.slice(q) : "";
  return toEmbedLocationPath(pathname, search);
}

/**
 * CRM iframe bridge — post READY after painted content; accept parent navigations;
 * report full location (path + search) so CRM can deep-link the parent URL.
 * Mount only when auth succeeded and AppShell is rendering real routes.
 */
export function CampaignEmbedBridge() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const [readyTick, setReadyTick] = useState(0);
  const embedPath = toEmbedLocationPath(pathname, search);
  const embedPathRef = useRef(embedPath);
  embedPathRef.current = embedPath;

  useEffect(
    () =>
      startEmbedNavigateListener((path) => {
        const next = resolveCreateSoftNavPath(path);
        if (normalizeIncomingPath(next) === embedPathRef.current) return;
        navigate(next);
      }),
    [navigate],
  );

  useEffect(() => subscribeEmbedContentReady(() => setReadyTick((t) => t + 1)), []);

  useEffect(() => {
    if (!isEmbedContentReady()) return;
    announceEmbedLocation(embedPath);
  }, [embedPath, readyTick]);

  useEffect(() => {
    if (!isEmbedContentReady()) return;
    return announceEmbedReadyAfterPaint(embedPath);
    // READY is the reveal handshake — do not re-fire on search-only changes (?id=).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pathname + readyTick only
  }, [pathname, readyTick]);

  return null;
}
