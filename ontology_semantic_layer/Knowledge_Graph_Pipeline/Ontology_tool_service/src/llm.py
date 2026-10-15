
from openai import OpenAI
import re
import json
import uuid
from openai import OpenAI
from openai.types.chat import ChatCompletionMessageToolCall
from openai.types.chat.chat_completion_message_tool_call import Function


class LOWLLM:

    def __init__(self, api_key="123", model_name="worktual-gemma", base_url="http://173.234.75.166:8011/v1"):
        self.client = OpenAI(
            api_key=api_key,
            base_url=base_url
        )
        self.model_name = model_name

    def run(self, messages, tools = []):

        resp = self.client.chat.completions.create(
            model=self.model_name,
            messages=messages,
            max_tokens=2000,
            temperature=0.9,
            presence_penalty=0.5,
            stream=False,
            tools=tools,
            # stop=["<|call|>","<|return|>"],
            extra_body={
                "top_k":64,
                "top_p":0.95,
                "repetition_penalty":1.1,
                "chat_template_kwargs": {"enable_thinking":True},
            },

        ).model_dump()
        # print(messages)
        # print("="*10)
        abc  =  {
            "content": resp["choices"][0]["message"].get("content"),
            "tool_calls": resp["choices"][0]["message"].get("tool_calls"),  
            "reasoning": resp["choices"][0]["message"].get("reasoning")
        }
    
        return abc
    



class emitter_llm:

    def __init__(self, api_key="123", model_name="worktual-gemma", base_url="http://173.234.75.166:8011/v1"):
        self.client = OpenAI(
            api_key=api_key,
            base_url=base_url
        )
        self.model_name = model_name

    def run(self, messages, tools = []):

        resp = self.client.chat.completions.create(
            model=self.model_name,
            messages=messages,
            max_tokens=500,
            temperature=0.9,
            presence_penalty=0.5,
            stream=False,
            tools=tools,
            # stop=["<|call|>","<|return|>"],
            extra_body={
                "top_k":64,
                "top_p":0.95,
                "repetition_penalty":1.1,
                "chat_template_kwargs": {"enable_thinking":False},
            },

        ).model_dump()
        # print(messages)
        # print("="*10)
        abc  =  {
            "content": resp["choices"][0]["message"].get("content"),
            "tool_calls": resp["choices"][0]["message"].get("tool_calls"),  
            "reasoning": resp["choices"][0]["message"].get("reasoning")
        }
    
        return abc
    




THINK_RE = re.compile(
    r"<think>(.*?)</think>",
    re.DOTALL,
)

THINK_OPEN_RE = re.compile(
    r"<think>(.*)",
    re.DOTALL,
)

TOOL_RE = re.compile(
    r"<minimax:tool_call>(.*?)</minimax:tool_call>",
    re.DOTALL,
)

INVOKE_RE = re.compile(
    r'<invoke\s+name="([^"]+)">(.*?)</invoke>',
    re.DOTALL,
)

PARAM_RE = re.compile(
    r'<parameter\s+name="([^"]+)">(.*?)</parameter>',
    re.DOTALL,
)

def parse_tool_calls(text: str):

    calls = []

    for block in TOOL_RE.findall(text):

        for name, body in INVOKE_RE.findall(block):

            args = {}

            for pname, pval in PARAM_RE.findall(body):

                pval = pval.strip()

                try:
                    args[pname] = json.loads(pval)
                except Exception:
                    args[pname] = pval

            calls.append(
                ChatCompletionMessageToolCall(
                    id=f"call_{uuid.uuid4().hex[:24]}",
                    type="function",
                    function=Function(
                        name=name,
                        arguments=json.dumps(args, ensure_ascii=False),
                    ),
                )
            )

    return calls


class OpenAILLM:

    def __init__(
        self,
        api_key="EMPTY",
        model_name="worktual-minimax",
    ):

        self.client = OpenAI(
            api_key=api_key,
            base_url="http://81.17.61.148:8064/v1",
        )

        self.model_name = model_name

    def run(self, messages, tools=None, enable_thinking=False):
        create_kwargs = {
            "model": self.model_name,
            "messages": messages,
            "temperature": 0.2,
            "max_tokens": 2000,
            "presence_penalty": 0.5,
            "stream": False,
            "extra_body": {
                "top_p": 0.94,
                "top_k": 64,
                "repetition_penalty": 1.0,
                "chat_template_kwargs": {
                    "enable_thinking": enable_thinking,
                    "preserve_thinking": False,
                },
            },
        }
        if tools:
            create_kwargs["tools"] = tools

        response = self.client.chat.completions.create(**create_kwargs)

        message = response.choices[0].message

        raw = message.content or ""

        # print("=" * 80)
        # print("Finish Reason :", response.choices[0].finish_reason)
        # print("Raw Response")
        # print(raw)
        # print("=" * 80)

        tool_calls = message.tool_calls

        if not tool_calls:

            tool_calls = parse_tool_calls(raw)

        reasoning = None

        m = THINK_RE.search(raw)

        if m:

            reasoning = m.group(1).strip()

            raw = THINK_RE.sub("", raw)

        else:

            m = THINK_OPEN_RE.search(raw)

            if m:

                reasoning = m.group(1).strip()

                raw = ""

        raw = TOOL_RE.sub("", raw)

        content = raw.strip()

        if not content:
            content = None

        tool_call_dicts = None

        if tool_calls:

            tool_call_dicts = []

            for tc in tool_calls:

                if hasattr(tc, "model_dump"):
                    tool_call_dicts.append(tc.model_dump(mode="json"))
                else:
                    tool_call_dicts.append(tc)

        result = {
            "content": content,
            "reasoning_content": reasoning,
            "tool_calls": tool_call_dicts,
            "finish_reason": response.choices[0].finish_reason,
        }

        # print("=" * 80)
        # print("Parsed Response")
        # print(json.dumps(result, indent=2, ensure_ascii=False))
        # print("=" * 80)

        return result

