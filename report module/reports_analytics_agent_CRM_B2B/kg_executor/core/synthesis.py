"""Structured Fact Synthesis Engine for CRM B2B Knowledge Graph."""

from __future__ import annotations

from typing import Any, Optional

from .llm import call_llm
from .loader import load_synthesis_prompt
from .models import Fact, QueryResult, SynthesisOutput
def _currency_symbol(curr: Any) -> str:
    """Convert currency code to symbol, or return code string."""
    if not curr or str(curr).upper().strip() in ("NONE", "NULL", "N/A", ""):
        return ""
    c = str(curr).upper().strip()
    symbols = {"USD": "$", "INR": "₹", "EUR": "€", "GBP": "£"}
    return symbols.get(c, f"{c} ")


def _format_value(val: Any) -> str:
    """Format numeric values or timestamps nicely."""
    if val is None:
        return "N/A"
    if isinstance(val, float):
        return f"{val:,.2f}"
    if isinstance(val, int):
        return f"{val:,}"
    if isinstance(val, list):
        return ", ".join(str(x) for x in val)
    return str(val)


def _is_summable_metric(col_name: str, values: list[Any]) -> bool:
    """Check if a column is a numeric quantity or amount that should be summed."""
    col_l = col_name.lower()
    if any(k in col_l for k in ["id", "year", "month", "day", "date", "code", "step", "status", "percent", "pct", "rate", "currency"]):
        return False
    return any(isinstance(v, (int, float)) for v in values if v is not None)


def _build_markdown_table(
    rows: list[dict[str, Any]], max_rows: int = 20, include_totals: bool = True
) -> tuple[str, dict[str, Any]]:
    """Format list of dicts as a GitHub markdown table with dynamic column totals."""
    if not rows:
        return "_No records found._\n", {}

    columns = list(rows[0].keys())
    header = "| " + " | ".join(c.replace("_", " ").title() for c in columns) + " |"
    separator = "| " + " | ".join("---" for _ in columns) + " |"

    body_lines = []
    for r in rows[:max_rows]:
        line = "| " + " | ".join(_format_value(r.get(c)) for c in columns) + " |"
        body_lines.append(line)

    totals: dict[str, Any] = {}
    if include_totals and len(rows) > 1:
        currency_col = next((c for c in columns if "currency" in c.lower()), None)
        distinct_currencies = (
            [
                str(r.get(currency_col)).upper().strip()
                for r in rows
                if r.get(currency_col) and str(r.get(currency_col)).upper().strip() not in ("NONE", "NULL", "N/A", "")
            ]
            if currency_col
            else []
        )
        distinct_currencies = list(dict.fromkeys(distinct_currencies))

        summable_cols = [c for c in columns if _is_summable_metric(c, [r.get(c) for r in rows])]
        if summable_cols:
            total_cells = []
            for i, c in enumerate(columns):
                if i == 0:
                    total_cells.append("**Total**")
                elif c in summable_cols:
                    is_amount_col = any(term in c.lower() for term in ["amount", "value", "total", "pipeline", "revenue", "price"])
                    if is_amount_col and len(distinct_currencies) > 1:
                        # Multi-currency: DO NOT sum across different currencies!
                        curr_totals = []
                        for curr in distinct_currencies:
                            s = sum(r.get(c, 0) for r in rows if str(r.get(currency_col)) == curr and isinstance(r.get(c), (int, float)))
                            sym = _currency_symbol(curr)
                            curr_totals.append(f"{sym}{_format_value(s)} ({curr})")
                        total_cells.append(f"**{' / '.join(curr_totals)}**")
                        totals[c] = ", ".join(curr_totals)
                    elif is_amount_col and len(distinct_currencies) == 1:
                        # Single currency across all rows
                        s = sum(r.get(c, 0) for r in rows if isinstance(r.get(c), (int, float)))
                        sym = _currency_symbol(distinct_currencies[0])
                        total_cells.append(f"**{sym}{_format_value(s)}**")
                        totals[c] = s
                    else:
                        # Simple count or non-currency metric
                        s = sum(r.get(c, 0) for r in rows if isinstance(r.get(c), (int, float)))
                        total_cells.append(f"**{_format_value(s)}**")
                        totals[c] = s
                elif c == currency_col:
                    if len(distinct_currencies) == 1:
                        total_cells.append(f"**{distinct_currencies[0]}**")
                    else:
                        total_cells.append("**Multi**")
                else:
                    total_cells.append("-")
            total_line = "| " + " | ".join(total_cells) + " |"
            body_lines.append(total_line)

    table_md = "\n".join([header, separator] + body_lines)
    if len(rows) > max_rows:
        table_md += f"\n\n_Showing top {max_rows} of {len(rows)} records._"
    return table_md, totals


def _verify_and_align_totals(text: str, precalculated_totals: dict[str, Any]) -> str:
    """Verify that narrative text does not contradict verified column totals."""
    import re
    aligned = text
    for col, total_val in precalculated_totals.items():
        if not isinstance(total_val, int) or total_val <= 0:
            continue
        col_clean = col.replace("_", " ").lower()
        # Require explicit 'total' keyword so per-row/daily counts are never mistakenly replaced
        pattern = re.compile(
            r"\b(\d+)\s+total\s+((?:open\s+)?(?:deals|opportunities|records|invoices|leads|tasks|items))\b",
            re.IGNORECASE,
        )
        def repl(match):
            num = int(match.group(1))
            rest = match.group(2)
            if "count" in col_clean or "deal" in col_clean:
                if num != total_val:
                    return f"{total_val} total {rest}"
            return match.group(0)

        aligned = pattern.sub(repl, aligned)
    return aligned


class FactSynthesizer:
    """Renders CRM B2B graph facts and tabular records into executive reporting text."""

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
        all_precalculated_totals: dict[str, Any] = {}
        for i, f in enumerate(facts):
            if f.breakdown:
                table_str, totals = _build_markdown_table(f.breakdown, max_rows=10, include_totals=True)
                all_precalculated_totals.update(totals)
                summary_line = ""
                if totals:
                    summary_parts = [f"Total {k.replace('_', ' ').title()} = {_format_value(v)}" for k, v in totals.items()]
                    summary_line = f" [Precalculated Verified Totals: {', '.join(summary_parts)}]"
                fact_blocks.append(f"Insight {i+1} ({f.label}){summary_line}:\n{table_str}")
            elif f.value is not None:
                val_str = _format_value(f.value)
                fact_blocks.append(f"Insight {i+1} ({f.label}): {val_str} {f.unit or ''}")

        facts_text = "\n\n".join(fact_blocks) if fact_blocks else "Zero records returned from the query."

        # Dynamic LLM synthesis
        user_msg = (
            f"User Question: {query}\n\n"
            f"Verified Facts from Knowledge Graph:\n{facts_text}\n\n"
            "Generate an authoritative Executive Commercial Briefing following your Section 2 synthesis principles: "
            "use dynamic natural topical headings (###) tailored to the question, present a clean Markdown table with bold verified totals, "
            "deliver deep commercial diagnosis grounded strictly in recorded properties, and provide realistic operational recommendations."
        )

        messages = [
            {"role": "system", "content": load_synthesis_prompt()},
            {"role": "user", "content": user_msg},
        ]
        llm_briefing = call_llm(messages, temperature=0.1, max_tokens=1200)

        # Validate that the LLM response is actual markdown
        if (
            llm_briefing
            and len(llm_briefing.strip()) > 30
            and not llm_briefing.strip().startswith("```json")
            and "unsupported_request" not in llm_briefing
        ):
            verified_markdown = _verify_and_align_totals(llm_briefing.strip(), all_precalculated_totals)
            return SynthesisOutput(
                markdown=verified_markdown,
                facts=facts,
                status="success",
                attempts_made=attempts_made,
                cypher_used=cypher_used or [],
            )

        # Fallback deterministic markdown builder
        lines: list[str] = []
        lines.append("### Commercial Summary & Facts\n")
        for f in facts:
            if f.breakdown:
                lines.append(f"#### {f.label}\n")
                tbl, _ = _build_markdown_table(f.breakdown, include_totals=True)
                lines.append(tbl)
                lines.append("")
            elif f.value is not None:
                val_str = _format_value(f.value)
                lines.append(f"- **{f.label}**: `{val_str}` {f.unit or ''}")

        if not facts:
            lines.append("No active CRM records found matching the requested query parameters.\n")

        lines.append("\n### Commercial Diagnosis\n")
        lines.append("Empirical graph traversal indicates current CRM records align with recorded stages, loss reasons, and commercial milestones.")

        lines.append("\n### Tactical Commercial Levers\n")
        lines.append("Review deal milestones, ensure quote approvals are linked to deals, and track invoice payment dates.")

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
        msg = error_payload.get("message", "An error occurred while querying the CRM B2B knowledge graph.")
        err_type = error_payload.get("error_type", "ERROR")
        attempts = error_payload.get("attempts_made", 1)

        md = (
            f"**CRM B2B Knowledge Graph Status**: `{err_type}`\n\n"
            f"{msg}\n\n"
            f"_Attempts made: {attempts}_"
        )
        return SynthesisOutput(
            markdown=md,
            status="error",
            error=msg,
            attempts_made=attempts,
        )
