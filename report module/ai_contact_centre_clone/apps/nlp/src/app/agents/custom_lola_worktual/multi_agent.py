import ast
import json

from app.agents.custom_lola_worktual.tools import agent_route_tool
from app.agents.custom_lola_worktual.llm import get_worktual_llm
from app.logging import get_logger

logger = get_logger("nlp.custom_lola_worktual.multi_agent")
llm = get_worktual_llm()

RECENT_USER_TURNS = 10


def _is_data_payload(text: str) -> bool:
    stripped = text.strip()
    if not stripped or stripped[0] not in "{[":
        return False
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError:
        try:
            parsed = ast.literal_eval(stripped)
        except (ValueError, SyntaxError, MemoryError):
            return False
    return isinstance(parsed, (dict, list))


def _spoken_text(content) -> str:
    if not isinstance(content, str):
        return ""
    text = content.strip()
    if not text or text in {"None", "null"} or _is_data_payload(text):
        return ""
    return text


def customer_visible_text(result) -> str:
    """Customer reply only. Tool-call payloads stay inside the agent loop."""
    if not isinstance(result, dict):
        return ""
    raw = result.get("response")
    if isinstance(raw, dict):
        raw = raw.get("content")
    if not isinstance(raw, str):
        return ""
    text = _spoken_text(raw.replace("<<", "<").replace(">>", ">"))
    return text

def summary_of_conversation(messages):
    messages_to_summarize = ""
    for message in messages:
        role = message.get("role")

        # Skip tool result messages
        if role == "tool":
            continue

        # Skip assistant messages that are pure tool-call triggers (no text content)
        if role == "assistant" and message.get("tool_calls"):
            continue

        # Now safe to process user and assistant text messages
        content = message.get("content")
        if not content or not isinstance(content, str):
            continue  # Skip None or non-string content

        if role == "assistant":
            messages_to_summarize += "Assistant: " + content + "\n"
        elif role == "user":
            messages_to_summarize += "User: " + content + "\n"

    prompt = f"""
        Role: You are an expert summarization assistant specialized in distilling live, multi-turn conversations into actionable data.
        
        Task: Generate a concise summary of the provided current conversation.
        
        Guidelines:
        - Continuity: You are summarizing an ongoing interaction. Do not restart, rephrase the opening, or summarize from the beginning. Simply continue the current flow of the conversation.
        - Constraints: 
            - never miss any details while doing summary.
            - The summary section must be under 50 words.
        
        Required Content:
        1. User Identity: Name, Company, and Industry (if available; if not, state "Not provided").
        2. user mobile number, mail ,and extra details related to the user and the company 
        3. Interests: Specific product interests identified in this conversation.
        4. Active Intent: Clearly state the current query or pending action requiring an immediate response.
        
        Output Format:
        User Details: [User_Name:<user name> | Company_Name:<user company name>| Industry:<user industry type and specification>]
        Email id : user mail id | user phonenumber: user mobile number| About_industry: extra information about the industry.
        Interests: [Products/Services]
        Active Intent: [The current actionable query]
        Summary: [Concise synthesis of the conversation flow < 50 words]
        
        """

    # prompt = prompt.format(current_date=datetime.now().strftime("%y-%m-%d %H:%M:%S"))

    if not messages_to_summarize.strip():
        # Nothing meaningful to summarize — return a placeholder
        return {
            "role": "assistant",
            "content": "No prior conversation context available."
        }

    previous_convo = f"Current Conversation: {messages_to_summarize}"
    response = llm.run(
        messages=[
            {"role": "system", "content": prompt},
            {"role": "user", "content": previous_convo}
        ],
        tools=[]
    )

    # Guard: llm.run() may return None or a dict without 'content'
    if not response or not isinstance(response, dict) or not response.get("content"):
        return {
            "role": "assistant",
            "content": "Summary unavailable due to an internal error."
        }

    return {
        "role": "assistant",
        "content": response["content"]
    }


def trim_session_history(messages):
    """Summarize talk older than the last 10 customer turns. Keep that window intact."""
    user_indexes = [index for index, message in enumerate(messages) if message.get("role") == "user"]
    if len(user_indexes) <= RECENT_USER_TURNS:
        return None
    cut = user_indexes[-RECENT_USER_TURNS]
    summary = summary_of_conversation(messages[:cut])
    return [summary, *messages[cut:]]
''' SINGLE AGENT '''

class Agent():
    
    def __init__(self,name,system,tools,llm,handoff_instruction = None):
        self.name = name
        self.system = [
            {
                "role":"system",
                "content":system
            }
        ]
        

        self.tools = [agent_route_tool] + tools
        self.tools_schema = [tool.tool_schema for tool in self.tools]
        self.tools_mapping = {tool.tool_schema["function"]["name"]:tool for tool in self.tools}
        self.llm = llm
        self.handoff_instruction = handoff_instruction

    def hide_verification_tools(self) -> None:
        hidden = {"SEND_OTP", "VERIFY_OTP"}
        if not any(name in self.tools_mapping for name in hidden):
            return
        self.tools = [
            tool for tool in self.tools
            if tool.tool_schema["function"]["name"] not in hidden
        ]
        self.tools_schema = [tool.tool_schema for tool in self.tools]
        self.tools_mapping = {tool.tool_schema["function"]["name"]: tool for tool in self.tools}


    def update_system(self,new_system):
        self.system = new_system
        return self.system


    def run(self,query,memory,coid,chat_history_id,chat_duration_history_id,session_id,purchase_status,payment_id,cookie_id,ip_address,domainId,formatted_time,longterm_cache,include_user=True,allow_route=True):

        if include_user:
            memory.add_session_messages(
                {
                    "role":"user",
                    "content":query
                }
            )

        from app.agents.custom_lola_worktual.session_card import get_chat_state

        if get_chat_state(session_id).authenticated:
            self.hide_verification_tools()

        trimmed = trim_session_history(memory.get_session_messages())
        if trimmed is not None:
            memory.memory = trimmed
        messages = self.system + memory.get_session_messages(50)
        try:
            llm_response = self.llm.run(messages=messages,tools=self._tool_schemas(allow_route))
        except Exception as e:
            logger.error(f"ERROR IN LLM : {e}")
            llm_response = self.llm.run(messages=messages,tools=self._tool_schemas(allow_route))
        

        print("Memory : ",messages[1:])

        if not isinstance(llm_response, dict):
            return self._plain_result("")

        if llm_response.get("tool_calls"):

            if llm_response["tool_calls"][0]["function"]["name"] == "route_to_agent":
                if not allow_route:
                    return self._plain_result(_spoken_text(llm_response.get("content")))
                # append_message(session_id=session_id,role="assistant",content=None,tool=llm_response["tool_calls"],reasoning=llm_response["reasoning"])
                # append_message(session_id=session_id,role="tool",tool_name=llm_response["tool_calls"][0]["function"]["name"],tool_response="routed successfully")

                return {
                    "response_type":"routing_response",
                    "from":self.name,
                    "response":llm_response,
                    "agent_ext":0
                }


            print("TOOL CALL : ",llm_response,"\n\n")
            count = 0
            while count<5:
                
                # append_message(session_id=session_id,role="assistant",content=None,tool=llm_response["tool_calls"],reasoning=llm_response["reasoning"])

                print(f"No of Tool call iteration:{count}")
                count +=1
                forcount =0 
                for tool_call in llm_response["tool_calls"]:
                    if forcount > 5:
                        break
                    print(f"continius tool calling: {forcount}")
                    forcount += 1
                    memory.add_session_messages(
                        {
                            "role":"assistant",
                            "tool_calls":[tool_call]
                        }
                    )
                    tool = self.tools_mapping.get(tool_call["function"]["name"])
                    if tool is None:
                        tool_response = {"status": "failure", "message": "That action is not available."}
                    else:
                        tool_response = tool.run(**json.loads(tool_call["function"]["arguments"]),coid=coid,chat_history_id=chat_history_id,chat_duration_history_id=chat_duration_history_id,session_id=session_id,purchase_status=purchase_status,payment_id=payment_id,cookie_id=cookie_id,ip_address=ip_address,domainId=domainId,formatted_time=formatted_time,longterm_cache=longterm_cache)
                    print("Tool Response : ",tool_response,"\n\n")

                    memory.add_session_messages(
                        {
                            "role":"tool",
                            "name":tool_call["function"]["name"],
                            "tool_call_id":tool_call["id"],
                            "content": json.dumps(tool_response, default=str)                        }
                    )
                    if get_chat_state(session_id).authenticated:
                        self.hide_verification_tools()
                    # append_message(session_id=session_id,role="tool",tool_name=tool_call["function"]["name"],tool_response=tool_response)
                    
                    if tool_call["function"]["name"] == "LIVE_AGENT" or (
                        isinstance(tool_response, dict) and tool_response.get("handoff_recommended")
                    ):
                        handoff_message = (
                            tool_response.get("message")
                            if isinstance(tool_response, dict)
                            else "Please hold while I connect you with a live agent."
                        )
                        memory.add_session_messages(
                            {
                                "role": "assistant",
                                "content": handoff_message,
                            }
                        )
                        return {
                            "response_type": "general_response",
                            "from": self.name,
                            "response": handoff_message,
                            "agent_ext": 0,
                            "handoff_recommended": True,
                        }

                    if tool_call["function"]["name"] == "ENTITY_TOOL":
                        try:
                            if "data" in tool_response and tool_response["data"]["response"]:
                                memory.add_session_messages(
                                    {
                                        "role":"assistant",
                                        "content": tool_response["data"]["response"]
                                    }
                                )

                                return {
                                    "response_type":"general_response",
                                    "from":self.name,
                                    "response": tool_response["data"]["response"],
                                    "agent_ext": 0,
                                    "first_name": tool_response["data"]["first_name"],
                                    "last_name" : tool_response["data"]["last_name"]
                                }
                        except Exception as e:
                            logger.error(f"ERROR IN ENTITY TOOL: {e}")
                
                # if len(memory.get_session_messages()) >25:
                #     messages = memory.get_session_messages()
                #     out_put_message=summary_of_conversation(messages)
                #     memory.clear_session()
                #     memory.add_session_messages(out_put_message)
                #     memory.add_session_messages(
                #         {
                #             "role":"user",
                #             "content":query
                #         })
                messages = self.system + memory.get_session_messages(50)
                print("Memory : ",messages[1:])

                try:
                    llm_response = self.llm.run(messages=messages,tools=self._tool_schemas(allow_route))
                except Exception as e:
                    logger.error(f"ERROR IN AFTER TOOL CALL LLM : {e}")
                    llm_response = self.llm.run(messages=messages,tools=self._tool_schemas(allow_route))

                if not isinstance(llm_response, dict):
                    return self._plain_result("")

                spoken = _spoken_text(llm_response.get("content"))
                if spoken and not llm_response.get("tool_calls"):
                    memory.add_session_messages(
                        {
                            "role":"assistant",
                            "content": spoken
                        }
                    )
                    print("Final Response : ",llm_response,"\n\n")
                    return self._plain_result(spoken)

                calls = llm_response.get("tool_calls") or []
                if calls and calls[0].get("function", {}).get("name") == "route_to_agent":
                    if not allow_route:
                        return self._plain_result(spoken)
                    return {
                        "response_type": "routing_response",
                        "from": self.name,
                        "response": llm_response,
                        "agent_ext": 0,
                    }

                print("TOOL CALL : ",llm_response,"\n\n")

            return self._plain_result("")

            
        else:
            spoken = _spoken_text(llm_response.get("content"))
            memory.add_session_messages(
                {
                    "role":"assistant",
                    "content": spoken
                }
            )        
            print("Final Response : ",llm_response,"\n\n")
            return self._plain_result(spoken)

    def _tool_schemas(self, allow_route: bool):
        if allow_route:
            return self.tools_schema
        return [
            schema
            for schema in self.tools_schema
            if schema.get("function", {}).get("name") != "route_to_agent"
        ]

    def _plain_result(self, text: str):
        return {
            "response_type": "general_response",
            "from": self.name,
            "response": text if isinstance(text, str) else "",
            "agent_ext": 0,
        }
            

''' MULTI AGENT ROUTER '''

class AgentRouter():

    def __init__(self, agents:Agent, memory):
        self.agents = {agent.name: agent for agent in agents}
        self.current_agent = agents[0]
        self.memory = memory
        self.agents_handoff = {agent.name:agent.handoff_instruction for agent in list(self.agents.values())}
        self.routing_instruction = f"""\n\nWhen you need to route to other agent. These are the available agents below. Use the 'route_to_agent' tool.
        {self.agents_handoff}

        Note:
        If it is routing tool only give that tool only. don't call other tools together.
        """

        for agent_name in self.agents:
            self.agents[agent_name].update_system(
                [
                    {
                        "role":"system",
                        "content":self.agents[agent_name].system[0]["content"] + self.routing_instruction
                    }
                ]
            )

    def execute(self,user_input,coid,chat_history_id,chat_duration_history_id,session_id,purchase_status,payment_id,cookie_id,ip_address,domainId,formatted_time,longterm_cache):
        run_args = (
            user_input,
            self.memory,
            coid,
            chat_history_id,
            chat_duration_history_id,
            session_id,
            purchase_status,
            payment_id,
            cookie_id,
            ip_address,
            domainId,
            formatted_time,
            longterm_cache,
        )
        response = self.current_agent.run(*run_args)
        for _ in range(3):
            target = self._route_target(response)
            if not target:
                break
            print("\nRouting....")
            if target not in self.agents or target == self.current_agent.name:
                response = self.current_agent.run(*run_args, include_user=False, allow_route=False)
                break
            self.current_agent = self.agents[target]
            response = self.current_agent.run(*run_args)
        return self._customer_result(response)

    def _route_target(self, response) -> str:
        if not isinstance(response, dict) or response.get("response_type") != "routing_response":
            return ""
        payload = response.get("response")
        if not isinstance(payload, dict):
            return ""
        calls = payload.get("tool_calls") or []
        if not calls:
            return ""
        try:
            function = calls[0].get("function") or {}
            raw_args = function.get("arguments")
            args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
        except (TypeError, json.JSONDecodeError, AttributeError):
            return ""
        if not isinstance(args, dict):
            return ""
        return str(args.get("agent_name") or "")

    def _customer_result(self, response):
        if not isinstance(response, dict):
            response = {
                "response_type": "general_response",
                "from": self.current_agent.name,
                "response": "",
                "agent_ext": 0,
            }
        cleaned = dict(response)
        cleaned["response_type"] = "general_response"
        cleaned["response"] = customer_visible_text(response)
        return cleaned
