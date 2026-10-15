from typing import List, Dict, TypedDict, Union
from datetime import datetime



class Memory:

    def __init__(self):
        self.memory = []

    def add_session_messages(self,message:Union[List[dict],dict]):
        if isinstance(message,dict):
            self.memory.append(message)
        elif isinstance(message,List[dict]):
            self.memory.extend(message)
        else:
            raise ValueError


    def get_session_messages(self, num_convo=None):
        if not num_convo:
            return self.memory
        else:
            if len(self.memory)> num_convo+1:
                return self.memory[:1] + self.memory[-num_convo:]
            else:
                return self.memory

    def clear_session(self):
        self.memory = []



class SessionManager:

    def __init__(self):
        self.routers = {}  

    def is_session_present(self, session_id):
        return session_id in self.routers

    def create_router(self, session_id,agent_router) -> Memory:
        self.routers[session_id] = agent_router
        return self.routers[session_id]

    def get_router(self, session_id):
        return self.routers[session_id]


