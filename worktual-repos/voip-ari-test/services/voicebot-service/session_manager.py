import os
import json
import logging
import threading
import time
import redis
from vad import SileroVADDetector
from stt_client import WorktualSTTClient
from utterance_gate import UtteranceGateClient
from llm_client import WorktualLLMClient
from tts_client import WorktualTTSClient
from rtp_sender import RTPSender

logger = logging.getLogger("voicebot.session")

class VoicebotCallSession:
    def __init__(self, call_id: str, caller_number: str = "", ccaas_number: str = "", redis_client=None):
        self.call_id = call_id
        self.caller_number = caller_number
        self.ccaas_number = ccaas_number
        self.redis_client = redis_client

        self.remote_addr = None
        self.inbound_payload_type = None
        self.rtp_sender = None
        self.active = True
        self.is_speaking = False # True when TTS is streaming
        self.is_greeting = False # True during initial greeting
        self.barge_in = False
        self.lock = threading.Lock()

        self.vad = SileroVADDetector()
        self.stt = WorktualSTTClient()
        self.gate = UtteranceGateClient()
        self.llm = WorktualLLMClient()
        self.tts = WorktualTTSClient()

    def publish_redis_event(self, event_name: str, payload: dict):
        if not self.redis_client:
            return
        try:
            full_payload = {
                "event": event_name,
                "callId": self.call_id,
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                **payload
            }
            self.redis_client.publish("telephony.events.asterisk", json.dumps(full_payload))
            logger.info(f"Published Redis event '{event_name}' for call {self.call_id}")
        except Exception as e:
            logger.error(f"Failed to publish Redis event '{event_name}': {e}")

    def get_rtp_sender(self, socket_obj) -> RTPSender:
        pt = self.inbound_payload_type if self.inbound_payload_type is not None else 118
        if self.rtp_sender is None:
            self.rtp_sender = RTPSender(udp_socket=socket_obj, payload_type=pt)
        else:
            self.rtp_sender.socket = socket_obj
            self.rtp_sender.payload_type = pt
        return self.rtp_sender

    def on_user_speech_detected(self, pcm_audio: bytes, socket_obj):
        if not self.active or not pcm_audio:
            return

        # Handle barge-in: stop any active TTS if user speaks substantial utterance
        if self.is_speaking:
            if self.is_greeting:
                logger.info(f"Speech detected during initial greeting for call {self.call_id}. Letting greeting complete.")
            elif len(pcm_audio) >= 16000: # At least 0.5 sec of user audio
                logger.info(f"Barge-in detected for call {self.call_id} ({len(pcm_audio)} bytes)! Halting active TTS.")
                self.barge_in = True
            else:
                logger.info(f"Short audio clip ({len(pcm_audio)} bytes) during TTS ignored for barge-in.")

        threading.Thread(target=self._process_turn, args=(pcm_audio, socket_obj), daemon=True).start()

    def _process_turn(self, pcm_audio: bytes, socket_obj):
        with self.lock:
            stt_res = self.stt.transcribe(pcm_audio, caller_num=self.caller_number, ccaas_num=self.ccaas_number)
            user_text = stt_res.get("text", "")

            if not user_text or user_text == "NOTEXT":
                logger.info(f"No speech recognized for call {self.call_id}")
                return

            logger.info(f"User utterance recognized [{self.call_id}]: '{user_text}'")
            self.publish_redis_event("voicebot.transcript", {
                "role": "user",
                "text": user_text
            })

            # Check utterance completion gate
            if not self.gate.is_utterance_complete(context="", user_text=user_text):
                logger.info(f"Utterance gate determined fragment for '{user_text}'. Waiting for more speech.")
                return

            llm_res = self.llm.query(
                user_input=user_text,
                session_id=self.call_id,
                caller_number=self.caller_number,
                lang=stt_res.get("lang", "en")
            )

            bot_text = llm_res.get("bot_response", "")
            bot_lang = llm_res.get("lang", "en")
            is_live_agent = llm_res.get("is_live_agent", False)

            if bot_text:
                logger.info(f"Bot response [{self.call_id}]: '{bot_text}' (lang={bot_lang})")
                self.publish_redis_event("voicebot.transcript", {
                    "role": "bot",
                    "text": bot_text
                })

            if is_live_agent:
                logger.info(f"LLM returned Live_Agent intent for call {self.call_id}. Emitting handoff event.")
                self.publish_redis_event("voicebot.handoff_requested", {
                    "reason": "bot_requested_live_agent"
                })

            if bot_text and socket_obj and self.remote_addr:
                self._speak_text(bot_text, bot_lang, socket_obj)

    def _speak_text(self, text: str, lang: str, socket_obj):
        self.is_speaking = True
        self.barge_in = False

        sender = self.get_rtp_sender(socket_obj)
        sender.reset_talkspurt()

        def stop_check():
            return not self.active or self.barge_in

        try:
            for pcm_16k in self.tts.stream_tts_16k(text, session_id=self.call_id, lang=lang, stop_check_fn=stop_check):
                if stop_check():
                    break
                sender.send_pcm_as_rtp(pcm_16k, self.remote_addr, stop_check_fn=stop_check)
        except Exception as e:
            logger.error(f"Error during TTS speaking for call {self.call_id}: {e}")
        finally:
            self.is_speaking = False

    def trigger_greeting(self, socket_obj):
        if not self.active:
            return

        def _run_greeting():
            with self.lock:
                self.is_greeting = True
                try:
                    logger.info(f"Triggering initial greeting for call {self.call_id}")
                    llm_res = self.llm.query(
                        user_input="GREETINGS",
                        session_id=self.call_id,
                        caller_number=self.caller_number,
                        lang="en"
                    )
                    bot_text = llm_res.get("bot_response", "Hello, how can I help you today?")
                    bot_lang = llm_res.get("lang", "en")

                    logger.info(f"Greeting response [{self.call_id}]: '{bot_text}'")
                    self.publish_redis_event("voicebot.transcript", {
                        "role": "bot",
                        "text": bot_text
                    })

                    if socket_obj and self.remote_addr:
                        self._speak_text(bot_text, bot_lang, socket_obj)
                finally:
                    self.is_greeting = False

        threading.Thread(target=_run_greeting, daemon=True).start()

    def close(self):
        self.active = False
        self.barge_in = True


class VoicebotSessionManager:
    def __init__(self):
        self.sessions: dict[str, VoicebotCallSession] = {}
        self.addr_to_call_id: dict[tuple[str, int], str] = {}
        self.lock = threading.Lock()

        redis_url = os.getenv("REDIS_URL", "redis://127.0.0.1:6379")
        try:
            self.redis_client = redis.Redis.from_url(redis_url)
            logger.info(f"Connected to Redis at {redis_url}")
        except Exception as e:
            logger.warning(f"Failed to connect to Redis ({redis_url}): {e}")
            self.redis_client = None

    def start_session(self, call_id: str, caller_number: str = "", ccaas_number: str = "") -> VoicebotCallSession:
        with self.lock:
            if call_id in self.sessions:
                logger.info(f"Session {call_id} already exists. Re-using.")
                return self.sessions[call_id]

            session = VoicebotCallSession(
                call_id=call_id,
                caller_number=caller_number,
                ccaas_number=ccaas_number,
                redis_client=self.redis_client
            )
            self.sessions[call_id] = session
            logger.info(f"Started voicebot session for call {call_id}")
            return session

    def stop_session(self, call_id: str):
        with self.lock:
            session = self.sessions.pop(call_id, None)
            if session:
                session.close()
                if session.remote_addr:
                    self.addr_to_call_id.pop(session.remote_addr, None)
                logger.info(f"Stopped voicebot session for call {call_id}")

    def handle_inbound_rtp(self, rtp_packet: bytes, remote_addr: tuple[str, int], socket_obj):
        if len(rtp_packet) < 12:
            return

        inbound_pt = rtp_packet[1] & 0x7F
        pcm_payload = rtp_packet[12:]

        # Resolve session by remote_addr or single active session fallback
        session = None
        with self.lock:
            call_id = self.addr_to_call_id.get(remote_addr)
            if call_id:
                session = self.sessions.get(call_id)
            elif len(self.sessions) == 1:
                # Associate remote_addr with the single active session
                session = list(self.sessions.values())[0]
                session.remote_addr = remote_addr
                session.inbound_payload_type = inbound_pt
                self.addr_to_call_id[remote_addr] = session.call_id
                logger.info(f"Associated Asterisk RTP remote address {remote_addr} (PT={inbound_pt}) with call {session.call_id}")
                # Trigger initial greeting upon receiving first RTP packet
                session.trigger_greeting(socket_obj)

        if session:
            if session.inbound_payload_type is None:
                session.inbound_payload_type = inbound_pt

            is_speech_active, speech_ended, completed_pcm = session.vad.process_chunk(pcm_payload)
            if speech_ended and completed_pcm:
                session.on_user_speech_detected(completed_pcm, socket_obj)
