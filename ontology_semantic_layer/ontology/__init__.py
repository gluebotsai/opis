"""Worktual Contact Center ontology — modular YAML, deterministic slices."""

from .slice import (
    OntologySlice,
    fetch_ontology_slice,
    list_agents,
    list_modules,
    list_presets,
)

__all__ = [
    "OntologySlice",
    "fetch_ontology_slice",
    "list_agents",
    "list_modules",
    "list_presets",
]
