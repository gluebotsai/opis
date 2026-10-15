
from openai import OpenAI
import os
from datetime import datetime
from io import BytesIO
from PIL import Image
import google as genai

class GPTLLM:
    def __init__(
        self,
        api_key="",
        model_name="gpt-oss-120b",
        base_url="http://173.234.75.166:8003/v1",
    ):
        self.client = OpenAI(
            api_key=api_key,
            base_url=base_url,
        )
        self.model_name = model_name

    def run(self, messages, tools=None, *, temperature=0.7, max_tokens=29000):
        # Do not register ClickHouse / metric SQL tools. KPIs go through Context Layer.
        if tools:
            tools = None

        params = {
            "model": self.model_name,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": False,
            "reasoning_effort": "medium",
        }

        if tools:
            params["tools"] = tools

        resp = self.client.chat.completions.create(**params).model_dump()

        msg = resp["choices"][0]["message"]

        return {
            "content": msg.get("content"),
            "tool_calls": msg.get("tool_calls"),
            "reasoning": msg.get("reasoning"),
        }
 