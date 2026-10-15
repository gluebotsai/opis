#!/usr/bin/env python3
"""Start Worktual Analytics locally (ingest, kafka, api, ai-chat, web).

Run from project root (reads ports and DB settings from .env):

    python run_backend.py --all              # all services including web dashboard
    python run_backend.py --all --detach     # start and survive SSH logout
    python run_backend.py                    # ingest + api + ai-chat (+ kafka if enabled)
    python run_backend.py --only ingest      # single service
    python run_backend.py --only api web     # selected services
    python run_backend.py --status           # show running services / ports
    python run_backend.py --stop             # stop services started by this script

Run each service separately (foreground, from project root):

    python etl/run_ingest.py                 # ingest (port INGEST_PORT, default 7860)
    python etl/run_kafka_consumer.py         # kafka → ClickHouse (when INGEST_WRITE_MODE=kafka|dual)
    cd api-node && yarn dev                  # API (port API_PORT, default 7861)
    cd AI_CHAT && python -m uvicorn app.main:app --host 0.0.0.0 --port 7863
    cd web && yarn dev                       # dashboard (port WEB_PORT, default 7862)
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LOG_DIR = ROOT / ".local" / "logs"
PID_DIR = ROOT / ".local" / "pids"

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None


def load_env() -> None:
    env_file = ROOT / ".env"
    if load_dotenv is not None and env_file.exists():
        load_dotenv(env_file)
        return
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


def env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    return int(raw)


def env_str(name: str, default: str) -> str:
    return os.environ.get(name, default)


def pid_path(name: str) -> Path:
    return PID_DIR / f"{name}.pid"


def log_path(name: str) -> Path:
    return LOG_DIR / f"{name}.log"


def is_running(name: str) -> bool:
    path = pid_path(name)
    if not path.exists():
        return False
    pid = int(path.read_text(encoding="utf-8").strip())
    try:
        os.kill(pid, 0)
    except OSError:
        path.unlink(missing_ok=True)
        return False
    return True


def stop_services(names: list[str]) -> None:
    for name in names:
        path = pid_path(name)
        if path.exists():
            pid = int(path.read_text(encoding="utf-8").strip())
            print(f"Stopping {name} (pid {pid})...")
            try:
                os.kill(pid, signal.SIGTERM)
            except OSError:
                pass
            path.unlink(missing_ok=True)
            continue

        if name == "web":
            web_port = env_int("WEB_PORT", 7862)
            listener = pid_on_port(web_port)
            if listener is not None:
                print(f"Stopping {name} (pid {listener} on port {web_port})...")
                try:
                    os.kill(listener, signal.SIGTERM)
                except OSError:
                    pass
    print("All services stopped.")


def pid_on_port(port: int) -> int | None:
    try:
        result = subprocess.run(
            ["ss", "-tlnp", f"sport = :{port}"],
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError:
        return None
    for line in result.stdout.splitlines():
        match = re.search(r"pid=(\d+)", line)
        if match and f":{port}" in line:
            return int(match.group(1))
    return None


def ensure_port_available(name: str, port: int) -> None:
    listener = pid_on_port(port)
    if listener is None:
        return

    for svc in all_service_names():
        path = pid_path(svc)
        if not path.exists():
            continue
        try:
            if int(path.read_text(encoding="utf-8").strip()) == listener and is_running(svc):
                return
        except ValueError:
            continue

    print(f"Freeing port {port} (stopping pid {listener})...")
    try:
        os.kill(listener, signal.SIGTERM)
    except OSError:
        pass
    time.sleep(0.5)


def ensure_ai_chat_deps() -> None:
    """Install AI_CHAT requirements when key modules are missing."""
    missing = []
    for module in ("asyncpg", "sqlalchemy"):
        try:
            __import__(module)
        except ImportError:
            missing.append(module)

    if not missing:
        return

    req = ROOT / "AI_CHAT" / "requirements.txt"
    if not req.exists():
        print("Warning: AI_CHAT/requirements.txt not found; AI chat may fail to start.")
        return

    print(
        f"Installing AI_CHAT Python dependencies into {sys.executable} "
        f"(missing: {', '.join(missing)})..."
    )
    result = subprocess.run(
        [sys.executable, "-m", "pip", "install", "-r", str(req)],
        check=False,
    )
    if result.returncode != 0:
        print(
            "ERROR: Failed to install AI_CHAT dependencies. Run manually:\n"
            f"  {sys.executable} -m pip install -r {req}",
            file=sys.stderr,
        )
        return

    still_missing = [m for m in ("asyncpg", "sqlalchemy") if m in missing]
    for module in list(still_missing):
        try:
            __import__(module)
            still_missing.remove(module)
        except ImportError:
            pass
    if still_missing:
        print(
            "ERROR: AI_CHAT dependencies still missing after install: "
            + ", ".join(still_missing),
            file=sys.stderr,
        )


def fix_api_node_binary_permissions(api_node: Path) -> int:
    """Restore +x on native bins (esbuild EACCES when node_modules was copied or extracted)."""
    fixed = 0
    node_modules = api_node / "node_modules"
    if not node_modules.is_dir():
        return 0

    for path in node_modules.rglob("esbuild"):
        if path.is_file() and path.parent.name == "bin" and not os.access(path, os.X_OK):
            path.chmod(path.stat().st_mode | 0o111)
            fixed += 1

    bin_dir = node_modules / ".bin"
    if bin_dir.is_dir():
        for path in bin_dir.iterdir():
            if path.is_file() and not os.access(path, os.X_OK):
                path.chmod(path.stat().st_mode | 0o111)
                fixed += 1
    return fixed


def api_node_dev_tools_ok(api_node: Path) -> bool:
    """tsx dev mode needs a runnable @esbuild/*/bin/esbuild binary."""
    esbuild_root = api_node / "node_modules" / "@esbuild"
    if not esbuild_root.is_dir():
        return False
    for path in esbuild_root.glob("*/bin/esbuild"):
        if path.is_file() and os.access(path, os.X_OK):
            return True
    return False


def api_node_module_resolves(api_node: Path, module: str) -> bool:
    """True when Node can resolve an ESM package from api-node (not just node_modules/ exists)."""
    script = (
        f"import('{module}')"
        ".then(() => process.exit(0))"
        ".catch(() => process.exit(1))"
    )
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=api_node,
        capture_output=True,
        check=False,
    )
    return result.returncode == 0


def api_node_production_build(api_node: Path) -> bool:
    if os.environ.get("RUN_BACKEND", "").strip().lower() in ("0", "false"):
        return False
    return (api_node / "dist" / "index.js").exists()


def api_node_deps_satisfied(api_node: Path) -> bool:
    if not api_node_module_resolves(api_node, "bcryptjs"):
        return False
    if api_node_production_build(api_node):
        return True
    return (api_node / "node_modules" / ".bin" / "tsx").exists() and api_node_dev_tools_ok(api_node)


def node_use_npm(project_dir: Path) -> bool:
    """Prefer npm when Yarn 1.x is global but package.json expects Yarn 4 (corepack)."""
    if os.environ.get("RUN_BACKEND_USE_NPM", "").strip().lower() in ("1", "true", "yes"):
        return True
    if not (project_dir / "package-lock.json").exists():
        return not (project_dir / "yarn.lock").exists()
    yarn = shutil.which("yarn")
    if not yarn:
        return True
    try:
        ver = subprocess.run(
            [yarn, "--version"],
            capture_output=True,
            text=True,
            check=False,
            timeout=10,
        )
        if ver.returncode != 0 or ver.stdout.strip().startswith("1."):
            return True
    except (OSError, subprocess.TimeoutExpired):
        return True
    return False


def install_api_node_deps(api_node: Path) -> bool:
    use_npm = node_use_npm(api_node)
    if use_npm:
        result = subprocess.run(["npm", "ci"], cwd=api_node, check=False)
        if result.returncode != 0:
            result = subprocess.run(["npm", "install"], cwd=api_node, check=False)
    else:
        subprocess.run(["corepack", "enable"], check=False)
        result = subprocess.run(["yarn", "install"], cwd=api_node, check=False)
        if result.returncode != 0:
            print("yarn install failed; trying npm install...", file=sys.stderr)
            result = subprocess.run(["npm", "install"], cwd=api_node, check=False)

    if result.returncode != 0:
        return False

    prisma = ["npx", "prisma", "generate"] if use_npm else ["yarn", "prisma", "generate"]
    subprocess.run(prisma, cwd=api_node, check=False)
    fix_api_node_binary_permissions(api_node)
    return True


def ensure_api_node_deps() -> bool:
    """Ensure api-node has runtime deps (bcryptjs, tsx for dev) after git pull."""
    api_node = ROOT / "api-node"
    package_json = api_node / "package.json"
    if not package_json.exists():
        return True

    fix_api_node_binary_permissions(api_node)
    if api_node_deps_satisfied(api_node):
        return True

    print(
        "api-node dependencies missing or incomplete (bcryptjs/tsx/esbuild). "
        "Run: bash scripts/setup_api_node.sh"
    )
    if not install_api_node_deps(api_node):
        print(
            "ERROR: api-node dependency install failed. On the server run:\n"
            f"  bash {ROOT / 'scripts' / 'setup_api_node.sh'}",
            file=sys.stderr,
        )
        return False
    if not api_node_deps_satisfied(api_node):
        print(
            "ERROR: api-node deps still missing after install. "
            "Check api-node/package.json uses bcryptjs (not bcrypt) and .yarnrc.yml has enableScripts: true.",
            file=sys.stderr,
        )
        return False
    return True


def port_open(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex((host, port)) == 0


def verify_service_started(
    name: str,
    port: int | None = None,
    timeout: float = 10.0,
    *,
    require_running_pid: bool = True,
) -> bool:
    """Wait until the service listens on port (and optionally our launcher PID is alive).

    Uvicorn/tsx use a parent watcher; the port is often bound by a child PID.
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        port_ready = port is None or port_open("127.0.0.1", port)
        pid_alive = is_running(name)
        if port_ready and (not require_running_pid or pid_alive):
            return True
        if require_running_pid and not pid_alive and port is not None and not port_ready:
            break
        time.sleep(0.25)

    log_file = log_path(name)
    print(f"ERROR: {name} failed to start.", file=sys.stderr)
    if log_file.exists():
        lines = log_file.read_text(encoding="utf-8").splitlines()
        err_lines = [
            ln
            for ln in lines
            if "ERR_MODULE_NOT_FOUND" in ln
            or "Cannot find package" in ln
            or "EACCES" in ln
            or "esbuild" in ln.lower()
        ]
        tail = err_lines[-3:] if err_lines else lines[-15:]
        for line in tail:
            print(f"  {line}", file=sys.stderr)
        if any("EACCES" in ln and "esbuild" in ln for ln in lines):
            print(
                f"  Fix: bash {ROOT / 'scripts' / 'setup_api_node.sh'} "
                "(stale/copied node_modules — do not copy node_modules between machines)",
                file=sys.stderr,
            )
        elif any("ERR_MODULE_NOT_FOUND" in ln or "Cannot find package" in ln for ln in lines):
            print(
                f"  Fix: bash {ROOT / 'scripts' / 'setup_api_node.sh'}",
                file=sys.stderr,
            )
        print(f"  full log: {log_file}", file=sys.stderr)
    if port is not None and port_open("127.0.0.1", port):
        print(
            f"Note: port {port} is open — {name} may be running under a child process. "
            f"Check: ss -tlnp | grep :{port}",
            file=sys.stderr,
        )
        return True
    pid_path(name).unlink(missing_ok=True)
    return False


def start_service(name: str, command: list[str], cwd: Path) -> None:
    if is_running(name):
        pid = pid_path(name).read_text(encoding="utf-8").strip()
        print(f"{name} already running (pid {pid})")
        return

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    PID_DIR.mkdir(parents=True, exist_ok=True)

    env = os.environ.copy()
    env["RUN_BACKEND"] = "1"
    python_paths = [str(ROOT)]
    if str(cwd) not in python_paths:
        python_paths.append(str(cwd))
    env["PYTHONPATH"] = os.pathsep.join(python_paths)

    log_file = log_path(name)
    print(f"Starting {name}...")
    with log_file.open("a", encoding="utf-8") as log:
        proc = subprocess.Popen(
            command,
            cwd=cwd,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    pid_path(name).write_text(str(proc.pid), encoding="utf-8")
    print(f"  pid: {proc.pid}")
    print(f"  log: {log_file}")


def uses_kafka_ingest() -> bool:
    mode = os.environ.get("INGEST_WRITE_MODE", "direct").strip().lower()
    return mode in {"kafka", "dual"}


def node_production_mode(service: str, project_dir: Path) -> bool:
    if os.environ.get("RUN_BACKEND", "").strip().lower() in ("0", "false"):
        return False
    if service == "api":
        return (project_dir / "dist" / "index.js").exists()
    if service == "web":
        return (project_dir / "dist" / "index.html").exists()
    return False


def node_service_command(service: str, project_dir: Path) -> list[str]:
    """Dev or production command for Node services (survives SSH when RUN_BACKEND=1)."""
    use_npm = node_use_npm(project_dir)
    host = env_str("SERVICE_HOST", "0.0.0.0")

    if service == "api":
        if node_production_mode("api", project_dir):
            return ["npm", "run", "start"] if use_npm else ["yarn", "start"]
        return ["npm", "run", "dev"] if use_npm else ["yarn", "dev"]

    if service == "web":
        web_port = str(env_int("WEB_PORT", 7862))
        if node_production_mode("web", project_dir):
            vite = ["vite", "preview", "--host", host, "--port", web_port]
            return ["npx", *vite] if use_npm else ["yarn", "exec", *vite]
        return ["npm", "run", "dev"] if use_npm else ["yarn", "dev"]

    if use_npm:
        return ["npm", "run", "dev"]
    return ["yarn", "dev"]


def build_commands(
    *,
    include_web: bool,
    selected: set[str] | None = None,
) -> list[tuple[str, list[str], Path]]:
    host = env_str("SERVICE_HOST", "0.0.0.0")
    ai_chat_port = env_int("AI_CHAT_PORT", env_int("CHAT_SOCKET_PORT", 7863))

    etl = ROOT / "etl"
    api_node = ROOT / "api-node"
    web = ROOT / "web"
    ai_chat = ROOT / "AI_CHAT"

    all_commands: list[tuple[str, list[str], Path]] = [
        (
            "ingest",
            [sys.executable, str(etl / "run_ingest.py"), "--no-reload"],
            etl,
        ),
        (
            "api",
            node_service_command("api", api_node),
            api_node,
        ),
        (
            "ai-chat",
            [
                sys.executable,
                "-m",
                "uvicorn",
                "app.main:app",
                "--host",
                host,
                "--port",
                str(ai_chat_port),
            ],
            ai_chat,
        ),
        (
            "web",
            node_service_command("web", web),
            web,
        ),
        (
            "kafka-consumer",
            [sys.executable, str(etl / "run_kafka_consumer.py")],
            etl,
        ),
    ]

    if selected is not None:
        return [item for item in all_commands if item[0] in selected]

    commands = [item for item in all_commands if item[0] in {"ingest", "api", "ai-chat"}]
    # Start kafka before web — web verify can take ~25s and delayed kafka looked "missing" in --detach.
    if uses_kafka_ingest():
        commands.append(next(item for item in all_commands if item[0] == "kafka-consumer"))
    if include_web:
        commands.append(next(item for item in all_commands if item[0] == "web"))
    return commands


def all_service_names() -> list[str]:
    names = ["ingest", "api", "ai-chat", "web", "kafka-consumer"]
    return names


def normalize_only_names(raw: list[str]) -> set[str]:
    aliases = {
        "api-node": "api",
        "kafka": "kafka-consumer",
        "consumer": "kafka-consumer",
        "chat": "ai-chat",
        "ai_chat": "ai-chat",
    }
    valid = set(all_service_names())
    selected: set[str] = set()
    for name in raw:
        mapped = aliases.get(name.lower(), name.lower())
        if mapped not in valid:
            raise SystemExit(
                f"Unknown service {name!r}. Choose from: {', '.join(sorted(valid))}"
            )
        selected.add(mapped)
    return selected


def print_urls(include_web: bool) -> None:
    ingest_port = env_int("INGEST_PORT", 7860)
    api_port = env_int("API_PORT", 7861)
    web_port = env_int("WEB_PORT", 7862)
    chat_port = env_int("AI_CHAT_PORT", env_int("CHAT_SOCKET_PORT", 7863))
    ch_host = env_str("CLICKHOUSE_HOST", "localhost")
    ch_port = env_str("CLICKHOUSE_PORT", "8123")
    ch_db = env_str("CLICKHOUSE_DATABASE", "web_tracking")

    print("")
    print("Services started (settings from .env)")
    print(f"  Ingest:    http://localhost:{ingest_port}/v1/tracking/collect")
    print(f"  API:       http://localhost:{api_port}/docs")
    print(f"  AI Chat:   http://localhost:{chat_port}/health  (ws://localhost:{chat_port}/ws/chat)")
    print(f"  ClickHouse: {ch_host}:{ch_port}/{ch_db}")
    if uses_kafka_ingest():
        kafka_topic = env_str("KAFKA_TOPIC", "cdp.ingestion.webtracking")
        print(f"  Kafka consumer: topic {kafka_topic} (INGEST_WRITE_MODE={env_str('INGEST_WRITE_MODE', 'direct')})")
    if include_web:
        print(f"  Web:       http://localhost:{web_port}")
    print("")
    print("Stop: python run_backend.py --stop")
    print("Tip: services survive SSH logout; use --detach or systemd for a clean background start.")


def print_status() -> None:
    ingest_port = env_int("INGEST_PORT", 7860)
    api_port = env_int("API_PORT", 7861)
    web_port = env_int("WEB_PORT", 7862)
    chat_port = env_int("AI_CHAT_PORT", env_int("CHAT_SOCKET_PORT", 7863))

    print("Worktual Analytics services:")
    for name in all_service_names():
        if is_running(name):
            pid = pid_path(name).read_text(encoding="utf-8").strip()
            print(f"  {name:16} RUNNING  pid={pid}")
        else:
            print(f"  {name:16} STOPPED")

    print("")
    print("Expected ports (from .env):")
    print(f"  ingest         http://127.0.0.1:{ingest_port}/v1/tracking/collect")
    print(f"  api            http://127.0.0.1:{api_port}/docs")
    print(f"  ai-chat        http://127.0.0.1:{chat_port}/health")
    print(f"  web            http://127.0.0.1:{web_port}/")
    if uses_kafka_ingest():
        kafka_topic = env_str("KAFKA_TOPIC", "cdp.ingestion.webtracking")
        print(f"  kafka-consumer topic {kafka_topic} (INGEST_WRITE_MODE={env_str('INGEST_WRITE_MODE', 'direct')})")
    else:
        print("  kafka-consumer not required (INGEST_WRITE_MODE=direct)")
    print("")
    print("Logs: .local/logs/{service}.log")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Start or stop local Worktual Analytics services.")
    parser.add_argument(
        "--all",
        action="store_true",
        help="Start ingest, api, ai-chat, web, and kafka-consumer (when enabled).",
    )
    parser.add_argument(
        "--only",
        nargs="+",
        metavar="SERVICE",
        help="Start only listed services: ingest, kafka-consumer, api, ai-chat, web.",
    )
    parser.add_argument(
        "--status",
        action="store_true",
        help="Show service status and expected ports.",
    )
    parser.add_argument(
        "--detach",
        action="store_true",
        help="Re-run this command in the background (for systemd / SSH logout).",
    )
    parser.add_argument(
        "--stop",
        action="store_true",
        help="Stop services started by this script.",
    )
    return parser.parse_args()


def detach_runner(args: argparse.Namespace) -> int | None:
    """Fork a background runner once; return 0 if parent should exit."""
    if not args.detach or os.environ.get("RUN_BACKEND_DETACHED") == "1":
        return None
    if args.status or args.stop:
        return None

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    runner_log = LOG_DIR / "run_backend.log"
    child_argv = [sys.executable, str(Path(__file__).resolve())]
    child_argv.extend(a for a in sys.argv[1:] if a != "--detach")

    env = os.environ.copy()
    env["RUN_BACKEND_DETACHED"] = "1"

    with runner_log.open("a", encoding="utf-8") as log:
        proc = subprocess.Popen(
            child_argv,
            cwd=ROOT,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    print(f"Starting services in background (pid {proc.pid}).")
    print(f"  log: {runner_log}")
    try:
        exit_code = proc.wait(timeout=180)
        if exit_code != 0:
            print(
                f"Warning: startup runner exited with code {exit_code}. Check {runner_log}",
                file=sys.stderr,
            )
    except subprocess.TimeoutExpired:
        print(
            "Startup still running after 180s — check: python run_backend.py --status",
            file=sys.stderr,
        )
    print("  check: python run_backend.py --status")
    return 0


def main() -> int:
    args = parse_args()
    load_env()

    detached = detach_runner(args)
    if detached is not None:
        return detached

    if args.status:
        print_status()
        return 0

    if args.stop:
        stop_services(all_service_names())
        return 0

    if os.environ.get("RUN_BACKEND", "").strip().lower() not in ("0", "false"):
        os.environ["RUN_BACKEND"] = "1"

    if not args.all and not args.only:
        print("Starting backend services (ingest + api + ai-chat). Use --all for web too.")
        print("Tip: python run_backend.py --help\n")

    ensure_ai_chat_deps()

    selected = normalize_only_names(args.only) if args.only else None
    include_web = args.all or (selected is not None and "web" in selected)
    commands = build_commands(include_web=include_web, selected=selected)

    if any(name == "api" for name, _, _ in commands) and not ensure_api_node_deps():
        return 1

    ingest_port = env_int("INGEST_PORT", 7860)
    api_port = env_int("API_PORT", 7861)
    ai_chat_port = env_int("AI_CHAT_PORT", env_int("CHAT_SOCKET_PORT", 7863))
    web_port = env_int("WEB_PORT", 7862)
    service_ports: dict[str, int] = {
        "ingest": ingest_port,
        "api": api_port,
        "ai-chat": ai_chat_port,
    }
    if include_web:
        service_ports["web"] = web_port

    for name, command, cwd in commands:
        if name in service_ports:
            ensure_port_available(name, service_ports[name])
        start_service(name, command, cwd)
        if name in service_ports:
            time.sleep(1.0 if name in {"ingest", "api"} else 0.5)
            require_pid = name not in {"web", "ingest", "api"}
            if not verify_service_started(
                name,
                service_ports[name],
                timeout=25.0 if name in {"ingest", "api", "web"} else 12.0,
                require_running_pid=require_pid,
            ):
                print(
                    f"Warning: {name} is not listening on port {service_ports[name]}. "
                    f"Check .local/logs/{name}.log for errors.",
                    file=sys.stderr,
                )
        elif name == "kafka-consumer":
            time.sleep(1.0)
            if not verify_service_started(
                name,
                port=None,
                timeout=15.0,
                require_running_pid=True,
            ):
                print(
                    "Warning: kafka-consumer exited during startup. "
                    "Check .local/logs/kafka-consumer.log for errors.",
                    file=sys.stderr,
                )

    print_urls(include_web=include_web)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
