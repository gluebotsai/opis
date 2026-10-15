"""Structured Fact Synthesis Engine for CCaaS Contact Center Knowledge Graph."""

from __future__ import annotations

from typing import Any, Optional

from .llm import call_llm
from .models import Fact, QueryResult, SynthesisOutput

EXECUTIVE_SYNTHESIS_PROMPT = """You are a Senior Contact Center (CCaaS) Operations & Analytics Specialist.
Your goal is to provide clear, simple, human-friendly, and genuinely useful answers based directly on verified contact center facts retrieved from the knowledge graph.

COMMUNICATION PRINCIPLES:
1. SIMPLE & HUMAN-UNDERSTANDABLE:
   - Write like a sharp, helpful operations analyst talking directly to a colleague or manager.
   - Avoid bloated corporate buzzwords, walls of text, and repetitive boilerplate filler.
   - Be concise and straight to the point. The user should be completely satisfied after reading your response in under 30 seconds.

2. ADAPT RESPONSE DEPTH TO THE QUERY TYPE (STRICT COMPLIANCE):
   A. FACTUAL / SINGLE METRIC LOOKUP (e.g., "What is total conversations?", "How many calls occurred yesterday?", "Total customers"):
      - State the answer clearly in the first sentence with the exact number.
      - Provide a short 1-2 sentence context explaining what this metric represents.
      - If helpful, provide a 1-row or 2-column compact metric card/table.
      - DO NOT provide "Next Steps", "Recommendations", "Funnel Implications", or "Root Causes" for simple lookups!

   B. BREAKDOWN / RANKING / COMPARISON (e.g., "Queue volume breakdown", "Agent workload ranking", "Channel distribution"):
      - Present a clean Markdown table with the numbers.
      - Add 2-3 brief, insightful bullet points highlighting the key patterns, top performers, or differences.
      - Keep commentary simple and natural. DO NOT add unsolicited "Next Best Actions" or generic strategies.

   C. ANOMALY / FRICTION / "WHY" / PROBLEM QUERIES (e.g., "Why did calls disconnect?", "Why was abandonment high?", "Why do unresolved conversations happen in queues?", "Routing errors"):
      - Ground the explanation STRICTLY in the empirical facts returned by the database.
      - HARD TELEMETRY OVERRIDES NARRATIVE TEXT: Hard categorical columns (end_actor, end_reason, disposition_code, assigned_agent_id, queue_id, handle duration, facts, summary) always override free-text narrative notes!
      - MANDATORY 4-STEP ROOT-CAUSE REPORTING:
        1. Population & Queue Distribution: State exact queue count and whether issues are isolated to a single queue (e.g., Support Queue).
        2. Telemetry Audit: Cite exact counts and percentages for end_actor, end_reason, and disposition_code (e.g., "100% (9/9) ended by agent with disposition agent_declined").
        3. Attribution Audit: Report whether the failures are isolated to a specific agent (e.g., Booxoo Admin) or distributed evenly across the team.
        4. Handle Duration: Report actual duration in minutes/seconds (distinguish multi-minute calls from instant drops).
        5. System Routing Facts: For webchat transfer chains, check system failure flags (e.g., reason_code=no_ready_agents, live_agent_unavailable).
      - STRICT ANTI-HALLUCINATION GUARDRAILS:
        * NEVER speculate about "audio instability", "network packet drops", or "technical connection failures" when end_actor is 'agent' and end_reason is 'agent_completed'.
        * If end_actor = 'agent' and end_reason = 'agent_completed', you are STRICTLY FORBIDDEN from calling it a "technical drop". Report it as an intentional agent-initiated termination with disposition agent_declined.
        * Do not assume multiple "queues" in plural if the data shows 100% of failures are isolated to 1 specific queue.
        * Only cite transcript quotes or disposition notes after citing hard telemetry numbers.

3. DATA ACCURACY:
   - Use only the numbers present in the retrieved facts. Never invent fake percentages or fictitious data.
   - If 0 records were returned, say so simply and explain why (e.g., no conversations recorded for that period).
   - Never output JSON, tool calls, or raw code. Always format as clean, readable Markdown.

4. NATURAL BUSINESS WORDS ONLY (NO GRAPH / DATABASE JARGON):
   - NEVER mention database or graph internals to the user.
   - Do NOT say "nodes", "relationships", "edges", "labels", or use syntax like "(:Conversation)", "[:ROUTED_TO]", or "(:Queue)".
   - Always explain using natural, real-world contact center terms:
     - Use "customer conversations", "chat sessions", "voice calls", "support queues", "support agents", "routing paths", "disconnect reasons", and "resolution outcomes".
   - Frame every insight in terms of real customer service operations and agent performance."""


def _format_value(val: Any) -> str:
    """Format numeric values or timestamps nicely."""
    if val is None:
        return "N/A"
    if isinstance(val, (int, float)):
        return f"{val:,}"
    if isinstance(val, list):
        return ", ".join(str(x) for x in val)
    return str(val)


def _build_markdown_table(rows: list[dict[str, Any]], max_rows: int = 20) -> str:
    """Format list of dicts as a GitHub markdown table."""
    if not rows:
        return "_No records found._\n"

    columns = list(rows[0].keys())
    header = "| " + " | ".join(c.replace("_", " ").title() for c in columns) + " |"
    separator = "| " + " | ".join("---" for _ in columns) + " |"

    body_lines = []
    for r in rows[:max_rows]:
        line = "| " + " | ".join(_format_value(r.get(c)) for c in columns) + " |"
        body_lines.append(line)

    table_md = "\n".join([header, separator] + body_lines)
    if len(rows) > max_rows:
        table_md += f"\n\n_Showing top {max_rows} of {len(rows)} records._"
    return table_md


class FactSynthesizer:
    """Renders contact center graph facts and tabular records into executive reporting text."""

    @staticmethod
    def synthesize(
        query: str,
        facts: list[Fact],
        query_results: list[QueryResult],
        attempts_made: int = 1,
        cypher_used: Optional[list[str]] = None,
    ) -> SynthesisOutput:
        # Build factual blocks
        fact_blocks = []
        for i, f in enumerate(facts):
            if f.breakdown:
                table_str = _build_markdown_table(f.breakdown, max_rows=10)
                fact_blocks.append(f"Insight {i+1} ({f.label}):\n{table_str}")
            elif f.value is not None:
                val_str = _format_value(f.value)
                fact_blocks.append(f"Insight {i+1} ({f.label}): {val_str} {f.unit or ''}")

        facts_text = "\n\n".join(fact_blocks) if fact_blocks else "Zero records returned from the query."

        # Dynamic LLM synthesis
        user_msg = (
            f"User Question: {query}\n\n"
            f"Verified Facts from Knowledge Graph:\n{facts_text}\n\n"
            "Answer the user's question clearly, concisely, and analytically following your communication principles. "
            "Tailor the depth strictly to the query type."
        )

        messages = [
            {"role": "system", "content": EXECUTIVE_SYNTHESIS_PROMPT},
            {"role": "user", "content": user_msg},
        ]
        llm_briefing = call_llm(messages, temperature=0.1, max_tokens=600)

        # Validate that the LLM response is actual markdown and not an unsupported JSON tool call
        if (
            llm_briefing
            and len(llm_briefing.strip()) > 30
            and not llm_briefing.strip().startswith("```json")
            and "unsupported_request" not in llm_briefing
        ):
            return SynthesisOutput(
                markdown=llm_briefing.strip(),
                facts=facts,
                status="success",
                attempts_made=attempts_made,
                cypher_used=cypher_used or [],
            )

        # Fallback deterministic markdown builder
        lines: list[str] = []
        lines.append("### Contact Center Operational Summary\n")
        for f in facts:
            if f.breakdown:
                lines.append(f"#### {f.label}\n")
                lines.append(_build_markdown_table(f.breakdown))
                lines.append("")
            elif f.value is not None:
                val_str = _format_value(f.value)
                lines.append(f"- **{f.label}**: `{val_str}` {f.unit or ''}")

        if not facts:
            lines.append("No active contact center records found matching the requested query parameters.")

        return SynthesisOutput(
            markdown="\n".join(lines).strip(),
            facts=facts,
            status="success",
            attempts_made=attempts_made,
            cypher_used=cypher_used or [],
        )

    @staticmethod
    def synthesize_error(error_payload: dict[str, Any]) -> SynthesisOutput:
        """Render security denials or execution errors cleanly in Markdown."""
        msg = error_payload.get("message", "An error occurred while querying the CCaaS knowledge graph.")
        err_type = error_payload.get("error_type", "ERROR")
        attempts = error_payload.get("attempts_made", 1)

        md = (
            f"**Contact Center Knowledge Graph Status**: `{err_type}`\n\n"
            f"{msg}\n\n"
            f"_Attempts made: {attempts}_"
        )
        return SynthesisOutput(
            markdown=md,
            status="error",
            error=msg,
            attempts_made=attempts,
        )
