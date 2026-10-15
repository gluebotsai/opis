from __future__ import annotations

import ast
from pathlib import Path


AI_SERVICE_ROOT = Path(__file__).parents[1]
PRODUCTION_ROOT = AI_SERVICE_ROOT / "app"
FORBIDDEN_MODULES = ("langgraph", "langchain")
FORBIDDEN_DEPENDENCIES = {"langgraph", "langchain", "langchain-core"}


def test_production_has_no_langgraph_or_langchain_imports():
    violations: list[str] = []
    for path in sorted(PRODUCTION_ROOT.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            modules: list[str] = []
            if isinstance(node, ast.Import):
                modules = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                modules = [node.module]
            for module in modules:
                if module.startswith(FORBIDDEN_MODULES):
                    violations.append(
                        f"{path.relative_to(AI_SERVICE_ROOT)}:{node.lineno}: {module}"
                    )
    assert violations == []


def test_requirements_have_no_langgraph_or_langchain_dependencies():
    dependencies = {
        line.split(";", 1)[0]
        .split("[", 1)[0]
        .split("=", 1)[0]
        .split("<", 1)[0]
        .split(">", 1)[0]
        .strip()
        .lower()
        for line in (AI_SERVICE_ROOT / "requirements.txt").read_text().splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }
    assert dependencies.isdisjoint(FORBIDDEN_DEPENDENCIES)
