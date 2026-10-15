import os
import logging
import requests
from openai import OpenAI

logger = logging.getLogger("voicebot.gate")

class UtteranceGateClient:
    def __init__(self, base_url: str = None):
        self.base_url = base_url or os.getenv("VOICEBOT_UTTERANCE_GATE_URL", "http://173.234.75.166:8011/v1")
        self.enabled = os.getenv("VOICEBOT_ENABLE_UTTERANCE_GATE", "false").lower() == "true"
        if self.enabled:
            logger.info(f"Initializing Utterance Gate endpoint={self.base_url}")
            self.client = OpenAI(api_key="not-needed", base_url=self.base_url)
        else:
            self.client = None

    def is_utterance_complete(self, context: str, user_text: str) -> bool:
        if not self.enabled or not self.client:
            return True

        if not user_text or user_text == "NOTEXT":
            return True

        system_prompt = (
            "Role: Real-Time Speech Completion Engine.\n"
            "Output Format: Return ONLY 1 (complete) or 0 (incomplete)."
        )
        user_prompt = f"Context: {context}\nUser: {user_text}\nAnswer:"

        try:
            response = self.client.chat.completions.create(
                model="worktual-gemma",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                max_tokens=1,
                temperature=0.5,
                stop=["\n"],
            )
            result = response.choices[0].message.content.strip()
            logger.info(f"Utterance gate result for '{user_text}': {result}")
            return result == "1"
        except Exception as e:
            logger.warning(f"Utterance gate call failed: {e}. Defaulting to complete.")
            return True
