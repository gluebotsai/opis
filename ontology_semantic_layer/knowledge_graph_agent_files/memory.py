# ==============================================================================
# memory.py — Session & Memory Management for Knowledge Graph Agent
# ==============================================================================

from typing import List, Dict, Union, Optional
from datetime import datetime


class Memory:
    def __init__(self, system_prompt: str):
        self.system_prompt = system_prompt
        self.memory = [
            {
                "role": "system",
                "content": system_prompt
            }
        ]

    def add_session_messages(self, message: Union[List[dict], dict]):
        if isinstance(message, dict):
            self.memory.append(message)
        elif isinstance(message, list):
            self.memory.extend(message)
        else:
            raise ValueError("Message must be a dict or list of dicts")

    def get_session_messages(self, num_convo: Optional[int] = None):
        if not num_convo:
            return self.memory.copy()
        else:
            return self.memory[:1] + self.memory[-num_convo:]

    def clear_session(self):
        self.memory = [{
            "role": "system",
            "content": self.system_prompt
        }]

    def inject_prompt(self, system_prompt: str):
        self.memory[0]["content"] = system_prompt

    def replace_session_messages(self, messages: List[dict]):
        if not isinstance(messages, list) or not all(isinstance(m, dict) for m in messages):
            raise ValueError("messages must be a list of dictionaries")
        self.memory = messages.copy()


class SessionManager:
    def __init__(self):
        self.memories: Dict[str, Memory] = {}

    def is_session_present(self, session_id: str) -> bool:
        return session_id in self.memories

    def create_memory(self, session_id: str, system_prompt: str) -> Memory:
        self.memories[session_id] = Memory(system_prompt=system_prompt)
        return self.memories[session_id]

    def get_memory(self, session_id: str) -> Memory:
        return self.memories[session_id]
