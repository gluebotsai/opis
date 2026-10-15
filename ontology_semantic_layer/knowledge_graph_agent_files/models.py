# ==============================================================================
# models.py — Data Contracts for Knowledge Graph Agent
# ==============================================================================

import os
import uuid
import datetime
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, asdict
from pydantic import BaseModel, Field


@dataclass
class ActivityEvent:
    step_id: str
    status: str
    title: str
    description: str


class AccessScope(BaseModel):
    """
    Role-based security scope resolved from caller credentials and request context.
    - level: 'self' (employee), 'team' (team lead/manager), 'org' (admin/executive)
    """
    level: str = "self"
    role: str = "employee"
    user_id: Optional[str] = None
    team_ids: List[str] = Field(default_factory=list)
    queue_ids: List[str] = Field(default_factory=list)
    agent_ids: List[str] = Field(default_factory=list)


class KnowledgeGraphRequest(BaseModel):
    """
    Standard request contract for Knowledge Graph Agent.
    Accepts natural language query and tenant/user security context.
    """
    query: str = Field(..., description="Natural language user question")
    organization_id: Optional[str] = Field(None, description="Tenant organization ID (e.g. '1012')")
    org_id: Optional[str] = Field(None, description="Alias for organization_id")
    user_id: Optional[str] = Field(None, description="Authenticated user ID")
    role: Optional[str] = Field(None, description="User role (defaults to least-privileged 'employee')")
    scope: Optional[Dict[str, Any]] = Field(None, description="Optional scoping filters (e.g. team_id)")
    session_id: Optional[str] = Field(None, description="Conversation session ID")
    sessionID: Optional[str] = Field(None, description="Alias for session_id")
    debug: Optional[bool] = Field(False, description="Whether to include trace and Cypher details in response")

    def model_post_init(self, __context: Any) -> None:
        # Normalize org_id aliases
        if not self.org_id and self.organization_id:
            self.org_id = str(self.organization_id)
        elif not self.organization_id and self.org_id:
            self.organization_id = str(self.org_id)

        # Normalize session_id aliases
        if not self.session_id and self.sessionID:
            self.session_id = str(self.sessionID)
        elif not self.sessionID and self.session_id:
            self.sessionID = str(self.session_id)
        elif not self.session_id and not self.sessionID:
            new_id = str(uuid.uuid4())
            self.session_id = new_id
            self.sessionID = new_id

        # Least-privilege default role
        if not self.role:
            try:
                from .config import get_config
                self.role = get_config().access.default_role
            except Exception:
                self.role = "employee"

        # Default user ID
        if not self.user_id:
            self.user_id = os.getenv("USER_ID", "anonymous")

    def get_org_id(self) -> str:
        from .config import validate_org_id
        return validate_org_id(self.org_id or self.organization_id)

    def get_session_id(self) -> str:
        return self.session_id or self.sessionID or str(uuid.uuid4())

    def get_role(self) -> str:
        return self.role or "employee"

    def get_user_id(self) -> str:
        return self.user_id or "anonymous"

    def resolve_access_scope(self) -> AccessScope:
        """
        Resolve role-based access scope (self, team, org) and associated ID boundaries.
        Unknown roles strictly default to least-privilege default_role_level ('self').
        """
        from .config import get_config
        cfg = get_config()
        role_name = (self.get_role() or "employee").strip().lower()
        role_meta = cfg.access.roles.get(role_name, {})
        level = role_meta.get("level", cfg.access.default_role_level)

        user_id = self.get_user_id()
        scope_dict = self.scope or {}

        # Extract team IDs
        team_ids: List[str] = []
        if "team_id" in scope_dict and scope_dict["team_id"]:
            team_ids.append(str(scope_dict["team_id"]).strip())
        if "team_ids" in scope_dict and isinstance(scope_dict["team_ids"], list):
            team_ids.extend([str(t).strip() for t in scope_dict["team_ids"] if str(t).strip()])

        # Extract queue IDs
        queue_ids: List[str] = []
        if "queue_id" in scope_dict and scope_dict["queue_id"]:
            queue_ids.append(str(scope_dict["queue_id"]).strip())
        if "queue_ids" in scope_dict and isinstance(scope_dict["queue_ids"], list):
            queue_ids.extend([str(q).strip() for q in scope_dict["queue_ids"] if str(q).strip()])

        # Extract agent IDs
        agent_ids: List[str] = []
        if "agent_id" in scope_dict and scope_dict["agent_id"]:
            agent_ids.append(str(scope_dict["agent_id"]).strip())
        if "agent_ids" in scope_dict and isinstance(scope_dict["agent_ids"], list):
            agent_ids.extend([str(a).strip() for a in scope_dict["agent_ids"] if str(a).strip()])

        return AccessScope(
            level=level,
            role=role_name,
            user_id=user_id if user_id != "anonymous" else None,
            team_ids=list(dict.fromkeys(team_ids)),
            queue_ids=list(dict.fromkeys(queue_ids)),
            agent_ids=list(dict.fromkeys(agent_ids)),
        )

    def validate_scope_requirements(self, access_scope: AccessScope) -> tuple[bool, str]:
        """
        Validate whether request supplies mandatory scope parameters for its access level.
        Missing scope for a scoped role denies access rather than falling back to org level.
        """
        if access_scope.level == "team":
            if not access_scope.team_ids and not access_scope.queue_ids:
                return False, f"Access Denied: Role '{access_scope.role}' requires team_id or queue_id in scope."
        elif access_scope.level == "self":
            if not access_scope.user_id:
                return False, f"Access Denied: Role '{access_scope.role}' requires an authenticated user_id."
        return True, "Valid"


# Backward-compatible alias
ChatRequest = KnowledgeGraphRequest


class KnowledgeGraphResponse(BaseModel):
    """
    Standard response contract for Knowledge Graph Agent.
    """
    status: str = Field(..., description="'ok' | 'no_data' | 'denied' | 'error'")
    answer: str = Field("", description="Natural language markdown answer or HTML response")
    explanation: Optional[str] = Field(None, description="Summary or operational explanation")
    data: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Structured graph facts and metrics")
    tool_calls: Optional[List[Dict[str, Any]]] = Field(None, description="Tool calls executed during reasoning")
    cypher_queries: Optional[List[str]] = Field(default_factory=list, description="Cypher queries executed")
    error: Optional[str] = Field(None, description="Error message if status is 'error' or 'denied'")
    debug: Optional[Dict[str, Any]] = Field(None, description="Debug profiling information if requested")
    latency_seconds: float = Field(0.0, description="End-to-end response time in seconds")


@dataclass
class AuditRecord:
    request_id: str
    timestamp: str
    org_id: str
    user_id: str
    role: str
    question: str
    intent: Optional[str] = None
    cypher_run: Optional[List[str]] = None
    params: Optional[List[Dict[str, Any]]] = None
    row_count: int = 0
    latency_seconds: float = 0.0
    model_name: str = "worktual-gemma"
    status: str = "ok"  # ok | error | denied | no_data
    error_message: Optional[str] = None

    def to_json(self) -> str:
        import json
        return json.dumps(asdict(self), ensure_ascii=False)
