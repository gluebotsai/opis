/** Match Python `deal_coworker_agent._wants_create_proposal` for client-side routing. */
export function looksLikeCreateProposalIntent(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (
    /\b(move|change|set|update|advance|push)\s+(to\s+)?(propos(?:e|al)|negotiat)/.test(
      lower,
    )
  ) {
    return false;
  }
  return (
    /\b(create|draft|write|prepare|generate|make|start|build)\b.{0,40}\b(propos(?:al|e)|rfp)\b/.test(
      lower,
    ) ||
    /\b(new|a|an)\s+(sales\s+)?proposal\b/.test(lower) ||
    /\bpropos(?:al|e)\s+for\b/.test(lower) ||
    /^\s*(the\s+)?proposal\s*$/.test(lower)
  );
}
