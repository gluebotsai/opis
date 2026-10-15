"""Row scope — delegates to semantic.scope (single source of truth)."""

from __future__ import annotations

from semantic.scope import UserScope, lookup_user_scope, scope_summary

__all__ = ["UserScope", "lookup_user_scope", "scope_summary"]
