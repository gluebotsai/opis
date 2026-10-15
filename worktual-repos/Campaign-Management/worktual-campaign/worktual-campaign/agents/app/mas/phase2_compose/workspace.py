"""Per-run workspace — discarded after one domain invoke. Not chat memory."""

from __future__ import annotations

from typing import Any


def _http_url(value: Any) -> str:
    url = str(value or "").strip()
    if url.lower().startswith(("http://", "https://")):
        return url
    return ""


def _ready_urls_from_ctx(ctx: dict[str, Any]) -> list[str]:
    task = dict(ctx.get("task_spec") or {}) if isinstance(ctx, dict) else {}
    camp = task.get("campaign") if isinstance(task.get("campaign"), dict) else {}
    if not camp and isinstance(ctx.get("campaign"), dict):
        camp = ctx["campaign"]
    out: list[str] = []
    seen: set[str] = set()

    def _add(url: str) -> None:
        raw = _http_url(url)
        if not raw or raw.lower() in seen:
            return
        seen.add(raw.lower())
        out.append(raw)

    for source in (task, ctx, camp):
        if not isinstance(source, dict):
            continue
        _add(str(source.get("ready_image_url") or ""))
        rows = source.get("ready_image_urls")
        if isinstance(rows, list):
            for item in rows:
                _add(str(item or ""))
        assets = source.get("image_assets")
        if isinstance(assets, list):
            for row in assets:
                if isinstance(row, dict):
                    _add(str(row.get("url") or ""))
    return out


class Workspace:
    def __init__(self) -> None:
        self.query: str = ""
        self.chat_summary: str = ""
        self.knowledge: dict[str, Any] = {}
        self.brand_guidelines: dict[str, Any] = {}
        self.plan: dict[str, Any] = {}
        self.image_assets: list[dict[str, Any]] = []
        self.compiled_html: str = ""
        self.warnings: list[str] = []
        self.needs_resolved: set[str] = set()
        self.trace: list[dict[str, Any]] = []
        self.fields: dict[str, Any] = {}
        self.prior_extract: dict[str, Any] = {}
        self.prior_compiled_html: str = ""
        self.content_mode: str = ""
        self.image_mode: str = ""
        self.destination_url: str = ""
        self.wants_images: bool = False
        self.ready_image_urls: list[str] = []

    @classmethod
    def from_ctx(cls, ctx: dict[str, Any]) -> Workspace:
        task = dict(ctx.get("task_spec") or {})
        ws = cls()
        ws.query = str(task.get("query") or ctx.get("query") or "").strip()
        ws.chat_summary = str(task.get("chat_summary") or "").strip()
        prior = task.get("prior_extract")
        if isinstance(prior, dict):
            ws.prior_extract = dict(prior)
        ws.prior_compiled_html = str(task.get("prior_compiled_html") or "").strip()
        ws.content_mode = str(task.get("content_mode") or "").strip().lower()
        ws.image_mode = str(task.get("image_mode") or "").strip().lower()
        ws.destination_url = str(task.get("destination_url") or "").strip()
        ws.ready_image_urls = _ready_urls_from_ctx(ctx)
        wants = task.get("wants_images")
        if wants is None:
            wants = ctx.get("wants_images")
        if wants is None:
            ws.wants_images = bool(ws.ready_image_urls) or ws.image_mode in {
                "plan_new",
                "generate",
            }
        else:
            ws.wants_images = bool(wants) or bool(ws.ready_image_urls)
        if ws.image_mode in {"none", "off", "no"}:
            ws.wants_images = bool(ws.ready_image_urls)
        return ws

    def append_warning(self, msg: str) -> None:
        text = str(msg or "").strip()
        if text and text not in self.warnings:
            self.warnings.append(text)

    def add_warnings(self, items: list[str] | None) -> None:
        for w in items or []:
            self.append_warning(str(w))

    def merge_payload(self, payload: dict[str, Any] | None) -> None:
        data = payload or {}
        if "knowledge" in data and isinstance(data["knowledge"], dict):
            self.knowledge = {**self.knowledge, **data["knowledge"]}
        if "brand_guidelines" in data and isinstance(data["brand_guidelines"], dict):
            self.brand_guidelines = {
                **self.brand_guidelines,
                **data["brand_guidelines"],
            }
        if "plan" in data and isinstance(data["plan"], dict):
            self.plan = data["plan"]
        if "image_assets" in data and isinstance(data["image_assets"], list):
            self.image_assets = list(data["image_assets"])
        if "compiled_html" in data:
            self.compiled_html = str(data["compiled_html"] or "")
        if "fields" in data and isinstance(data["fields"], dict):
            self.fields = data["fields"]

    def record(self, executor_id: str, status: str, **extra: Any) -> None:
        row: dict[str, Any] = {"executor_id": executor_id, "status": status}
        row.update(extra)
        self.trace.append(row)

    def to_fields(self) -> dict[str, Any]:
        fields = dict(self.fields) if self.fields else {}
        fields.setdefault("subject", (self.plan or {}).get("subject") or "")
        fields.setdefault("preheader", (self.plan or {}).get("preheader") or "")
        if self.compiled_html:
            fields["compiled_html"] = self.compiled_html
        fields["plan"] = dict(self.plan)
        fields["image_assets"] = list(self.image_assets)
        fields["knowledge"] = dict(self.knowledge)
        fields["brand_guidelines"] = dict(self.brand_guidelines)
        fields["warnings"] = list(self.warnings)
        fields["trace"] = list(self.trace)
        fields["pipeline"] = "compose"
        return fields
