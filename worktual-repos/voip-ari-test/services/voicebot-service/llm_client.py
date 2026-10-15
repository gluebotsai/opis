import os
import logging
import requests

logger = logging.getLogger("voicebot.llm")

class WorktualLLMClient:
    def __init__(self, llm_url: str = None):
        self.llm_url = llm_url or os.getenv("VOICEBOT_LLM_URL", "http://173.234.75.165:7048/voicebot_multilingual")
        logger.info(f"Initializing Worktual LLM Client endpoint={self.llm_url}")

    def query(self, user_input: str, session_id: str, caller_number: str = "", lang: str = "en") -> dict:
        payload = {
            "user_input": user_input,
            "session_id": session_id,
            "caller_number": caller_number,
            "lang": lang,
            "user_silence": ""
        }

        logger.info(f"Posting to LLM [{self.llm_url}] payload={payload}")
        try:
            resp = requests.post(self.llm_url, json=payload, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            logger.info(f"LLM raw response: {data}")

            bot_response = data.get("bot_respones") or data.get("bot_response") or data.get("text") or ""
            intent = data.get("intent") or data.get("status") or ""
            tts_lang = data.get("lang") or lang or "en"

            is_live_agent = (intent == "Live_Agent" or intent == "LIVE_AGENT" or bot_response == "LIVE_AGENT")

            if is_live_agent and not bot_response:
                bot_response = "Connecting you to a live agent, please hold."

            return {
                "bot_response": bot_response,
                "intent": intent,
                "lang": tts_lang,
                "is_live_agent": is_live_agent
            }
        except Exception as e:
            logger.error(f"Error querying LLM API ({self.llm_url}): {e}")
            return {
                "bot_response": "Sorry, I am having trouble connecting to my response engine right now.",
                "intent": "error",
                "lang": "en",
                "is_live_agent": False
            }
