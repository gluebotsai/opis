"""Deterministic Contact Centre super-agent executor for A2A skills."""

from __future__ import annotations

import logging
from typing import Any

from cc_a2a.audit_log import log_a2a_trace
from cc_a2a.auth import CallerContext
from cc_a2a.catalog import L1_AGENT, SkillSpec, get_skill, list_skills
from cc_a2a.config import A2ASettings
from cc_a2a.contracts import (
    HubDelegationResult,
    HubHelpRequest,
    MissingInputStatus,
    PolicyDecision,
    SkillResultArtifact,
    WorktualEnvelope,
)
from cc_a2a.integrations.voice import VoiceBotTriggerError, trigger_auto_bot_call
from cc_a2a.integrations.webchat import (
    WebchatEngagementError,
    resolve_default_active_webchat,
    trigger_proactive_engagement,
)
from cc_a2a.mas import activate_assignment, executor_agent_name
from cc_a2a.overlay import OVERLAY_VERSION
from cc_a2a.policy import (
    PolicyError,
    confirmation_ids_for_policy,
    evaluate_policy,
)
from cc_a2a.prompts.hub_routing import HUB_DELEGATION_ROUTING_POLICY

logger = logging.getLogger("a2a.supervisor")

# Dispatch map is derived from the catalogue (single source of truth).
DISPATCH: dict[str, SkillSpec] = {skill.skill_id: skill for skill in list_skills()}


QUEUE_STAFF_ADD = "cc.queue.agent.add"
QUEUE_STAFF_REMOVE = "cc.queue.agent.remove"
_QUEUE_STAFF_MCP_KEYS = (
    "queueName",
    "addAgents",
    "removeAgentNames",
    "removeAgentIds",
)


def _blank(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str) and not value.strip():
        return True
    if isinstance(value, (list, dict, tuple)) and not value:
        return True
    return False


def _as_agent_rows(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    if isinstance(value, dict):
        return [value]
    if isinstance(value, list):
        return [item for item in value if item not in (None, "")]
    return []


def normalize_arguments(skill: SkillSpec, raw: dict[str, Any]) -> dict[str, Any]:
    args = dict(skill.argument_defaults)
    args.update(raw or {})
    for source, target in skill.argument_aliases.items():
        if source in args and target not in args:
            args[target] = args.pop(source)
        elif source in args and target in args:
            args.pop(source, None)
    if skill.skill_id == QUEUE_STAFF_ADD:
        return _normalize_queue_agent_add(args)
    if skill.skill_id == QUEUE_STAFF_REMOVE:
        return _normalize_queue_agent_remove(args)
    return args


def _normalize_queue_agent_add(args: dict[str, Any]) -> dict[str, Any]:
    rows = _as_agent_rows(args.get("addAgents") or args.get("agents"))
    if not rows:
        row: dict[str, Any] = {}
        if args.get("agentName"):
            row["name"] = str(args["agentName"]).strip()
        if args.get("agentId") or args.get("userId"):
            row["id"] = str(args.get("agentId") or args.get("userId")).strip()
        if args.get("shiftType"):
            row["shiftType"] = args["shiftType"]
        if args.get("channels"):
            row["channels"] = args["channels"]
        if args.get("capacity") is not None:
            row["capacity"] = args["capacity"]
        if args.get("callType"):
            row["callType"] = args["callType"]
        if row.get("name") or row.get("id"):
            rows = [row]
    args["addAgents"] = rows
    return args


def _normalize_queue_agent_remove(args: dict[str, Any]) -> dict[str, Any]:
    names = _as_agent_rows(args.get("removeAgentNames"))
    ids = [str(item).strip() for item in _as_agent_rows(args.get("removeAgentIds")) if str(item).strip()]
    extra = _as_agent_rows(args.get("agents"))
    if args.get("agentName"):
        names.append(str(args["agentName"]).strip())
    if args.get("agentId") or args.get("userId"):
        ids.append(str(args.get("agentId") or args.get("userId")).strip())
    for item in extra:
        if isinstance(item, dict):
            name = str(item.get("name") or item.get("agentName") or "").strip()
            agent_id = str(item.get("id") or item.get("userId") or item.get("agentId") or "").strip()
            if name:
                names.append(name)
            if agent_id:
                ids.append(agent_id)
        elif str(item).strip():
            names.append(str(item).strip())
    args["removeAgentNames"] = [name for name in names if name]
    args["removeAgentIds"] = [item for item in ids if item]
    return args


def queue_staff_mcp_arguments(skill: SkillSpec, args: dict[str, Any]) -> dict[str, Any]:
    """Pass only update_queue staffing fields so FastMCP does not reject Hub aliases."""
    allowed = {key: args[key] for key in _QUEUE_STAFF_MCP_KEYS if key in args and not _blank(args[key])}
    if skill.skill_id == QUEUE_STAFF_ADD:
        allowed.pop("removeAgentNames", None)
        allowed.pop("removeAgentIds", None)
    if skill.skill_id == QUEUE_STAFF_REMOVE:
        allowed.pop("addAgents", None)
    return allowed


def _has_required_argument(skill: SkillSpec, args: dict[str, Any], key: str) -> bool:
    if not _blank(args.get(key)):
        return True
    alias_target = skill.argument_aliases.get(key)
    if alias_target and not _blank(args.get(alias_target)):
        return True
    for source, target in skill.argument_aliases.items():
        if target == key and not _blank(args.get(source)):
            return True
    return False


def missing_required_fields(skill: SkillSpec, args: dict[str, Any]) -> list[str]:
    missing: list[str] = []
    required = list(skill.required_argument_keys)
    if skill.skill_id in {QUEUE_STAFF_ADD, QUEUE_STAFF_REMOVE} and _blank(args.get("queueName")):
        if not _blank(args.get("queueId")):
            required = [key for key in required if key != "queueName"]
        elif "queueName" not in required:
            missing.append("queueName")
    for key in required:
        if not _has_required_argument(skill, args, key):
            missing.append(key)
    if skill.skill_id == QUEUE_STAFF_REMOVE:
        if _blank(args.get("removeAgentNames")) and _blank(args.get("removeAgentIds")):
            missing.append("removeAgentNames")
    return missing


def build_tool_context(
    *,
    organization_id: str,
    caller: CallerContext,
    envelope: WorktualEnvelope,
    args: dict[str, Any],
    confirmed_actions: set[str],
):
    from app.schemas.copilot import ToolContext

    return ToolContext(
        tenant_id=organization_id,
        user_id=caller.service_actor,
        authorization=envelope.actorAuthorization,
        role="admin",
        queue_id=str(args["queueId"]) if args.get("queueId") is not None else None,
        contact_id=str(args["contactId"]) if args.get("contactId") is not None else None,
        task_id=str(args["taskId"]) if args.get("taskId") is not None else None,
        conversation_id=(
            str(args["conversationId"]) if args.get("conversationId") is not None else None
        ),
        confirmed_actions=set(confirmed_actions),
    )


async def call_mcp_tool(
    *,
    server_name: str,
    tool_name: str,
    context,
    arguments: dict[str, Any],
    agent_name: str,
    surface: str,
) -> dict[str, Any]:
    from app.mcp.client import MCPClient

    client = MCPClient()
    # Strip context entity keys that MCP rejects as trusted overrides when already bound.
    kwargs = dict(arguments)
    for trusted in (
        "organizationId",
        "tenantId",
        "tenant_id",
        "userId",
        "user_id",
        "authorization",
        "confirmed_actions",
        "surface",
        "role",
        "agent",
        "agent_name",
    ):
        kwargs.pop(trusted, None)
    return await client.call_tool(
        server_name,
        tool_name,
        context,
        kwargs,
        agent_name=agent_name,
        surface=surface,
    )


def _mas_domain(
    skill: SkillSpec,
    assignment: list[dict[str, Any]] | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "super": L1_AGENT,
        "domain": skill.domain,
        "executor": executor_agent_name(skill),
        "specialist": skill.specialist,
        "surface": skill.surface,
        "assignment": assignment or [],
    }
    if extra:
        payload.update(extra)
    return payload


def _artifact(
    envelope: WorktualEnvelope,
    *,
    outcome: str,
    evidence: dict[str, Any] | None = None,
    affected: dict[str, Any] | None = None,
    warnings: list[str] | None = None,
    policy: PolicyDecision | None = None,
    retryable: bool = False,
    message: str | None = None,
    domain: dict[str, Any] | None = None,
) -> SkillResultArtifact:
    return SkillResultArtifact(
        commandId=envelope.commandId,
        skillId=envelope.skillId,
        outcome=outcome,  # type: ignore[arg-type]
        affectedIds=affected or {},
        evidence=evidence or {},
        warnings=warnings or [],
        policy=policy,
        retryable=retryable,
        trace={
            "traceparent": envelope.traceparent,
            "overlayVersion": OVERLAY_VERSION,
        },
        domainReferences=domain or {},
        message=message,
    )


class SuperAgentExecutor:
    """Isolated per-task executor; never shares Copilot router singletons."""

    def __init__(self, settings: A2ASettings) -> None:
        self.settings = settings
        self._hub_delegation_cache: dict[tuple[str, str], HubDelegationResult] = {}

    async def delegate_to_hub(self, request: HubHelpRequest) -> HubDelegationResult:
        """Delegate CCaaS-originated leftover work to Intelligent Hub."""
        cache_key = (request.organizationId, request.commandId)
        cached = self._hub_delegation_cache.get(cache_key)
        if cached is not None:
            return cached

        if (request.source or "").strip().lower() == "hub":
            result = HubDelegationResult(
                commandId=request.commandId,
                outcome="rejected",
                message="Hub-originated work must not be delegated back to Hub",
                evidence={"routingPolicy": HUB_DELEGATION_ROUTING_POLICY},
            )
            self._hub_delegation_cache[cache_key] = result
            return result

        if request.hopCount >= self.settings.a2a_delegation_hop_budget:
            result = HubDelegationResult(
                commandId=request.commandId,
                outcome="rejected",
                message="Delegation hop budget exceeded",
                evidence={"hopCount": request.hopCount},
            )
            self._hub_delegation_cache[cache_key] = result
            return result

        if not self.settings.hub_a2a_base_url:
            result = HubDelegationResult(
                commandId=request.commandId,
                outcome="rejected",
                message="Hub remote agent is not configured (HUB_A2A_URL)",
            )
            self._hub_delegation_cache[cache_key] = result
            return result

        from cc_a2a.bridge.hub_client import HubRemoteAgentClient

        client = HubRemoteAgentClient(self.settings)
        result = await client.delegate(request)
        self._hub_delegation_cache[cache_key] = result
        return result

    async def execute(
        self,
        envelope: WorktualEnvelope,
        caller: CallerContext,
    ) -> SkillResultArtifact | MissingInputStatus:
        skill = get_skill(envelope.skillId)
        if skill is None or not skill.published:
            return _artifact(
                envelope,
                outcome="rejected",
                message=f"Unknown skillId: {envelope.skillId}",
            )

        if caller.execution_profile != "hub-delegated":
            return _artifact(
                envelope,
                outcome="rejected",
                message="executionProfile must be hub-delegated",
            )

        if envelope.hopCount > self.settings.a2a_delegation_hop_budget:
            return _artifact(
                envelope,
                outcome="rejected",
                message="Delegation hop budget exceeded",
            )

        args = normalize_arguments(skill, envelope.arguments)
        if skill.skill_id in {QUEUE_STAFF_ADD, QUEUE_STAFF_REMOVE}:
            args = await self._resolve_queue_staff_name(skill, envelope, caller, args)
        missing = missing_required_fields(skill, args)
        if missing:
            return MissingInputStatus(
                skillId=skill.skill_id,
                missingFields=missing,
                message=f"Missing required arguments: {', '.join(missing)}",
            )

        assignment = activate_assignment(skill, execution_profile=caller.execution_profile)

        if skill.skill_id == "cc.webchat.proactive-engagement.trigger":
            return await self._execute_webchat(
                skill, envelope, caller, args, assignment=assignment
            )

        if skill.skill_id == "cc.voice.auto-bot-call.trigger":
            return await self._execute_voice_bot(
                skill, envelope, caller, args, assignment=assignment
            )

        if skill.orchestration:
            return await self._execute_anomaly(
                skill, envelope, caller, args, assignment=assignment
            )

        return await self._execute_mcp_skill(
            skill, envelope, caller, args, assignment=assignment
        )

    async def _resolve_queue_staff_name(
        self,
        skill: SkillSpec,
        envelope: WorktualEnvelope,
        caller: CallerContext,
        args: dict[str, Any],
    ) -> dict[str, Any]:
        if not _blank(args.get("queueName")) or _blank(args.get("queueId")):
            return args
        context = build_tool_context(
            organization_id=envelope.organizationId,
            caller=caller,
            envelope=envelope,
            args=args,
            confirmed_actions=set(),
        )
        try:
            listed = await call_mcp_tool(
                server_name="queue",
                tool_name="list_queues",
                context=context,
                arguments={},
                agent_name="queue",
                surface=skill.surface,
            )
        except Exception:  # noqa: BLE001 — fall through to INPUT_REQUIRED for queueName
            logger.exception("Queue name resolve failed skill=%s queueId=%s", skill.skill_id, args.get("queueId"))
            return args
        queue_id = str(args["queueId"])
        queues = listed.get("queues") if isinstance(listed, dict) else None
        if not isinstance(queues, list):
            return args
        match = next(
            (
                queue
                for queue in queues
                if isinstance(queue, dict) and str(queue.get("id")) == queue_id
            ),
            None,
        )
        if match and match.get("name"):
            next_args = dict(args)
            next_args["queueName"] = str(match["name"])
            return next_args
        return args

    async def _execute_mcp_skill(
        self,
        skill: SkillSpec,
        envelope: WorktualEnvelope,
        caller: CallerContext,
        args: dict[str, Any],
        *,
        assignment: list[dict[str, Any]],
    ) -> SkillResultArtifact:
        assert skill.mcp_server and skill.mcp_tool
        tool_args = (
            queue_staff_mcp_arguments(skill, args)
            if skill.skill_id in {QUEUE_STAFF_ADD, QUEUE_STAFF_REMOVE}
            else dict(args)
        )
        domain = _mas_domain(skill, assignment)
        # confirmation hash must use the same args the MCP tool receives.
        try:
            policy = evaluate_policy(
                skill,
                caller,
                envelope,
                tool_arguments=tool_args,
            )
        except PolicyError as error:
            return _artifact(
                envelope,
                outcome=error.outcome,
                message=str(error),
                policy=error.policy,
                retryable=error.retryable,
                domain=domain,
            )

        confirmed = confirmation_ids_for_policy(skill, tool_args, policy)
        context = build_tool_context(
            organization_id=envelope.organizationId,
            caller=caller,
            envelope=envelope,
            args=args,
            confirmed_actions=confirmed,
        )

        try:
            result = await call_mcp_tool(
                server_name=skill.mcp_server,
                tool_name=skill.mcp_tool,
                context=context,
                arguments=tool_args,
                agent_name=executor_agent_name(skill),
                surface=skill.surface,
            )
        except Exception as error:  # noqa: BLE001 — map to failed artifact
            logger.exception("MCP skill execution failed skill=%s", skill.skill_id)
            return _artifact(
                envelope,
                outcome="failed",
                message=str(error),
                policy=policy,
                retryable=True,
                domain=domain,
            )

        if isinstance(result, dict) and result.get("_confirmation_required"):
            return _artifact(
                envelope,
                outcome="auth_required",
                evidence={"confirmation": result},
                policy=policy.model_copy(
                    update={
                        "requiresApproval": True,
                        "confirmationId": result.get("id") or policy.confirmationId,
                    }
                ),
                message=str(result.get("message") or "Confirmation required"),
                domain=domain,
            )

        warnings: list[str] = []
        if isinstance(result, dict) and result.get("warning"):
            warnings.append(str(result["warning"]))

        affected: dict[str, Any] = {}
        if isinstance(result, dict):
            for key in ("id", "contactId", "queueId", "taskId", "conversationId", "agentId"):
                if result.get(key) is not None:
                    affected[key] = result[key]
            if result.get("addedAgents"):
                affected["addedAgents"] = result["addedAgents"]
            if result.get("removedAgents"):
                affected["removedAgents"] = result["removedAgents"]

        return _artifact(
            envelope,
            outcome="succeeded",
            evidence={"tool": skill.mcp_tool, "server": skill.mcp_server, "result": result},
            affected=affected,
            warnings=warnings,
            policy=policy,
            domain=domain,
        )

    async def _execute_webchat(
        self,
        skill: SkillSpec,
        envelope: WorktualEnvelope,
        caller: CallerContext,
        args: dict[str, Any],
        *,
        assignment: list[dict[str, Any]],
    ) -> SkillResultArtifact:
        domain = _mas_domain(skill, assignment)
        try:
            policy = evaluate_policy(skill, caller, envelope, tool_arguments=args)
        except PolicyError as error:
            return _artifact(
                envelope,
                outcome=error.outcome,
                message=str(error),
                policy=error.policy,
                retryable=error.retryable,
                domain=domain,
            )

        webchat_id = args.get("webchatId")
        if isinstance(webchat_id, str):
            webchat_id = webchat_id.strip() or None
        resolved_webchat: dict[str, Any] | None = None
        if not webchat_id:
            log_a2a_trace(
                "STEP",
                command_id=envelope.commandId,
                step="resolve_default_webchat",
                organizationId=envelope.organizationId,
            )
            try:
                resolved_webchat = await resolve_default_active_webchat(
                    self.settings,
                    organization_id=envelope.organizationId,
                )
            except WebchatEngagementError as error:
                log_a2a_trace(
                    "STEP",
                    command_id=envelope.commandId,
                    step="resolve_default_webchat_failed",
                    statusCode=error.status_code,
                    outcome=error.outcome,
                    message=str(error),
                )
                return _artifact(
                    envelope,
                    outcome=error.outcome,
                    message=str(error),
                    policy=policy,
                    retryable=error.retryable,
                    evidence={"statusCode": error.status_code, "detail": error.payload},
                    domain=domain,
                )
            if not resolved_webchat or not resolved_webchat.get("webchatId"):
                return _artifact(
                    envelope,
                    outcome="input_required",
                    message="No active webchat for organization",
                    policy=policy,
                    retryable=False,
                    evidence={"organizationId": envelope.organizationId},
                    affected={"organizationId": envelope.organizationId},
                    domain=domain,
                )
            webchat_id = str(resolved_webchat["webchatId"])
            args = {**args, "webchatId": webchat_id}
            log_a2a_trace(
                "STEP",
                command_id=envelope.commandId,
                step="resolve_default_webchat_ok",
                webchatId=webchat_id,
                title=resolved_webchat.get("title"),
                channelConfigId=resolved_webchat.get("channelConfigId"),
            )
        else:
            log_a2a_trace(
                "STEP",
                command_id=envelope.commandId,
                step="use_provided_webchat",
                webchatId=webchat_id,
            )

        log_a2a_trace(
            "STEP",
            command_id=envelope.commandId,
            step="trigger_proactive_engagement",
            webchatId=webchat_id,
            visitorId=str(args["visitorId"]),
            hasText=bool(args.get("text")),
            autoSessionStart=args.get("autoSessionStart"),
            reason=args.get("reason"),
        )
        try:
            result = await trigger_proactive_engagement(
                self.settings,
                organization_id=envelope.organizationId,
                webchat_id=webchat_id,
                visitor_id=str(args["visitorId"]),
                text=args.get("text"),
                auto_session_start=args.get("autoSessionStart"),
                reason=args.get("reason"),
                page_url=args.get("pageUrl"),
                command_id=envelope.commandId,
            )
        except WebchatEngagementError as error:
            return _artifact(
                envelope,
                outcome=error.outcome,
                message=str(error),
                policy=policy,
                retryable=error.retryable,
                evidence={"statusCode": error.status_code, "detail": error.payload},
                domain=domain,
            )

        outcome = str(result.get("outcome") or "succeeded")
        evidence = dict(result)
        if resolved_webchat:
            evidence["resolvedWebchat"] = resolved_webchat
        if outcome == "visitor_offline":
            return _artifact(
                envelope,
                outcome="visitor_offline",
                evidence=evidence,
                policy=policy,
                retryable=False,
                message=result.get("message"),
                affected={
                    "webchatId": webchat_id,
                    "visitorId": args.get("visitorId"),
                },
                domain=domain,
            )

        return _artifact(
            envelope,
            outcome="succeeded",
            evidence=evidence,
            policy=policy,
            affected={
                "webchatId": webchat_id,
                "visitorId": args.get("visitorId"),
                "conversationId": result.get("conversationId"),
            },
            domain=_mas_domain(
                skill,
                assignment,
                extra={"sessionStarted": result.get("sessionStarted")},
            ),
        )

    async def _execute_voice_bot(
        self,
        skill: SkillSpec,
        envelope: WorktualEnvelope,
        caller: CallerContext,
        args: dict[str, Any],
        *,
        assignment: list[dict[str, Any]],
    ) -> SkillResultArtifact:
        domain = _mas_domain(skill, assignment)
        data = args.get("data") if args.get("data") is not None else {}
        if not isinstance(data, dict):
            return _artifact(
                envelope,
                outcome="rejected",
                message="data must be an object",
                retryable=False,
                domain=domain,
            )
        instruction = args.get("instruction") or ""
        if not isinstance(instruction, str):
            return _artifact(
                envelope,
                outcome="rejected",
                message="instruction must be a string",
                retryable=False,
                domain=domain,
            )
        try:
            policy = evaluate_policy(skill, caller, envelope, tool_arguments=args)
        except PolicyError as error:
            return _artifact(
                envelope,
                outcome=error.outcome,
                message=str(error),
                policy=error.policy,
                retryable=error.retryable,
                domain=domain,
            )

        try:
            result = await trigger_auto_bot_call(
                self.settings,
                organization_id=envelope.organizationId,
                number=str(args["number"]).strip(),
                data=data,
                instruction=instruction.strip(),
                command_id=envelope.commandId,
            )
        except VoiceBotTriggerError as error:
            return _artifact(
                envelope,
                outcome=error.outcome,
                message=str(error),
                policy=policy,
                retryable=error.retryable,
                evidence={"statusCode": error.status_code, "detail": error.payload},
                domain=domain,
            )

        return _artifact(
            envelope,
            outcome="succeeded",
            evidence=result,
            policy=policy,
            message="Voice bot call published",
            affected={
                "organizationId": envelope.organizationId,
                "sessionId": result.get("sessionId"),
            },
            domain=domain,
        )

    async def _execute_anomaly(
        self,
        skill: SkillSpec,
        envelope: WorktualEnvelope,
        caller: CallerContext,
        args: dict[str, Any],
        *,
        assignment: list[dict[str, Any]],
    ) -> SkillResultArtifact:
        domain = _mas_domain(
            skill,
            assignment,
            extra={"orchestration": list(skill.orchestration)},
        )
        try:
            policy = evaluate_policy(skill, caller, envelope, tool_arguments=args)
        except PolicyError as error:
            return _artifact(
                envelope,
                outcome=error.outcome,
                message=str(error),
                policy=error.policy,
                domain=domain,
            )

        evidence: dict[str, Any] = {"steps": []}
        # L1 coordinates unpublished L3 reads: analytics root-cause then monitoring snapshot.
        for step_id in skill.orchestration:
            step = get_skill(step_id)
            if step is None or not step.mcp_server or not step.mcp_tool:
                continue
            step_args = normalize_arguments(step, args)
            context = build_tool_context(
                organization_id=envelope.organizationId,
                caller=caller,
                envelope=envelope,
                args=step_args,
                confirmed_actions=set(),
            )
            try:
                result = await call_mcp_tool(
                    server_name=step.mcp_server,
                    tool_name=step.mcp_tool,
                    context=context,
                    arguments=step_args,
                    agent_name=executor_agent_name(step),
                    surface=step.surface,
                )
                evidence["steps"].append(
                    {
                        "skillId": step_id,
                        "domain": step.domain,
                        "executor": executor_agent_name(step),
                        "tool": step.mcp_tool,
                        "result": result,
                    }
                )
            except Exception as error:  # noqa: BLE001
                evidence["steps"].append(
                    {
                        "skillId": step_id,
                        "domain": step.domain,
                        "executor": executor_agent_name(step),
                        "tool": step.mcp_tool,
                        "error": str(error),
                    }
                )

        return _artifact(
            envelope,
            outcome="succeeded",
            evidence=evidence,
            policy=policy,
            message="Composite investigation evidence (read-only)",
            domain=domain,
        )
