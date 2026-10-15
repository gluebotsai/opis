# Recommendations workflow

**Board agent tools:** LOAD_PAST_CAMPAIGNS, GENERATE_RECOMMENDATIONS, ROUTE_TO_MODULE.

The board agent reads past campaigns and puts ideas on the Recommendations board. It does not launch.

## How ideas are chosen

1. **Past exists and some engagement** (opens/clicks, or ads CTR/conversions): clone/adapt winners. Prefer higher open/click, then lower fail/bounce. `why_created` names the past campaign and the metric.
2. **Past exists but ~0% opens/clicks:** still recommend. Honest why. Follow-up on the same or tighter audience/channels/timing. Do not invent unrelated seasonal filler.
3. **No past:** recommend from knowledge. `why_created` says this is knowledge-based because nothing has been sent.

Empty GENERATE list is allowed when nothing useful exists. Do not invent card JSON in chat. No hardcoded seed cards and no LLM-empty → seed fallback.

## Card fields (required)

title, goal, objective, channels, audience, why_created, timing_label.

## Click a card — run agent

Opens the same split as Create campaign: chat left, **Campaign overview** right, prefilled from the card.

A **separate run agent** (create-campaign tools, recommendation-run prompt) asks once: edit this recommendation, or run this campaign?

- Edit: change name / goal / objective / audience / channels / timing. Panel updates via tools.
- Run / as-is: resolve real CRM audience, keep or change channels, `build_campaign` for templates, then `launch_campaign` only after they confirm send.

Suggested audience on the card is a hint, not a matched list. Unused board cards still drop off after suggested send time; launched cards are marked used and stay.
