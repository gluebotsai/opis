
from typing import List, Dict, TypedDict, Union
from datetime import datetime


class WorkSpace : 
    def __init__(self):
        self.space = []

    def update_space(self,op):
        for i in op:
            if op[i]:
                self.space[i] = op[i]
        # if self.space:
        #     self.space.pop()
        # self.space.append(op)

    def get_workspace(self):
        return self.space

class Reasoning: 
    def __init__(self):
        self.reasoning = {
            "role" : "assistant",
            "reasoning" : ""}
    
    def update_reasoning(self,thought):
        self.reasoning["reasoning"] = thought
        
    def get_reasoning(self):
        return self.reasoning
    
    
class Memory:
    def __init__(self, system_prompt):
        self.system_prompt = system_prompt
        self.memory = [
            {
                "role": "system",
                "content": system_prompt
            }
        ]

    def add_session_messages(self,message:Union[List[dict],dict]):
        if isinstance(message,dict):
            self.memory.append(message)
        elif isinstance(message,List[dict]):
            self.memory.extend(message)
        else:
            raise ValueError

    def get_session_messages(self, num_convo=None):
        if not num_convo:
            return self.memory.copy()
        else:
            return self.memory[:1] + self.memory[-num_convo:]

    def clear_session(self):
        self.memory = [{
            "role": "system",
            "content": self.system_prompt
        }]

    def inject_prompt(self,system_prompt) : 
        self.memory[0]["content"] = system_prompt
    
    def replace_session_messages(self, messages: List[dict]):
        """
        Replace the entire session memory with a new list of messages.

        Used after context compaction/summarization.
        """
        if not isinstance(messages, list):
            raise ValueError("messages must be a list of dictionaries")

        if not all(isinstance(message, dict) for message in messages):
            raise ValueError("Every message must be a dictionary")

        self.memory = messages.copy()
 
class SessionManager:

    def __init__(self):
        self.memories = {}  

    def is_session_present(self, session_id):
        return session_id in self.memories

    def create_memory(self, session_id, system_prompt) -> Memory:
        self.memories[session_id] = Memory(system_prompt=system_prompt)
        return self.memories[session_id]

    def get_memory(self, session_id) -> Memory:
        return self.memories[session_id]