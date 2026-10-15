# from src.memory import SessionManager
from src.prompt import tool_prompt
from src.llm import emitter_llm

llm = emitter_llm()

def generate_progress(content):
    memory = [
        {
            "role" : "system",
            "content" : tool_prompt
        },
        {
            "role" : "user",
            "content" : content
        }
        ]
    
    tools = []
    res = llm.run(memory,tools=tools)
    return res["content"]
    
