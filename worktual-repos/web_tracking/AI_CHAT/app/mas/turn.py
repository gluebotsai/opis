"""Co-worker MAS entry — Super+Domain → reports domain agent → ClickHouse / semantic."""

from __future__ import annotations

import json
import logging
import os

from app.dashboard.generator import dashboard_generator
from app.mas.format_answer import enrich_answer_with_table
from app.mas.layers import run_super_domain
from app.reports.orchestrator import run_reports_turn
from app.mas.memory import to_standalone_query
from app.mas.messages import STARTER_SUGGESTIONS, service_unavailable
from app.mas.models import RouteDecision
from app.mas.ontology_fallback import resolve_ontology_slice
from app.mas.ontology_log import ontology_log_payload
from app.mas.prompts import read_layer
from app.memory.store import memory_store
from app.models.schemas import AgentResponse
from app.observability.turn_log import log_turn
from app.services.context_layer import AGENT_ANALYTICS
from app.services.llm_service import LLMServiceError, llm_service

logger = logging.getLogger(__name__)


class CoworkerMAS:
    async def run(
        self,
        *,
        message: str,
        website_id: int,
        session_id: str,
        dashboard_period: str | None = None,
        organization_id: int | None = None,
        user_id: int | None = None,
    ) -> AgentResponse:
        raw_user = (message or "").strip()
        if not raw_user:
            from app.mas.messages import empty_message

            return AgentResponse(answer=empty_message())

        memory_store.add_user(session_id, raw_user)
        memory = memory_store.get(session_id)
        history = memory_store.history_messages(session_id)

        if organization_id is None or user_id is None:
            logger.error("Chat missing organization_id or user_id")
            log_turn(
                {
                    "session_id": session_id,
                    "website_id": website_id,
                    "user_query": raw_user,
                    "error": "missing_organization_or_user",
                }
            )
            return self._reply(session_id, service_unavailable())

        try:
            standalone = await to_standalone_query(
                raw_user,
                history,
                dashboard_period=dashboard_period,
                last_standalone=memory.last_standalone,
            )
        except LLMServiceError as exc:
            log_turn(
                {
                    "session_id": session_id,
                    "website_id": website_id,
                    "user_query": raw_user,
                    "error": "standalone_llm_failed",
                    "bot_response": str(exc),
                }
            )
            return self._reply(session_id, str(exc))

        memory_store.set_last_standalone(session_id, standalone)

        slice_data, slice_source = resolve_ontology_slice(
            session_id=session_id,
            organization_id=organization_id,
            user_id=user_id,
            agent=AGENT_ANALYTICS,
        )
        if slice_data is None:
            logger.error("Ontology slice unavailable (no live, cache, or session snapshot)")
            log_turn(
                {
                    "session_id": session_id,
                    "website_id": website_id,
                    "user_query": raw_user,
                    "standalone_query": standalone,
                    "error": "ontology_slice_failed",
                }
            )
            return self._reply(session_id, service_unavailable())
        if slice_source != "live":
            logger.warning("Using ontology slice from %s after live fetch failed", slice_source)

        memory_store.set_ontology_slice(
            session_id,
            prompt=slice_data.prompt,
            metrics=[{"id": m.id, "dims": list(m.dims)} for m in slice_data.metrics],
            version=slice_data.version,
        )

        log_ctx: dict = {
            "session_id": session_id,
            "website_id": website_id,
            "user_query": raw_user,
            "standalone_query": standalone,
            "dashboard_period": dashboard_period,
            "ontology": ontology_log_payload(slice_data),
            "ontology_slice_request": {
                "organizationId": organization_id,
                "userId": user_id,
                "product": "webtracking",
                "agent": AGENT_ANALYTICS,
                "format": "prompt",
            },
            "ontology_slice_source": slice_source,
        }

        try:
            route = await run_super_domain(
                message=standalone,
                history=history,
                dashboard_period=dashboard_period,
                ontology_prompt=slice_data.prompt,
            )
        except LLMServiceError as exc:
            log_ctx["bot_response"] = str(exc)
            log_turn(log_ctx)
            return self._reply(session_id, str(exc))

        log_ctx["route"] = route.model_dump()

        handled = self._handle_route(route, session_id)
        if handled is not None:
            log_ctx["bot_response"] = handled.answer
            log_turn(log_ctx)
            return handled

        if route.domain == "drilldown":
            answer = (
                "Visitor and session row lists aren't available in co-worker chat yet. "
                "Try a certified KPI or a top-pages ranking for this site."
            )
            log_ctx["bot_response"] = answer
            log_turn(log_ctx)
            return self._reply(session_id, answer, STARTER_SUGGESTIONS)

        objective = (route.objective or standalone).strip()
        domain = route.domain or "site_kpi"

        try:
            reports = await run_reports_turn(
                standalone=standalone,
                objective=objective,
                domain=domain,
                website_id=website_id,
                organization_id=organization_id,
                user_id=user_id,
                dashboard_period=dashboard_period,
                slice_data=slice_data,
            )
        except LLMServiceError as exc:
            log_ctx["bot_response"] = str(exc)
            log_turn(log_ctx)
            return self._reply(session_id, str(exc))

        if reports.clarify_question:
            log_ctx["bot_response"] = reports.clarify_question
            log_turn(log_ctx)
            return self._reply(session_id, reports.clarify_question, STARTER_SUGGESTIONS)

        log_ctx["reports_domain_plan"] = reports.domain_plan
        log_ctx["reports_task_results"] = reports.task_results
        log_ctx["reports_combined_facts"] = reports.combined_facts
        log_ctx["semantic_plan"] = reports.semantic_plan
        log_ctx["executor_plan_raw"] = reports.semantic_plan
        if reports.context_layer_request:
            log_ctx["context_layer_semantic_request"] = reports.context_layer_request
            log_ctx["context_layer_semantic_response"] = reports.context_layer_response

        columns = reports.columns
        rows = reports.rows
        data_source = reports.data_source
        sql_ref = reports.sql_or_ref
        plan_metrics = (
            [reports.primary_metric]
            if reports.primary_metric
            else (reports.semantic_plan or {}).get("metrics") or []
        )

        log_ctx["data_source"] = data_source
        log_ctx["sql_or_context"] = sql_ref

        answer = enrich_answer_with_table(reports.answer, columns, rows)
        hint = "table" if len(rows) > 1 else None
        dashboard = dashboard_generator.build(columns, rows, hint=hint)

        if os.environ.get("AI_CHAT_LLM_REPLY", "").strip() in ("1", "true", "yes"):
            answer, suggestions = await self._llm_reply(standalone, columns, rows, answer)
        else:
            suggestions = list(STARTER_SUGGESTIONS)

        log_ctx["bot_response"] = answer
        log_turn(log_ctx)

        memory_store.add_assistant(
            session_id,
            answer,
            sql=sql_ref,
            columns=columns,
            rows=rows[:20],
            active_period=dashboard_period,
        )
        return AgentResponse(
            answer=answer,
            dashboard=dashboard,
            summary={
                "row_count": len(rows),
                "metrics": plan_metrics,
                "data_source": data_source,
            },
            suggested_questions=suggestions,
        )

    def _handle_route(self, route: RouteDecision, session_id: str) -> AgentResponse | None:
        if route.action == "greet":
            reply = (route.greet_reply or "Hello! Ask me anything about your site analytics.").strip()
            return self._reply(session_id, reply, STARTER_SUGGESTIONS)
        if route.action == "refuse":
            reply = (route.refuse_reply or "I can only help with Web Tracking analytics for your site.").strip()
            return self._reply(session_id, reply, STARTER_SUGGESTIONS)
        if route.action == "clarify":
            q = (route.clarify_question or "Could you add a time range or metric?").strip()
            return self._reply(session_id, q, STARTER_SUGGESTIONS)
        if route.action != "analytics":
            return self._reply(session_id, service_unavailable())
        return None

    async def _llm_reply(
        self,
        user_message: str,
        columns: list[str],
        rows: list[list],
        draft: str,
    ) -> tuple[str, list[str]]:
        system = read_layer("reply.md")
        summary = json.dumps({"columns": columns, "rows": rows[:15], "draft": draft})
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": f"Question: {user_message}\nData: {summary}"},
        ]
        try:
            raw = await llm_service.complete_json(messages, max_tokens=600, temperature=0.3)
            answer = str(raw.get("answer") or draft)
            sug = raw.get("suggested_questions")
            if isinstance(sug, list) and sug:
                return answer, [str(s) for s in sug[:3]]
        except Exception:
            logger.exception("Optional reply LLM failed")
        return draft, list(STARTER_SUGGESTIONS)

    @staticmethod
    def _reply(
        session_id: str,
        answer: str,
        suggestions: list[str] | None = None,
    ) -> AgentResponse:
        memory_store.add_assistant(session_id, answer)
        return AgentResponse(
            answer=answer,
            suggested_questions=suggestions or list(STARTER_SUGGESTIONS),
        )


agent = CoworkerMAS()
