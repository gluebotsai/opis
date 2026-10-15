"""Understander — industry + value shape + taxonomy route."""

from __future__ import annotations

import re
from typing import Any, Callable

from ontology_steward.models import FieldSignal, StewardContext, Understanding
from ontology_steward.tools.registry_io import entity_for_table, load_entities_definitions, route_for_industry

_MEASUREMENT_KEYS = re.compile(
    r"blood_pressure|bp|glucose|sugar|systolic|diastolic|heart_rate|spo2|weight|bmi|vitals",
    re.I,
)
_CONDITION_KEYS = re.compile(
    r"diagnosis|condition|disease|diabetes|hypertension|icd|snomed|cancer",
    re.I,
)
_VEHICLE_KEYS = re.compile(r"vin|vehicle|chassis|make|model|registration|license_plate", re.I)
_SKU_KEYS = re.compile(r"sku|gtin|upc|ean|product_name|title", re.I)
_CATEGORY_KEYS = re.compile(r"category|subcategory|product_type|department", re.I)
_PHI_KEYS = re.compile(r"hiv_status|genetic|mental_health|substance_use", re.I)
_ENUM_BLOOD = re.compile(r"blood_group|abo|rhesus", re.I)


class Understander:
    def __init__(self, conn_factory: Callable | None = None):
        self.conn_factory = conn_factory

    def understand(self, ctx: StewardContext, signal: FieldSignal) -> Understanding:
        industry = ctx.industry
        if not industry and self.conn_factory:
            from ontology_steward.tools.pg_samples import fetch_org_industry

            industry = fetch_org_industry(self.conn_factory, ctx.org)
        ctx.industry = industry

        route_name, route_spec = route_for_industry(industry)
        shape = self._shape(signal)
        table_entity = entity_for_table(signal.table)
        if table_entity and not table_entity.get("in_graph", True):
            shape = f"{shape}:not_in_graph"
        ctx.log(
            "understander",
            "classified",
            field=signal.field,
            shape=shape,
            route=route_name,
            entity=table_entity.get("graph_label") if table_entity else None,
        )

        return Understanding(
            industry=industry,
            industry_pack=route_name,
            value_shape=shape,
            taxonomy_route=route_name,
            notes=route_spec.get("primary", ""),
        )

    def _shape(self, signal: FieldSignal) -> str:
        f = signal.field
        samples = signal.sample_values

        if _PHI_KEYS.search(f):
            return "phi"
        if f.startswith("tmp_") or "debug" in f.lower():
            return "junk"
        if _CONDITION_KEYS.search(f):
            return "coded_condition"
        if _MEASUREMENT_KEYS.search(f):
            return "measurement"
        if _ENUM_BLOOD.search(f):
            return "enum"
        if _VEHICLE_KEYS.search(f):
            if "vin" in f.lower() or "chassis" in f.lower():
                return "identity"
            return "vehicle_asset"
        if signal.table.startswith("inventory.") or _SKU_KEYS.search(f):
            return "sku"
        if _CATEGORY_KEYS.search(f):
            return "category_path"

        if samples:
            if all(isinstance(v, (int, float)) or (isinstance(v, str) and re.match(r"^\d+", v)) for v in samples):
                return "measurement"
            if all(isinstance(v, str) and len(v) < 8 for v in samples):
                return "enum"

        return "unknown"
