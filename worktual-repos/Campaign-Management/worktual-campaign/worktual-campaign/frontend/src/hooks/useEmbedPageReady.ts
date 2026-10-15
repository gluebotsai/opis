import { useEffect } from "react";
import { blockEmbedContentReady, isEmbedMode } from "@/lib/embed-auth";

/**
 * Hold CRM iframe reveal until this page has real content (not route skeletons).
 * Pass false while loading; true when the workspace UI is visible.
 */
export function useEmbedPageReady(isReady: boolean) {
  useEffect(() => {
    if (!isEmbedMode() || isReady) return;
    return blockEmbedContentReady();
  }, [isReady]);
}
