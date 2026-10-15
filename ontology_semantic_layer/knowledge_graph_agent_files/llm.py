
import os
import re
import json
import uuid
from dotenv import load_dotenv
load_dotenv()
from openai import OpenAI
from openai.types.chat import ChatCompletionMessageToolCall
from openai.types.chat.chat_completion_message_tool_call import Function


class LOWLLM:

    def __init__(self, api_key=None, model_name=None, base_url=None):
        api_key = api_key or os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY", "dummy-key")
        base_url = base_url or os.getenv("LLM_BASE_URL")
        model_name = model_name or os.getenv("LLM_MODEL_NAME", "worktual-gemma")
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

    def __init__(self, api_key=None, model_name=None, base_url=None):
        api_key = api_key or os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY", "dummy-key")
        base_url = base_url or os.getenv("LLM_BASE_URL")
        model_name = model_name or os.getenv("LLM_MODEL_NAME", "worktual-gemma")
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

    # 1. Minimax tool call format
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

    # 2. Gemma tool call format: call:function_name{args} or <|tool_call>call:function_name{args}
    gemma_pattern = r"(?:<\|tool_call>)?call:([a-zA-Z0-9_]+)\s*\{([^}]*)(?:\}|$)"
    for match in re.finditer(gemma_pattern, text, re.DOTALL):
        name = match.group(1)
        body = match.group(2).strip()
        args = {}
        try:
            clean_body = body
            if not clean_body.endswith("}"):
                clean_body = clean_body.rstrip('"').rstrip("'") + '"}' if ":" in clean_body else clean_body + "}"
            args = json.loads("{" + clean_body if not clean_body.startswith("{") else clean_body)
        except Exception:
            if ":" in body:
                k, v = body.split(":", 1)
                args[k.strip()] = v.strip().strip("\"\"\"").strip("\x27\x27\x27")
            else:
                args["query"] = body
        # Sanitize argument strings from special tokens
        for k in list(args.keys()):
            if isinstance(args[k], str):
                v = re.sub(r"<\|[^|>]*\|>", "", args[k]).strip()
                if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                    v = v[1:-1].strip()
                args[k] = v
        calls.append(
            ChatCompletionMessageToolCall(
                id=f"call_{uuid.uuid4().hex[:24]}",
                type="function",
                function=Function(
                    name=name,
                    arguments=json.dumps(args, ensure_ascii=False)
                )
            )
        )

    return calls


class OpenAILLM:

    def __init__(
        self,
        api_key=None,
        model_name=None,
        base_url=None,
    ):
        api_key = api_key or os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY", "dummy-key")
        base_url = base_url or os.getenv("LLM_BASE_URL")
        model_name = model_name or os.getenv("LLM_MODEL_NAME", "worktual-gemma")

        self.client = OpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=30.0
        )

        self.model_name = model_name

    def run(self, messages, tools=None, enable_thinking=True):
        create_kwargs = {
            "model": self.model_name,
            "messages": messages,
            "temperature": 0.2,
            "max_tokens": 4096,
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

        tool_calls = message.tool_calls
        if not tool_calls:
            tool_calls = parse_tool_calls(raw)

        reasoning = None

        # 1. Standard <think>...</think>
        m = THINK_RE.search(raw)
        if m:
            reasoning = m.group(1).strip()
            raw = THINK_RE.sub("", raw)
        else:
            m = THINK_OPEN_RE.search(raw)
            if m:
                reasoning = m.group(1).strip()
                raw = ""
            elif raw.startswith("thought\n") or "\nthought\n" in raw:
                # 2. Gemma thought\n style thinking block
                parts = re.split(r"(?:^|\n)thought\n", raw, maxsplit=1)
                after_thought = parts[-1]
                call_match = re.search(r"(?:<\|tool_call>)?call:([a-zA-Z0-9_]+)\s*\{|<minimax:tool_call>", after_thought)
                if call_match:
                    reasoning = after_thought[:call_match.start()].strip()
                    raw = after_thought[call_match.start():].strip()
                else:
                    html_match = re.search(r"<(?:!DOCTYPE|html|p|div|ul|ol|table|h[1-6])[^>]*>", after_thought, re.IGNORECASE)
                    if html_match and html_match.start() > 0:
                        reasoning = after_thought[:html_match.start()].strip()
                        raw = after_thought[html_match.start():].strip()
                    else:
                        paragraphs = re.split(r"\n\s*\n", after_thought, maxsplit=1)
                        if len(paragraphs) == 2 and any(kw in paragraphs[0].lower() for kw in ["plan", "let me", "i should", "i will", "the user", "wait,"]):
                            reasoning = paragraphs[0].strip()
                            raw = paragraphs[1].strip()
                        else:
                            raw = after_thought.strip()

        # 3. Fallback: extract monologue preceding tool calls or HTML tags
        if not reasoning:
            tc_match = re.search(r"(?:<\|tool_call>)?call:[a-zA-Z0-9_]+\s*\{|<minimax:tool_call>", raw)
            if tc_match and tc_match.start() > 0:
                reasoning = raw[:tc_match.start()].strip()
                raw = raw[tc_match.start():]
            else:
                html_match = re.search(r"<(?:p|div|ul|ol|table|h[1-6])[^>]*>", raw, re.IGNORECASE)
                if html_match and html_match.start() > 0:
                    reasoning = raw[:html_match.start()].strip()
                    raw = raw[html_match.start():]

        # Strip tool invocation strings from user content
        raw = TOOL_RE.sub("", raw)
        raw = re.sub(r"(?:<\|tool_call>)?call:[a-zA-Z0-9_]+\s*\{.*?(?:\}|$)", "", raw, flags=re.DOTALL)
        raw = re.sub(r"(?:<\|tool_call>)?call:[a-zA-Z0-9_]+.*$", "", raw, flags=re.DOTALL)
        raw = re.sub(r"<\|tool_call>", "", raw)

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

