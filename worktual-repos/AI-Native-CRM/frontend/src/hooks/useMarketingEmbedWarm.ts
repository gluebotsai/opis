import { useEffect } from "react";
import {
  isMarketingEmbedWarm,
  loadMarketingEmbedSession,
} from "@/lib/marketing-embed-perf";

/** Prefetch embed-session after login and when hovering Marketing nav links. */
export function useMarketingEmbedWarm(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    void loadMarketingEmbedSession().catch(() => {
      /* warm is best-effort */
    });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    const onPointerOver = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const href = anchor.getAttribute("href") ?? "";
      if (
        !href.startsWith("/marketing") &&
        !href.startsWith("/configuration/campaign")
      ) {
        return;
      }
      if (isMarketingEmbedWarm()) return;
      void loadMarketingEmbedSession().catch(() => {
        /* warm is best-effort */
      });
    };

    document.addEventListener("pointerover", onPointerOver, true);
    return () => {
      document.removeEventListener("pointerover", onPointerOver, true);
    };
  }, [enabled]);
}
