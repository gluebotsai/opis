"""Load a proposal agent file without importing app.agents.__init__."""

from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path


def load_agent_module(filename: str):
    root = Path(__file__).resolve().parents[1]
    if "app" not in sys.modules:
        app = types.ModuleType("app")
        app.__path__ = [str(root / "app")]
        sys.modules["app"] = app
    if "app.agents" not in sys.modules:
        agents = types.ModuleType("app.agents")
        agents.__path__ = [str(root / "app" / "agents")]
        sys.modules["app.agents"] = agents
    if "app.llm" not in sys.modules:
        llm = types.ModuleType("app.llm")

        async def generate_proposal_ai_text(**_kwargs):
            return ""

        llm.generate_proposal_ai_text = generate_proposal_ai_text
        llm.is_ai_configured = lambda: False
        llm.proposal_llm_configured = lambda: False
        sys.modules["app.llm"] = llm
    if "app.agents.llm_result" not in sys.modules:
        path = root / "app" / "agents" / "llm_result.py"
        spec = importlib.util.spec_from_file_location("app.agents.llm_result", path)
        mod = importlib.util.module_from_spec(spec)
        sys.modules["app.agents.llm_result"] = mod
        assert spec.loader
        spec.loader.exec_module(mod)
    path = root / "app" / "agents" / filename
    name = f"isolated_{filename.replace('.', '_')}"
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    assert spec.loader
    spec.loader.exec_module(mod)
    return mod
