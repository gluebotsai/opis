#!/usr/bin/env python3
"""
Start/stop Web Tracking: API, AI Chat, and dashboard (web).

Usage:
    python run_service.py --all
    python run_service.py --stop
    python run_service.py --status

Services (paths relative to this script's directory):
    api-node  -> yarn dev          (port API_PORT, default 7861)
    ai-chat   -> uvicorn           (port AI_CHAT_PORT, default 7863)
    web       -> yarn dev          (port WEB_PORT, default 7862)

Example on QA server:
    cd ~/Web_tracking_workspace/current_setup
    python run_service.py --all
"""

from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent

STATE_DIR = ROOT / ".local" / "run_service"
PID_DIR = STATE_DIR / "pids"
LOG_DIR = STATE_DIR / "logs"

# Start order: API → AI Chat → Web. Stop uses reverse order.
SERVICE_ORDER = ("api-node", "ai-chat", "web")


def load_env() -> None:
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    try:
        from dotenv import load_dotenv

        load_dotenv(env_file)
        return
    except ImportError:
        pass
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


def env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return int(raw)


def env_str(name: str, default: str) -> str:
    return os.environ.get(name, default)


def build_services() -> dict[str, dict]:
    load_env()
    chat_host = env_str("AI_CHAT_HOST", env_str("SERVICE_HOST", "0.0.0.0"))
    chat_port = env_int("AI_CHAT_PORT", env_int("CHAT_SOCKET_PORT", 7863))

    return {
        "api-node": {
            "cwd": ROOT / "api-node",
            "command": ["yarn", "dev"],
        },
        "ai-chat": {
            "cwd": ROOT / "AI_CHAT",
            "command": [
                sys.executable,
                "-m",
                "uvicorn",
                "app.main:app",
                "--host",
                chat_host,
                "--port",
                str(chat_port),
            ],
        },
        "web": {
            "cwd": ROOT / "web",
            "command": ["yarn", "dev"],
        },
    }


def pid_file(name: str) -> Path:
    return PID_DIR / f"{name}.pid"


def log_file(name: str) -> Path:
    return LOG_DIR / f"{name}.log"


def read_pid(name: str) -> int | None:
    path = pid_file(name)
    if not path.exists():
        return None

    try:
        return int(path.read_text(encoding="utf-8").strip())
    except (ValueError, OSError):
        path.unlink(missing_ok=True)
        return None


def is_running(name: str) -> bool:
    pid = read_pid(name)
    if pid is None:
        return False

    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        pid_file(name).unlink(missing_ok=True)
        return False
    except PermissionError:
        return True
    except OSError:
        pid_file(name).unlink(missing_ok=True)
        return False

    return True


def start_service(name: str, services: dict[str, dict]) -> None:
    service = services[name]
    cwd = service["cwd"]
    command = service["command"]

    if not cwd.is_dir():
        print(f"ERROR: directory does not exist: {cwd}")
        return

    if is_running(name):
        print(f"{name}: already running (pid {read_pid(name)})")
        return

    PID_DIR.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)

    logpath = log_file(name)

    print(f"Starting {name}...")
    print(f"  cwd : {cwd}")
    print(f"  cmd : {' '.join(command)}")
    print(f"  log : {logpath}")

    env = os.environ.copy()
    env.setdefault("PYTHONUNBUFFERED", "1")

    with logpath.open("a", encoding="utf-8") as log:
        log.write(f"\n{'=' * 80}\n")
        log.write(f"Starting {name} at {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
        log.write(f"cwd: {cwd}\n")
        log.write(f"command: {' '.join(command)}\n")
        log.write(f"{'=' * 80}\n")
        log.flush()

        process = subprocess.Popen(
            command,
            cwd=cwd,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
            env=env,
        )

    pid_file(name).write_text(str(process.pid), encoding="utf-8")
    print(f"  pid : {process.pid}")


def stop_service(name: str) -> None:
    pid = read_pid(name)

    if pid is None:
        print(f"{name}: not running")
        return

    print(f"Stopping {name} (pid {pid})...")

    try:
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    except PermissionError:
        print(f"ERROR: no permission to stop {name} (pid {pid})")
        return
    except OSError:
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass

    deadline = time.time() + 5
    while time.time() < deadline:
        if not is_running(name):
            print(f"{name}: stopped")
            return
        time.sleep(0.2)

    if is_running(name):
        print(f"{name}: did not stop gracefully; sending SIGKILL...")
        try:
            os.killpg(pid, signal.SIGKILL)
        except OSError:
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass

    pid_file(name).unlink(missing_ok=True)
    print(f"{name}: stopped")


def status(services: dict[str, dict]) -> None:
    load_env()
    api_port = env_int("API_PORT", 7861)
    web_port = env_int("WEB_PORT", 7862)
    chat_port = env_int("AI_CHAT_PORT", env_int("CHAT_SOCKET_PORT", 7863))

    print("Web Tracking services:")
    for name in SERVICE_ORDER:
        pid = read_pid(name)
        if pid is not None and is_running(name):
            print(f"  {name:10} RUNNING  pid={pid}")
        else:
            print(f"  {name:10} STOPPED")

    print("")
    print("Expected ports (from .env):")
    print(f"  api-node  http://127.0.0.1:{api_port}")
    print(f"  ai-chat   http://127.0.0.1:{chat_port}/health")
    print(f"  web       http://127.0.0.1:{web_port}")


def print_started_info() -> None:
    load_env()
    api_port = env_int("API_PORT", 7861)
    web_port = env_int("WEB_PORT", 7862)
    chat_port = env_int("AI_CHAT_PORT", env_int("CHAT_SOCKET_PORT", 7863))

    print("\nAll services started in the background.")
    print("Logs:")
    print(f"  API:      {log_file('api-node')}")
    print(f"  AI Chat:  {log_file('ai-chat')}")
    print(f"  Web:      {log_file('web')}")
    print("")
    print("Local URLs:")
    print(f"  API:      http://127.0.0.1:{api_port}/health")
    print(f"  AI Chat:  http://127.0.0.1:{chat_port}/health")
    print(f"  Web:      http://127.0.0.1:{web_port}/")
    print("")
    print("Stop with:")
    print("  python run_service.py --stop")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Start/stop Web Tracking api-node, ai-chat, and web services."
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Start api-node, ai-chat, and web in the background.",
    )
    parser.add_argument(
        "--stop",
        action="store_true",
        help="Stop all services.",
    )
    parser.add_argument(
        "--status",
        action="store_true",
        help="Show service status and expected ports.",
    )

    args = parser.parse_args()
    services = build_services()

    if args.stop:
        for name in reversed(SERVICE_ORDER):
            stop_service(name)
        return 0

    if args.status:
        status(services)
        return 0

    if args.all:
        for name in SERVICE_ORDER:
            start_service(name, services)
            time.sleep(0.5)
        print_started_info()
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
