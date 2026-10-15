import logging
import os
import subprocess
import sys
from typing import Any

from app.config import get_settings

_log = logging.getLogger(__name__)


def _a2a_autostart_enabled() -> bool:
    raw = os.environ.get("A2A_AUTOSTART", "1").strip().lower()
    return raw not in ("0", "false", "no", "off")


def _start_a2a_sidecar(settings: Any) -> subprocess.Popen[Any] | None:
    """Hub spoke on A2A_PORT (local dev). Docker uses separate `a2a` service — set A2A_AUTOSTART=0."""
    if not _a2a_autostart_enabled():
        return None
    cmd = [
        sys.executable,
        "-m",
        "uvicorn",
        "app.a2a_main:app",
        "--host",
        settings.a2a_host,
        "--port",
        str(settings.a2a_port),
    ]
    env = os.environ.copy()
    env.setdefault("PYTHONPATH", os.getcwd())
    proc = subprocess.Popen(cmd, env=env)
    _log.info(
        "A2A sidecar started (pid=%s) http://%s:%s — disable with A2A_AUTOSTART=0",
        proc.pid,
        settings.a2a_host,
        settings.a2a_port,
    )
    return proc


def run():
    import uvicorn

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        force=True,
    )
    settings = get_settings()
    a2a_proc = _start_a2a_sidecar(settings)

    def _stop_a2a(*_args: object) -> None:
        if a2a_proc is None or a2a_proc.poll() is not None:
            return
        a2a_proc.terminate()
        try:
            a2a_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            a2a_proc.kill()

    try:
        uvicorn.run(
            "app.socket_server:app",
            host=settings.agents_host,
            port=settings.agents_port,
            reload=False,
            access_log=False,
        )
    finally:
        _stop_a2a()


if __name__ == "__main__":
    run()
