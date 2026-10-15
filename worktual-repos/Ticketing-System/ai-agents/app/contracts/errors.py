"""Typed protocol errors for the native AI runtime."""

from __future__ import annotations

from typing import Any

# Stable error codes (also set on exception classes as `.code`).
LLM_UNAVAILABLE = "LLM_UNAVAILABLE"
LLM_INVALID_OUTPUT = "LLM_INVALID_OUTPUT"
LLM_EMPTY_RESPONSE = "LLM_EMPTY_RESPONSE"
TOOL_NOT_ALLOWED = "TOOL_NOT_ALLOWED"
TOOL_ARGUMENT_ERROR = "TOOL_ARGUMENT_ERROR"
TOOL_LOOP_EXHAUSTED = "TOOL_LOOP_EXHAUSTED"
MEMORY_CONFLICT = "MEMORY_CONFLICT"
HANDOFF_CYCLE = "HANDOFF_CYCLE"

ERROR_CODES = frozenset(
    {
        LLM_UNAVAILABLE,
        LLM_INVALID_OUTPUT,
        LLM_EMPTY_RESPONSE,
        TOOL_NOT_ALLOWED,
        TOOL_ARGUMENT_ERROR,
        TOOL_LOOP_EXHAUSTED,
        MEMORY_CONFLICT,
        HANDOFF_CYCLE,
    }
)


class NativeAIError(Exception):
    """Base structured error for the native orchestrator."""

    code: str = "NATIVE_ERROR"
    http_status: int = 500

    def __init__(self, message: str, *, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}

    def to_dict(self) -> dict[str, Any]:
        return {
            "error": self.code,
            "message": self.message,
            "details": self.details,
            "retryable": self.http_status >= 500,
        }


class LLMUnavailable(NativeAIError):
    code = LLM_UNAVAILABLE
    http_status = 503


class LLMInvalidOutput(NativeAIError):
    code = LLM_INVALID_OUTPUT
    http_status = 502


class LLMEmptyResponse(NativeAIError):
    code = LLM_EMPTY_RESPONSE
    http_status = 502


class ToolNotAllowed(NativeAIError):
    code = TOOL_NOT_ALLOWED
    http_status = 403


class ToolArgumentError(NativeAIError):
    code = TOOL_ARGUMENT_ERROR
    http_status = 400


class ToolLoopExhausted(NativeAIError):
    code = TOOL_LOOP_EXHAUSTED
    http_status = 504


class MemoryConflict(NativeAIError):
    code = MEMORY_CONFLICT
    http_status = 409


class HandoffCycleError(NativeAIError):
    code = HANDOFF_CYCLE
    http_status = 400
