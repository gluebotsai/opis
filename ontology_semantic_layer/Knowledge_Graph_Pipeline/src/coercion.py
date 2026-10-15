"""Value coercion.  Debezium logical types and native psycopg types -> Neo4j values.

WHY THIS MODULE EXISTS
----------------------
Debezium does not emit Python types.  With ``time.precision.mode: adaptive`` a
``timestamp(6)`` column arrives as an *integer count of microseconds*.  Written
straight through, every timestamp in every tenant graph becomes a number, and
every temporal query silently misbehaves.  The same class of bug the build spec
already warned about for untyped JSON, but on the column side.

This module is driven by the Debezium **value schema**, which is why the
connector sets ``value.converter.schemas.enable=true``.  That roughly doubles
message size.  Do not turn it off: without the schema there is no way to tell a
``MicroTimestamp`` from an ordinary bigint, and coercion degrades to guesswork.

TWO ENTRY POINTS, ONE OUTPUT SHAPE
----------------------------------
``coerce_debezium_row`` (streaming) and ``coerce_native_row`` (backfill, where
psycopg has already produced ``datetime`` and ``Decimal``) decode differently
because their inputs genuinely differ.  They converge on one normalised dict,
which then goes through the *same* mapping and the *same* generated Cypher.
Sharing the decoder would be wrong; sharing everything downstream is mandatory.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
from decimal import Decimal, InvalidOperation
from typing import Any

from .errors import CoercionError

log = logging.getLogger(__name__)

# Debezium's placeholder for an unchanged TOASTed value.  Configurable via the
# connector's `unavailable.value.placeholder`; keep the two in sync.
UNAVAILABLE_PLACEHOLDER = "__debezium_unavailable_value"

INT64_MIN, INT64_MAX = -(2**63), 2**63 - 1

_EPOCH_DATE = dt.date(1970, 1, 1)
_EPOCH_DT = dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc)


# --------------------------------------------------------------------------
# schema extraction
# --------------------------------------------------------------------------

def extract_field_schemas(envelope_schema: dict | None, field: str = "after") -> dict[str, str]:
    """Map column name -> Debezium logical type name (or Connect primitive).

    Returns ``{}`` when the schema is absent, which makes the module degrade to
    pass-through rather than crash -- but ``preflight`` warns loudly in that case,
    because silent pass-through is how timestamps rot.
    """
    if not envelope_schema:
        return {}
    for f in envelope_schema.get("fields", []) or []:
        if f.get("field") != field:
            continue
        inner = f
        out: dict[str, str] = {}
        for col in inner.get("fields", []) or []:
            out[col.get("field")] = col.get("name") or col.get("type") or "unknown"
        return out
    return {}


# --------------------------------------------------------------------------
# money
# --------------------------------------------------------------------------

def decimal_to_minor_units(raw: Any, scale: int, column: str) -> int:
    """Convert a decimal value to integer minor units at a declared scale.

    Money is stored as an integer count of minor units because Neo4j has no
    decimal type -- only 64-bit float and 64-bit integer -- and float silently
    rounds.  For a platform with BFSI tenants that is unacceptable.

    Excess precision is a hard failure, never a rounding.  Rounding money so a
    write can succeed is exactly the failure mode this design exists to prevent;
    the event is quarantined and a human decides.
    """
    if raw is None:
        raise CoercionError(f"{column}: null passed to decimal conversion")
    if isinstance(raw, float):
        raise CoercionError(
            f"{column}: received a float ({raw!r}) for a decimal column. The connector "
            "must set decimal.handling.mode=string; 'double' has already lost precision "
            "by the time the value reaches us."
        )
    try:
        d = raw if isinstance(raw, Decimal) else Decimal(str(raw))
    except (InvalidOperation, ValueError) as exc:
        raise CoercionError(f"{column}: {raw!r} is not a valid decimal") from exc

    exponent = d.as_tuple().exponent
    if not isinstance(exponent, int):          # NaN / Infinity
        raise CoercionError(f"{column}: non-finite decimal {raw!r}")
    actual_scale = -exponent if exponent < 0 else 0
    if actual_scale > scale:
        raise CoercionError(
            f"{column}: value {d} has scale {actual_scale} but the mapping declares "
            f"scale {scale}. Refusing to round a monetary value -- fix the mapping "
            "or the source data."
        )

    minor = int(d.scaleb(scale).to_integral_value())
    if not (INT64_MIN <= minor <= INT64_MAX):
        raise CoercionError(
            f"{column}: {d} at scale {scale} is {minor}, outside the signed 64-bit "
            "range Neo4j integers support"
        )
    return minor


# --------------------------------------------------------------------------
# temporal
# --------------------------------------------------------------------------

def _from_epoch(value: int, divisor_to_us: float, column: str) -> dt.datetime:
    try:
        micros = int(round(int(value) * divisor_to_us))
    except (TypeError, ValueError) as exc:
        raise CoercionError(f"{column}: {value!r} is not an integer epoch offset") from exc
    return _EPOCH_DT + dt.timedelta(microseconds=micros)


_TEMPORAL_HANDLERS: dict[str, Any] = {
    # adaptive mode (recommended -- preserves microsecond precision)
    "io.debezium.time.Date":            lambda v, c: _EPOCH_DATE + dt.timedelta(days=int(v)),
    "io.debezium.time.Timestamp":       lambda v, c: _from_epoch(v, 1000, c),
    "io.debezium.time.MicroTimestamp":  lambda v, c: _from_epoch(v, 1, c),
    "io.debezium.time.NanoTimestamp":   lambda v, c: _from_epoch(v, 0.001, c),
    "io.debezium.time.Time":            lambda v, c: (dt.datetime.min + dt.timedelta(milliseconds=int(v))).time(),
    "io.debezium.time.MicroTime":       lambda v, c: (dt.datetime.min + dt.timedelta(microseconds=int(v))).time(),
    "io.debezium.time.NanoTime":        lambda v, c: (dt.datetime.min + dt.timedelta(microseconds=int(v) / 1000)).time(),
    "io.debezium.time.ZonedTimestamp":  lambda v, c: _parse_iso(v, c),
    "io.debezium.time.ZonedTime":       lambda v, c: str(v),
    # connect mode (millisecond resolution -- lossy against timestamp(6))
    "org.apache.kafka.connect.data.Date":      lambda v, c: _EPOCH_DATE + dt.timedelta(days=int(v)),
    "org.apache.kafka.connect.data.Timestamp": lambda v, c: _from_epoch(v, 1000, c),
    "org.apache.kafka.connect.data.Time":      lambda v, c: (dt.datetime.min + dt.timedelta(milliseconds=int(v))).time(),
}


def _parse_iso(value: Any, column: str) -> dt.datetime:
    s = str(value).replace("Z", "+00:00")
    try:
        return dt.datetime.fromisoformat(s)
    except ValueError as exc:
        raise CoercionError(f"{column}: {value!r} is not an ISO-8601 timestamp") from exc


# --------------------------------------------------------------------------
# single value
# --------------------------------------------------------------------------

def coerce_value(value: Any, logical: str | None, prop, column: str) -> Any:
    """Coerce one Debezium value.  ``prop`` is a PropertySpec or None."""
    if value is None:
        return None
    if value == UNAVAILABLE_PLACEHOLDER:
        # An unchanged TOASTed value.  Returning the sentinel would overwrite the
        # real stored value with the literal placeholder string.
        return _UNAVAILABLE

    declared = getattr(prop, "type", None)

    if declared == "decimal":
        return decimal_to_minor_units(value, getattr(prop, "scale"), column)

    handler = _TEMPORAL_HANDLERS.get(logical or "")
    if handler is not None:
        return handler(value, column)

    if logical in ("io.debezium.data.Json",):
        return value if isinstance(value, str) else json.dumps(value)

    if declared == "string":
        return str(value)
    if declared == "integer":
        return int(value)
    if declared == "float":
        return float(value)
    if declared == "boolean":
        return value if isinstance(value, bool) else str(value).lower() in ("t", "true", "1", "y", "yes")
    if declared in ("datetime", "date") and isinstance(value, str):
        return _parse_iso(value, column)

    if isinstance(value, dict):
        raise CoercionError(
            f"{column}: nested value is not storable as a Neo4j property "
            "(properties must be primitives or arrays of primitives)"
        )
    if isinstance(value, list):
        for item in value:
            if isinstance(item, (dict, list)):
                raise CoercionError(
                    f"{column}: nested value is not storable as a Neo4j property "
                    "(properties must be primitives or arrays of primitives)"
                )
        return value
    return value


class _Unavailable:
    __slots__ = ()

    def __repr__(self) -> str:            # pragma: no cover - debug aid
        return "<UNAVAILABLE>"


_UNAVAILABLE = _Unavailable()


def is_unavailable(v: Any) -> bool:
    return v is _UNAVAILABLE


# --------------------------------------------------------------------------
# rows
# --------------------------------------------------------------------------

def coerce_debezium_row(row: dict, field_schemas: dict[str, str], props_by_name: dict,
                        passthrough: set[str] | None = None) -> dict:
    """Coerce every column of a Debezium ``after``/``before`` image.

    Columns whose value is the TOAST placeholder are *dropped*, not written --
    dropping leaves the stored value intact, which is the correct semantics for
    "this value did not change".

    ``passthrough`` names columns left untouched -- the JSONB custom_field column,
    whose value is legitimately a map and is unpacked later by extract_custom.
    Without this exemption the generic "no nested values" rule would reject the
    blob before it could be flattened.
    """
    passthrough = passthrough or set()
    out: dict[str, Any] = {}
    for col, raw in row.items():
        if col in passthrough:
            out[col] = raw
            continue
        coerced = coerce_value(raw, field_schemas.get(col), props_by_name.get(col), col)
        if is_unavailable(coerced):
            continue
        out[col] = coerced
    return out


def coerce_native_row(row: dict, props_by_name: dict) -> dict:
    """Coerce a row read directly from PostgreSQL by psycopg (backfill path)."""
    out: dict[str, Any] = {}
    for col, raw in row.items():
        prop = props_by_name.get(col)
        if raw is None:
            out[col] = None
        elif getattr(prop, "type", None) == "decimal":
            out[col] = decimal_to_minor_units(raw, prop.scale, col)
        elif isinstance(raw, Decimal):
            out[col] = float(raw)
        elif isinstance(raw, (dict, list)):
            out[col] = raw          # JSONB blob; unpacked separately by extract_custom
        else:
            out[col] = raw
    return out


# --------------------------------------------------------------------------
# JSONB custom fields.  Spec 7.4.
# --------------------------------------------------------------------------

def extract_custom(
    row: dict,
    custom_field: str | None,
    custom_properties,
    prefix: str = "custom_",
    custom_dynamic: bool = False,
    whitelist: list[str] | None = None,
    blocklist: list[str] | None = None,
    stop_dynamic_keys: list[str] | None = None,
    blocklist_action: str = "drop_silently",
) -> dict:
    """Pull declared keys out of a JSONB blob, cast, prefix and return them.

    If custom_dynamic is true, it extracts all keys in the JSON automatically
    except those in blocklist / stop_dynamic_keys (steward-classified keys that
    must be mapped explicitly, not dumped as custom_* on the table node).

    When whitelist is set, dynamic extraction only emits whitelisted keys.
    """
    if not custom_field:
        return {}
    if not custom_properties and not custom_dynamic:
        return {}
        
    blob = row.get(custom_field) or {}
    if isinstance(blob, str):
        try:
            blob = json.loads(blob)
        except json.JSONDecodeError as exc:
            raise CoercionError(f"{custom_field}: not valid JSON: {exc}") from exc
    if not isinstance(blob, dict):
        return {f"{prefix}raw": json.dumps(blob)} if blob else {}

    out: dict[str, Any] = {}
    blocked = {str(k).lower() for k in (blocklist or [])}
    blocked |= {str(k).lower() for k in (stop_dynamic_keys or [])}
    allow = {str(k).lower() for k in (whitelist or [])} if whitelist else None

    def _drop_blocked(key: str) -> bool:
        if str(key).lower() not in blocked:
            return False
        if blocklist_action and "log" in blocklist_action:
            log.info("extract_custom: dropped blocked key %s", key)
        return True

    # Process explicitly defined properties first
    for spec in custom_properties:
        if _drop_blocked(spec.name):
            continue
        v = blob.get(spec.name)
        if v is None:
            continue                                    # never write null (spec 2.4)
        if isinstance(v, (dict, list)):
            raise CoercionError(
                f"{custom_field}.{spec.name}: nested value is not storable as a Neo4j "
                "property"
            )
        out[f"{prefix}{spec.name}"] = coerce_value(
            v, None, spec, f"{custom_field}.{spec.name}"
        )
        
    # If dynamic unpacking is requested, process all other top-level keys
    if custom_dynamic:
        defined_keys = {spec.name for spec in custom_properties}
        for k, v in blob.items():
            if k in defined_keys or v is None:
                continue
            if _drop_blocked(k):
                continue
            if allow is not None and str(k).lower() not in allow:
                continue
            if isinstance(v, (dict, list)):
                # Dump nested JSON directly as string so Neo4j can store it without crashing
                out[f"{prefix}{k}"] = json.dumps(v)
            else:
                out[f"{prefix}{k}"] = v

    return out


def strip_nulls(props: dict) -> dict:
    """Remove nulls before assignment.  Spec 2.4/7.5.

    ``SET n.x = null`` DELETES property x.  Without this, a JSON key absent from
    one event erases a value that another event legitimately set.
    """
    return {k: v for k, v in props.items() if v is not None and not is_unavailable(v)}
