#!/usr/bin/env python3
"""Bundle WorktualAnalytics SDK into IIFE without Node.js."""

import re
from pathlib import Path

SDK_SRC = Path(__file__).resolve().parent.parent / "sdk" / "src"
DIST = Path(__file__).resolve().parent.parent / "sdk" / "dist"

# Load order respecting dependencies
FILES = [
    "utils/id.js",
    "utils/storage.js",
    "utils/url.js",
    "utils/sha256-hmac.js",
    "utils/web-tracking-link.js",
    "utils/attribution.js",
    "utils/device.js",
    "utils/client-ip.js",
    "core/constants.js",
    "core/config.js",
    "core/state.js",
    "core/logger.js",
    "core/event-bus.js",
    "profiles/store.js",
    "profiles/browser.js",
    "profiles/campaign.js",
    "profiles/page.js",
    "profiles/journey.js",
    "profiles/session.js",
    "profiles/visitor.js",
    "profiles/location.js",
    "profiles/index.js",
    "identity/shared-visitor-id.js",
    "identity/index.js",
    "core/compress.js",
    "core/payload.js",
    "core/event-names.js",
    "core/context.js",
    "privacy/consent.js",
    "transport/offline-queue.js",
    "transport/sender.js",
    "plugins/index.js",
    "tracking/tracker.js",
    "tracking/element-info.js",
    "tracking/auto.js",
    "tracking/heatmap.js",
    "tracking/heartbeat.js",
    "tracking/form-events.js",
    "tracking/forms.js",
    "tracking/form-fields.js",
    "tracking/form-discovery.js",
    "tracking/lead-forms.js",
    "replay/encode.js",
    "replay/chunk-sender.js",
    "replay/recorder.js",
    "performance/index.js",
    "errors/index.js",
    "ecommerce/index.js",
    "index.js",
]

IMPORT_RE = re.compile(
    r"^import\s+(?:\{[\s\S]*?\}|[^;\n]+)\s+from\s+['\"][^'\"]+['\"];?\s*",
    re.MULTILINE,
)
EXPORT_DEFAULT_RE = re.compile(r"^export\s+default\s+api;?\s*$", re.MULTILINE)
EXPORT_NAMED_RE = re.compile(r"^export\s+\{([^}]+)\};?\s*$", re.MULTILINE)
EXPORT_FN_RE = re.compile(r"^export\s+(async\s+)?function\s+", re.MULTILINE)
EXPORT_CONST_RE = re.compile(r"^export\s+(const|let|function)\s+", re.MULTILINE)
EXPORT_STAR_RE = re.compile(r"^export\s+\*\s+.*$", re.MULTILINE)

# Modules wrapped as namespace objects (import * as X)
NAMESPACE_MODULES = {
    "identity/index.js": "identity",
    "transport/offline-queue.js": "offlineQueue",
    "tracking/auto.js": "auto",
    "tracking/heatmap.js": "heatmap",
    "tracking/heartbeat.js": "heartbeat",
    "tracking/forms.js": "forms",
    "tracking/lead-forms.js": "leadForms",
    "performance/index.js": "performanceTracking",
    "errors/index.js": "errors",
    "ecommerce/index.js": "ecommerce",
}

# Rewrite bare calls after named imports from wrapped modules are stripped
IMPORT_REWRITES = {
    "tracking/auto.js": {"touchSession": "identity.touchSession"},
}


def extract_exports(code: str) -> list[str]:
    names: list[str] = []
    for m in re.finditer(r"^export\s+(?:async\s+)?function\s+(\w+)", code, re.MULTILINE):
        names.append(m.group(1))
    for m in re.finditer(r"^export\s+(?:const|let|function)\s+(\w+)", code, re.MULTILINE):
        names.append(m.group(1))
    for m in EXPORT_NAMED_RE.finditer(code):
        for part in m.group(1).split(","):
            part = part.strip()
            if not part:
                continue
            if " as " in part:
                names.append(part.split(" as ", 1)[1].strip())
            else:
                names.append(part.split(":")[0].strip())
    # Preserve order, drop duplicates
    seen: set[str] = set()
    ordered: list[str] = []
    for name in names:
        if name not in seen:
            seen.add(name)
            ordered.append(name)
    return ordered


def strip_module_syntax(code: str, is_index: bool = False) -> str:
    code = IMPORT_RE.sub("", code)
    code = EXPORT_STAR_RE.sub("", code)
    code = EXPORT_DEFAULT_RE.sub("", code)
    code = EXPORT_NAMED_RE.sub(lambda m: m.group(1).strip(), code)
    code = EXPORT_FN_RE.sub(r"\1function ", code)
    code = EXPORT_CONST_RE.sub(r"\1 ", code)
    if is_index:
        code = re.sub(
            r"if\s*\(\s*typeof\s+window\s*!==\s*['\"]undefined['\"]\s*\)\s*\{[\s\S]*?\}\s*",
            "",
            code,
        )
        code = code.replace("performance.", "performanceTracking.")
    return code


def apply_import_rewrites(code: str, rewrites: dict[str, str]) -> str:
    for local, qualified in rewrites.items():
        code = re.sub(rf"\b{re.escape(local)}\s*\(", f"{qualified}(", code)
    return code


def wrap_namespace(namespace: str, code: str, exports: list[str]) -> str:
    export_list = ", ".join(exports)
    return f"var {namespace} = (function() {{\n{code}\nreturn {{ {export_list} }};\n}})();\n"


def process_file(rel: str, code: str) -> str:
    stripped = strip_module_syntax(code, is_index=(rel == "index.js"))
    stripped = apply_import_rewrites(stripped, IMPORT_REWRITES.get(rel, {}))

    namespace = NAMESPACE_MODULES.get(rel)
    if namespace:
        exports = extract_exports(code)
        return wrap_namespace(namespace, stripped, exports)

    return stripped


def basic_minify(code: str) -> str:
    # Strip block comments only — do NOT strip // lines (breaks regex like /Edg\//)
    code = re.sub(r"/\*![\s\S]*?\*/", "", code)
    code = re.sub(r"/\*[\s\S]*?\*/", "", code)
    code = re.sub(r"\n\s+", "\n", code)
    return code


def check_duplicate_consts(bundle: str) -> None:
    names = re.findall(r"^let (\w+) =", bundle, re.MULTILINE)
    names += re.findall(r"^const (\w+) =", bundle, re.MULTILINE)
    seen: set[str] = set()
    duplicates: list[str] = []
    for name in names:
        if name in seen and name not in duplicates:
            duplicates.append(name)
        seen.add(name)
    if duplicates:
        raise SystemExit(f"SDK bundle has duplicate top-level declarations: {', '.join(duplicates)}")


def _copy_dist_outputs(dist_dir: Path) -> None:
    import shutil

    repo_root = dist_dir.parent.parent
    web_public = repo_root / "web" / "public"
    demo_sdk = repo_root / "demo" / "sdk"
    live_root = repo_root / "live_web_tracking_folder_2"
    demo_sdk.mkdir(parents=True, exist_ok=True)

    targets: list[Path] = [demo_sdk]
    if web_public.is_dir():
        targets.append(web_public)
    if live_root.is_dir():
        targets.extend([
            live_root / "sdk" / "dist",
            live_root / "web" / "public",
            live_root / "demo" / "sdk",
        ])

    for name in ("webtracking.js", "webtracking.min.js", "webtracking.esm.js"):
        src = dist_dir / name
        if not src.exists():
            continue
        for target_dir in targets:
            target_dir.mkdir(parents=True, exist_ok=True)
            dest = target_dir / name
            shutil.copy2(src, dest)
            print(f"Copied → {dest}")


def build():
    import subprocess
    import sys

    vendor_script = Path(__file__).resolve().parent / "vendor_rrweb.py"
    if vendor_script.is_file():
        subprocess.run([sys.executable, str(vendor_script)], check=False)

    rollup_bin = SDK_SRC.parent / "node_modules" / "rollup" / "dist" / "bin" / "rollup"
    if rollup_bin.exists():
        import subprocess
        import shutil
        try:
            if shutil.which("npm"):
                subprocess.run(["npm", "run", "build"], cwd=SDK_SRC.parent, check=True)
            else:
                subprocess.run(["node", str(rollup_bin), "-c"], cwd=SDK_SRC.parent, check=True)
            _copy_dist_outputs(DIST)
            print(f"Built via rollup → {DIST / 'webtracking.js'}")
            return
        except (subprocess.CalledProcessError, FileNotFoundError) as exc:
            print(f"Rollup build skipped ({exc}); using python bundler")

    DIST.mkdir(parents=True, exist_ok=True)
    parts = ["/*! WorktualAnalytics v3.0.1 | (c) Worktual */"]
    parts.append("(function(window, document) {\n'use strict';\n")

    for rel in FILES:
        path = SDK_SRC / rel
        code = path.read_text(encoding="utf-8")
        parts.append(f"\n// --- {rel} ---\n")
        parts.append(process_file(rel, code))
        if rel == "transport/sender.js":
            parts.append(
                "\nvar transport = { queueEvent, flush: flushQueue, startBatchTimer, "
                "destroyTransport, sendPayload, offlineQueue };\n"
            )

    parts.append("\nwindow.WorktualAnalytics = api;\n})(window, document);\n")

    bundle = "".join(parts)
    check_duplicate_consts(bundle)
    (DIST / "webtracking.js").write_text(bundle, encoding="utf-8")
    (DIST / "webtracking.min.js").write_text(basic_minify(bundle), encoding="utf-8")
    (DIST / "webtracking.esm.js").write_text(
        "export default window.WorktualAnalytics;\n", encoding="utf-8"
    )
    print(f"Built {DIST / 'webtracking.js'} ({len(bundle)} bytes)")
    print(f"Built {DIST / 'webtracking.min.js'} ({len(basic_minify(bundle))} bytes)")

    web_public = SDK_SRC.parent.parent / "web" / "public"
    if web_public.is_dir():
        _copy_dist_outputs(DIST)


if __name__ == "__main__":
    build()
