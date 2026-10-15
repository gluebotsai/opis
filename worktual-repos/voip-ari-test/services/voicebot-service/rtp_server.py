import socket
import threading
import logging

logger = logging.getLogger("voicebot.rtp_server")

class UDPRTPServer:
    def __init__(self, host: str = "0.0.0.0", port: int = 5000, session_manager=None):
        self.host = host
        self.port = port
        self.session_manager = session_manager
        self.socket = None
        self.running = False
        self.thread = None

    def start(self):
        self.socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.socket.bind((self.host, self.port))
        self.running = True

        self.thread = threading.Thread(target=self._listen_loop, daemon=True)
        self.thread.start()
        logger.info(f"UDP RTP Server listening on {self.host}:{self.port}")

    def _listen_loop(self):
        BUFFER_SIZE = 2048
        while self.running:
            try:
                data, addr = self.socket.recvfrom(BUFFER_SIZE)
                if not data or len(data) < 12:
                    continue

                if self.session_manager:
                    self.session_manager.handle_inbound_rtp(data, addr, self.socket)

            except Exception as e:
                if self.running:
                    logger.error(f"Error in RTP socket loop: {e}")

    def stop(self):
        self.running = False
        if self.socket:
            try:
                self.socket.close()
            except Exception:
                pass
        logger.info("UDP RTP Server stopped")
