"""Four-layer, scope-safe memory interfaces for NLP agents."""

from app.memory.cc_core import CcCoreAgentMemoryBackend
from app.memory.in_process import InProcessShortTermMemory, InProcessWorkingMemory
from app.memory.interfaces import (
    LongTermMemory,
    MemoryItem,
    Message,
    PreferenceData,
    PreferenceScratchpad,
    ShortTermMemory,
    WorkingMemory,
)
from app.memory.scope import MemoryScope, MemoryScopeError
from app.memory.view import (
    AgentMemory,
    LongTermMemoryView,
    MemoryBackendUnavailable,
    MemoryView,
    PreferenceScratchpadView,
    UnavailableLongTermMemory,
    UnavailablePreferenceScratchpad,
)

__all__ = [
    "AgentMemory",
    "CcCoreAgentMemoryBackend",
    "InProcessShortTermMemory",
    "InProcessWorkingMemory",
    "LongTermMemory",
    "LongTermMemoryView",
    "MemoryBackendUnavailable",
    "MemoryItem",
    "MemoryScope",
    "MemoryScopeError",
    "MemoryView",
    "Message",
    "PreferenceData",
    "PreferenceScratchpad",
    "PreferenceScratchpadView",
    "ShortTermMemory",
    "UnavailableLongTermMemory",
    "UnavailablePreferenceScratchpad",
    "WorkingMemory",
]
