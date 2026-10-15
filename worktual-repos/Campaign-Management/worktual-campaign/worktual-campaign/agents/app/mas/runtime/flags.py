"""MAS feature flags — empty MAS_ENABLED_DOMAINS keeps legacy paths."""

from __future__ import annotations

from app.config import get_settings
from app.mas.catalog import DOMAIN_IDS, MODULE_TO_DOMAIN, normalize_domain


def parse_enabled_domains(raw: str | None = None) -> frozenset[str]:
    if raw is None:
        raw = get_settings().mas_enabled_domains
    parts = [p.strip().lower().replace("-", "_") for p in str(raw or "").split(",")]
    out: set[str] = set()
    for p in parts:
        if not p:
            continue
        if p in ("*", "all"):
            return frozenset(DOMAIN_IDS)
        d = normalize_domain(p) or MODULE_TO_DOMAIN.get(p)
        if d:
            out.add(d)
    return frozenset(out)


def is_domain_enabled(domain_id: str | None) -> bool:
    did = normalize_domain(domain_id)
    if not did:
        return False
    return did in parse_enabled_domains()


def is_module_mas_enabled(module: str | None) -> bool:
    """True when the Socket module should enter MAS instead of legacy run_*_turn."""
    from app.mas.catalog import MODULE_TO_DOMAIN

    mod = str(module or "").strip().lower()
    # Audience/contacts is always full MAS (Super → Domain → Executor).
    if mod == "contacts":
        return True
    domain = MODULE_TO_DOMAIN.get(mod)
    return is_domain_enabled(domain) if domain else False


def is_audience_native_enabled() -> bool:
    """Audience executors always use bounded native CRM loops."""
    return True


def is_create_campaign_native_enabled() -> bool:
    """Create-campaign executors always use bounded native loops."""
    return True


def is_optimization_native_enabled() -> bool:
    """Optimization executors use bounded native loops (config default: on)."""
    from app.config import get_settings

    return bool(get_settings().mas_optimization_native)


def is_content_native_enabled() -> bool:
    """Content executors use bounded native loops (config default: on)."""
    from app.config import get_settings

    return bool(get_settings().mas_content_native)


def is_forms_native_enabled() -> bool:
    """Forms executors use bounded native loops (config default: on)."""
    from app.config import get_settings

    return bool(get_settings().mas_forms_native)


def is_image_native_enabled() -> bool:
    """Image executors use bounded native loops (config default: on)."""
    from app.config import get_settings

    return bool(get_settings().mas_image_native)
