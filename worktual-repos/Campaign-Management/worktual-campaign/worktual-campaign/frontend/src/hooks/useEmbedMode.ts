import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { isEmbedMode, persistEmbedModeIfQuery } from "@/lib/embed-auth";

/** Reactive embed flag — persists ?embed=1 across client-side route changes. */
export function useEmbedMode(): boolean {
  const { search } = useLocation();
  const embed = isEmbedMode();

  useEffect(() => {
    persistEmbedModeIfQuery();
  }, [search]);

  return embed;
}
