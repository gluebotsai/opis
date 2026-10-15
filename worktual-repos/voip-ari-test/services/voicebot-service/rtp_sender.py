import socket
import struct
import time
import logging

logger = logging.getLogger("voicebot.rtp")

class RTPSender:
    def __init__(self, udp_socket: socket.socket, payload_type: int = 118, ssrc: int = 12345678):
        self.socket = udp_socket
        self.payload_type = payload_type
        self.ssrc = ssrc
        self.sequence_number = 1
        self.timestamp = 0
        self.first_packet_of_talkspurt = True

    def reset_talkspurt(self):
        self.first_packet_of_talkspurt = True

    def build_rtp_header(self, marker: bool = False) -> bytes:
        version = 2
        padding = 0
        extension = 0
        csrc_count = 0

        first_byte = (version << 6) | (padding << 5) | (extension << 4) | csrc_count
        second_byte = ((1 if marker else 0) << 7) | (self.payload_type & 0x7F)

        header = struct.pack(
            '!BBHII',
            first_byte,
            second_byte,
            self.sequence_number & 0xFFFF,
            self.timestamp & 0xFFFFFFFF,
            self.ssrc & 0xFFFFFFFF
        )

        self.sequence_number = (self.sequence_number + 1) & 0xFFFF
        return header

    def send_pcm_as_rtp(self, pcm_bytes_16k: bytes, remote_addr: tuple[str, int], stop_check_fn=None):
        """
        Frames 16kHz PCM into 20ms RTP packets (640 bytes = 320 samples) and sends to remote_addr.
        Paces transmission at ~20ms per packet.
        """
        if not remote_addr or not pcm_bytes_16k:
            logger.warning(f"send_pcm_as_rtp skipped: remote_addr={remote_addr}, pcm_len={len(pcm_bytes_16k) if pcm_bytes_16k else 0}")
            return

        FRAME_SIZE = 640 # 320 samples * 2 bytes = 20ms of 16kHz audio
        SAMPLES_PER_FRAME = 320
        FRAME_DURATION = 0.020 # 20ms

        offset = 0
        total_len = len(pcm_bytes_16k)
        total_packets = (total_len + FRAME_SIZE - 1) // FRAME_SIZE
        sent_packets = 0

        logger.info(f"Starting RTP transmission: {total_len} bytes ({total_packets} packets) -> {remote_addr} (PT={self.payload_type}, SSRC={self.ssrc}, StartSeq={self.sequence_number})")

        next_frame_time = time.time()

        while offset < total_len:
            if stop_check_fn and stop_check_fn():
                logger.info(f"RTP transmission stopped by stop_check_fn after {sent_packets}/{total_packets} packets (barge-in or cancellation)")
                break

            chunk = pcm_bytes_16k[offset:offset + FRAME_SIZE]
            offset += FRAME_SIZE

            # Pad last packet with silence if partial frame
            if len(chunk) < FRAME_SIZE:
                chunk = chunk + b'\x00' * (FRAME_SIZE - len(chunk))

            marker = self.first_packet_of_talkspurt
            rtp_header = self.build_rtp_header(marker=marker)
            self.first_packet_of_talkspurt = False

            packet = rtp_header + chunk

            try:
                self.socket.sendto(packet, remote_addr)
                sent_packets += 1
            except Exception as e:
                logger.error(f"Failed to send RTP packet to {remote_addr}: {e}")

            self.timestamp = (self.timestamp + SAMPLES_PER_FRAME) & 0xFFFFFFFF

            next_frame_time += FRAME_DURATION
            sleep_time = next_frame_time - time.time()
            if sleep_time > 0:
                time.sleep(sleep_time)
            else:
                next_frame_time = time.time() # Reset clock if falling behind

        logger.info(f"Completed RTP chunk transmission: sent {sent_packets}/{total_packets} packets to {remote_addr}")
