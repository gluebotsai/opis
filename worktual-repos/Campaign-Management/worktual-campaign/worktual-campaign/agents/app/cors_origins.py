"""CORS allowlist from env plus auto-detected LAN frontend origins (dev)."""

from __future__ import annotations

import os
import socket
import subprocess

_DEFAULT_LOCAL = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
)
_DEV_FE_PORTS = (5173, 4173)


def _macos_iface_ips() -> set[str]:
    ips: set[str] = set()
    for iface in ("en0", "en1", "en2", "en3"):
        try:
            out = subprocess.check_output(
                ["ipconfig", "getifaddr", iface],
                stderr=subprocess.DEVNULL,
                text=True,
                timeout=2,
            ).strip()
            if out and not out.startswith("127."):
                ips.add(out)
        except (OSError, subprocess.SubprocessError):
            continue
    return ips


def _local_ipv4_addresses() -> list[str]:
    ips: set[str] = set(_macos_iface_ips())
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip and not ip.startswith("127."):
                ips.add(ip)
    except OSError:
        pass
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            ip = sock.getsockname()[0]
            if ip and not ip.startswith("127."):
                ips.add(ip)
    except OSError:
        pass
    # Optional override from LAN FE URL (set by scripts/dev-lan.sh).
    for key in ("VITE_PUBLIC_APP_URL", "PUBLIC_APP_URL", "LAN_FE_URL"):
        raw = str(os.environ.get(key) or "").strip()
        if not raw:
            continue
        # http://192.168.x.x:5173 → host
        try:
            host = raw.split("://", 1)[1].split("/", 1)[0].split(":")[0]
            if host and not host.startswith("127.") and host not in (
                "localhost",
            ):
                ips.add(host)
        except IndexError:
            pass
    return sorted(ips)


def build_cors_origins(
    cors_origin_env: str,
    *,
    fe_ports: tuple[int, ...] = _DEV_FE_PORTS,
) -> list[str]:
    """Merge CORS_ORIGIN env with localhost defaults and local LAN FE URLs."""
    origins: set[str] = set(_DEFAULT_LOCAL)
    for part in str(cors_origin_env or "").split(","):
        origin = part.strip().rstrip("/")
        if origin:
            origins.add(origin)
    for ip in _local_ipv4_addresses():
        for port in fe_ports:
            origins.add(f"http://{ip}:{port}")
    return sorted(origins)
