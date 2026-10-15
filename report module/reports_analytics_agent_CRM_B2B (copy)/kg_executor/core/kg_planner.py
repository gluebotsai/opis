"""CRM B2B Knowledge Graph Planner for dynamic Cypher and certified template selection."""

from __future__ import annotations

import re
import uuid
from typing import Any, Optional

from .llm import call_llm, extract_json
from .loader import (
    get_schema_summary,
    get_templates_summary,
    load_agent_prompt,
    load_few_shots,
)
from .models import AgentContext, ExecutionPlan, PlanStep


class KGPlanner:
    """Decides whether to execute a certified template or generate a dynamic Cypher query."""

    @staticmethod
    def plan(
        user_query: str,
        context: AgentContext,
        feedback: Optional[dict[str, Any]] = None,
    ) -> ExecutionPlan:
        plan_id = f"plan_{uuid.uuid4().hex[:8]}"

        agent_prompt = load_agent_prompt()
        schema_summary = get_schema_summary()
        templates_summary = get_templates_summary()
        few_shots = load_few_shots()

        full_system_prompt = (
            f"{agent_prompt}\n\n"
            f"{schema_summary}\n\n"
            f"{templates_summary}\n\n"
            f"## Few-Shot Cypher Examples:\n{few_shots}"
        )

        user_content = (
            f"Caller Identity: role={context.role}, org_id={context.org_id}, user_id={context.user_id}\n"
            f"User Query: {user_query.strip()}"
        )
        if feedback:
            user_content += (
                f"\n\nREPLAN_REQUEST (Attempt {feedback.get('attempt')}/{feedback.get('max_attempts')}): "
                f"Error: {feedback.get('error')}. Instruction: {feedback.get('instruction')}"
            )
            prev = feedback.get("previous_cypher") or feedback.get("previous_query")
            if prev:
                user_content += (
                    f"\nPrevious Cypher (do not repeat this MATCH):\n{prev}"
                )


        messages = [
            {"role": "system", "content": full_system_prompt},
            {"role": "user", "content": user_content},
        ]

        llm_response = call_llm(messages, temperature=0.1, max_tokens=1000)
        tool_call = extract_json(llm_response) if llm_response else {}

        steps: list[PlanStep] = []
        if tool_call:
            if tool_call.get("tool") == "unsupported_request":
                reason = tool_call.get("reason", "This request is not supported by the CRM B2B database schema.")
                steps.append(
                    PlanStep(
                        step_id="t1",
                        tool="unsupported",
                        template_name=None,
                        cypher="",
                        params={},
                        description=reason,
                    )
                )
                return ExecutionPlan(plan_id=plan_id, goal=user_query, steps=steps)

            template_name = tool_call.get("template")
            cypher = tool_call.get("cypher", "")
            params = tool_call.get("params", {})

            if template_name in (None, "null", "", "None"):
                template_name = None

            # Always ensure org_id is present in params
            if isinstance(params, dict) and "org_id" not in params:
                params["org_id"] = context.org_id

            steps.append(
                PlanStep(
                    step_id="t1",
                    tool="cypher",
                    template_name=template_name,
                    cypher=cypher,
                    params=params,
                    description=user_query,
                )
            )
            return ExecutionPlan(plan_id=plan_id, goal=user_query, steps=steps)

        # Honest failure if LLM does not return a structured plan (NO keyword guessing)
        steps.append(
            PlanStep(
                step_id="t1",
                tool="unsupported",
                template_name=None,
                cypher="",
                params={},
                description="The Knowledge Graph Planner was unable to generate a valid graph execution plan for this query.",
            )
        )
        return ExecutionPlan(plan_id=plan_id, goal=user_query, steps=steps)
