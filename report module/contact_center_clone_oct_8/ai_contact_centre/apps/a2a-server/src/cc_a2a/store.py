"""Durable A2A task store adapter backed by cc-core internal APIs."""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any

import httpx

from cc_a2a.config import A2ASettings

logger = logging.getLogger("a2a.store")

TASK_STATES = frozenset(
    {
        "SUBMITTED",
        "WORKING",
        "INPUT_REQUIRED",
        "AUTH_REQUIRED",
        "COMPLETED",
        "FAILED",
        "CANCELED",
        "REJECTED",
    }
)


class TaskStoreError(Exception):
    def __init__(self, message: str, *, status_code: int = 500, payload: dict | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload or {}


def canonical_request_hash(envelope: dict[str, Any]) -> str:
    """Stable hash of the command payload excluding volatile trace fields."""
    material = {
        "commandId": envelope.get("commandId"),
        "skillId": envelope.get("skillId"),
        "contractVersion": envelope.get("contractVersion"),
        "organizationId": envelope.get("organizationId"),
        "arguments": envelope.get("arguments") or {},
        "deadline": envelope.get("deadline"),
        "approval": envelope.get("approval"),
    }
    encoded = json.dumps(material, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


class CcCoreTaskStore:
    def __init__(self, settings: A2ASettings) -> None:
        self.settings = settings
        self.base_url = settings.cc_core_url.rstrip("/")

    def _headers(self, organization_id: str) -> dict[str, str]:
        headers = {
            "accept": "application/json",
            "content-type": "application/json",
            "x-tenant-id": organization_id,
        }
        if self.settings.internal_service_key:
            headers["x-internal-service-key"] = self.settings.internal_service_key
        return headers

    async def _request(
        self,
        method: str,
        path: str,
        organization_id: str,
        *,
        json_body: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        async with httpx.AsyncClient(base_url=self.base_url, timeout=30.0) as client:
            response = await client.request(
                method,
                path,
                headers=self._headers(organization_id),
                json=json_body,
                params=params,
            )
            if response.status_code >= 400:
                payload: dict[str, Any]
                try:
                    decoded = response.json()
                    payload = decoded if isinstance(decoded, dict) else {"error": decoded}
                except ValueError:
                    payload = {"error": response.text}
                raise TaskStoreError(
                    str(payload.get("message") or payload.get("error") or "task store error"),
                    status_code=response.status_code,
                    payload=payload,
                )
            if response.status_code == 204:
                return None
            return response.json()

    async def create_or_get(
        self,
        *,
        organization_id: str,
        caller_subject: str,
        command_id: str,
        skill_id: str,
        request_hash: str,
        request_envelope: dict[str, Any],
        context_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._request(
            "POST",
            "/internal/v1/a2a/tasks",
            organization_id,
            json_body={
                "organizationId": organization_id,
                "callerSubject": caller_subject,
                "commandId": command_id,
                "skillId": skill_id,
                "requestHash": request_hash,
                "requestEnvelope": request_envelope,
                "contextId": context_id,
            },
        )

    async def get_task(self, organization_id: str, task_id: str) -> dict[str, Any]:
        return await self._request(
            "GET",
            f"/internal/v1/a2a/tasks/{task_id}",
            organization_id,
        )

    async def list_tasks(
        self,
        organization_id: str,
        *,
        caller_subject: str | None = None,
        limit: int = 50,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"limit": limit}
        if caller_subject:
            params["callerSubject"] = caller_subject
        return await self._request(
            "GET",
            "/internal/v1/a2a/tasks",
            organization_id,
            params=params,
        )

    async def update_task(
        self,
        organization_id: str,
        task_id: str,
        *,
        state: str | None = None,
        result_artifact: dict[str, Any] | None = None,
        error: dict[str, Any] | None = None,
        event_type: str | None = None,
        event_payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if state and state not in TASK_STATES:
            raise ValueError(f"Invalid task state: {state}")
        return await self._request(
            "PATCH",
            f"/internal/v1/a2a/tasks/{task_id}",
            organization_id,
            json_body={
                "state": state,
                "resultArtifact": result_artifact,
                "error": error,
                "eventType": event_type,
                "eventPayload": event_payload or {},
            },
        )

    async def cancel_task(
        self,
        organization_id: str,
        task_id: str,
        *,
        reason: str | None = None,
    ) -> dict[str, Any]:
        return await self._request(
            "POST",
            f"/internal/v1/a2a/tasks/{task_id}/cancel",
            organization_id,
            json_body={"reason": reason},
        )


class InMemoryTaskStore:
    """Fallback store for unit tests and local runs without cc-core."""

    def __init__(self) -> None:
        self._tasks: dict[str, dict[str, Any]] = {}
        self._by_command: dict[tuple[str, str, str], str] = {}
        self._seq = 0

    async def create_or_get(
        self,
        *,
        organization_id: str,
        caller_subject: str,
        command_id: str,
        skill_id: str,
        request_hash: str,
        request_envelope: dict[str, Any],
        context_id: str | None = None,
    ) -> dict[str, Any]:
        key = (caller_subject, organization_id, command_id)
        existing_id = self._by_command.get(key)
        if existing_id:
            existing = self._tasks[existing_id]
            if existing["requestHash"] != request_hash:
                raise TaskStoreError(
                    "commandId reused with a different payload",
                    status_code=409,
                    payload={"existingTaskId": existing_id},
                )
            return {**existing, "idempotentReplay": True}
        self._seq += 1
        task_id = f"a2a_task_{self._seq}"
        task = {
            "id": task_id,
            "organizationId": organization_id,
            "callerSubject": caller_subject,
            "commandId": command_id,
            "skillId": skill_id,
            "requestHash": request_hash,
            "requestEnvelope": request_envelope,
            "contextId": context_id,
            "state": "SUBMITTED",
            "resultArtifact": None,
            "error": None,
            "events": [],
            "artifacts": [],
            "idempotentReplay": False,
        }
        self._tasks[task_id] = task
        self._by_command[key] = task_id
        return dict(task)

    async def get_task(self, organization_id: str, task_id: str) -> dict[str, Any]:
        task = self._tasks.get(task_id)
        if not task or task["organizationId"] != organization_id:
            raise TaskStoreError("Task not found", status_code=404)
        return dict(task)

    async def list_tasks(
        self,
        organization_id: str,
        *,
        caller_subject: str | None = None,
        limit: int = 50,
    ) -> dict[str, Any]:
        items = [
            dict(task)
            for task in self._tasks.values()
            if task["organizationId"] == organization_id
            and (caller_subject is None or task["callerSubject"] == caller_subject)
        ]
        return {"tasks": items[:limit]}

    async def update_task(
        self,
        organization_id: str,
        task_id: str,
        *,
        state: str | None = None,
        result_artifact: dict[str, Any] | None = None,
        error: dict[str, Any] | None = None,
        event_type: str | None = None,
        event_payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        task = await self.get_task(organization_id, task_id)
        if state:
            task["state"] = state
        if result_artifact is not None:
            task["resultArtifact"] = result_artifact
            task["artifacts"] = [{"name": "result", "parts": [{"kind": "data", "data": result_artifact}]}]
        if error is not None:
            task["error"] = error
        if event_type:
            task.setdefault("events", []).append(
                {"type": event_type, "payload": event_payload or {}}
            )
        self._tasks[task_id] = task
        return dict(task)

    async def cancel_task(
        self,
        organization_id: str,
        task_id: str,
        *,
        reason: str | None = None,
    ) -> dict[str, Any]:
        task = await self.get_task(organization_id, task_id)
        if task["state"] in {"COMPLETED", "FAILED", "CANCELED", "REJECTED"}:
            return task
        return await self.update_task(
            organization_id,
            task_id,
            state="CANCELED",
            event_type="canceled",
            event_payload={"reason": reason},
        )
