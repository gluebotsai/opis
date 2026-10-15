import json
import re
import uuid
from openai import OpenAI

def _parse_hallucinated_tool_calls(content):
    """Fallback parser for when Gemma outputs call:function{args} directly in text."""
    tool_calls = []
    
    if "call:" in content:
        match = re.search(r"call:(\w+)\{(.*?)\}", content, re.DOTALL)
        if match:
            fn_name = match.group(1).strip()
            args_str = match.group(2).strip()
            
            # Simple conversion to JSON
            args_dict = {}
            if ":" in args_str:
                key, val = args_str.split(":", 1)
                args_dict[key.strip()] = val.strip()
            else:
                args_dict["query"] = args_str
                
            tool_calls.append({
                "id": f"call_{uuid.uuid4().hex[:12]}",
                "type": "function",
                "function": {
                    "name": fn_name,
                    "arguments": json.dumps(args_dict)
                }
            })
            content = content[:match.start()].strip()
            
    return content, tool_calls

class OpenAILLM:
    def __init__(self, api_key="123", model_name="worktual-gemma", base_url="http://173.234.75.166:8011/v1"):
        self.client = OpenAI(api_key=api_key, base_url=base_url)
        self.model_name = model_name

    def run(self, messages, tools=None, enable_thinking=False, tool_choice=None):
        kwargs = {
            "model": self.model_name,
            "messages": messages,
            "temperature": 0.2,
            "max_tokens": 4096,
            "stream": False,
            "extra_body": {
                "chat_template_kwargs": {"enable_thinking": enable_thinking}
            }
        }
        if tools:
            kwargs["tools"] = tools
        if tool_choice:
            kwargs["tool_choice"] = tool_choice

        response = self.client.chat.completions.create(**kwargs)
        msg = response.choices[0].message
        
        content = msg.content or ""
        reasoning = getattr(msg, "reasoning", None)
        
        tool_call_dicts = []
        if msg.tool_calls:
            for tc in msg.tool_calls:
                tool_call_dicts.append(tc.model_dump(mode="json") if hasattr(tc, "model_dump") else tc)
                
        # Handle model hallucinating the tool call into the text
        if not tool_call_dicts and "call:" in content:
            content, tool_call_dicts = _parse_hallucinated_tool_calls(content)

        # UNCONDITIONALLY clean up leaked "thought" prefix
        if content.startswith("thought\n"):
            parts = content.split("\n", 1)
            parsed_reasoning = parts[1] if len(parts) > 1 else ""
            if parsed_reasoning and not reasoning:
                reasoning = parsed_reasoning
            # Because there is no clear boundary where the thought ends and the answer begins
            # (it's likely the model just hit max tokens or got stuck thinking),
            # we consider this response to contain NO user-facing content.
            # This allows the caller to retry or fallback.
            content = ""

        return {
            "content": content if content else None,
            "reasoning_content": reasoning,
            "tool_calls": tool_call_dicts if tool_call_dicts else None,
            "finish_reason": response.choices[0].finish_reason,
        }

class LOWLLM(OpenAILLM):
    def run(self, messages, tools=None, tool_choice=None):
        res = super().run(messages, tools, enable_thinking=True, tool_choice=tool_choice)
        return {"content": res["content"], "tool_calls": res["tool_calls"], "reasoning": res["reasoning_content"]}

class emitter_llm(OpenAILLM):
    def run(self, messages, tools=None, tool_choice=None):
        res = super().run(messages, tools, enable_thinking=False, tool_choice=tool_choice)
        return {"content": res["content"], "tool_calls": res["tool_calls"], "reasoning": res["reasoning_content"]}

