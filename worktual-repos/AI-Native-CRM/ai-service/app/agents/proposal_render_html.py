"""Render generated proposal content JSON with frozen theme CSS."""

from __future__ import annotations

import html as html_lib
from typing import Any

from app.agents.proposal_layout import skeleton_cover_from_gold
from app.agents.proposal_pdf_parse import compile_theme_css, default_theme_tokens, usable_running_chrome


def _esc(value: Any) -> str:
    return html_lib.escape(str(value or ""), quote=True)


def render_table(table: dict[str, Any]) -> str:
    headers = [str(h) for h in (table.get("headers") or [])]
    rows = table.get("rows") or []
    emphasize = " emphasize" if table.get("emphasize_last_col") else ""
    tid = str(table.get("id") or "")
    slot = f' data-slot-table="{_esc(tid)}"' if tid else ""
    head = "".join(f"<th>{_esc(h)}</th>" for h in headers)
    body_rows: list[str] = []
    for row in rows:
        if not isinstance(row, list):
            continue
        cells = "".join(f"<td>{_esc(c)}</td>" for c in row)
        body_rows.append(f"<tr>{cells}</tr>")
    tbody = "".join(body_rows) or "<tr></tr>"
    return (
        f'<table class="bp-table{emphasize}"{slot}>'
        f"<thead><tr>{head}</tr></thead><tbody>{tbody}</tbody></table>"
    )


def render_block(
    block: dict[str, Any],
    tables: dict[str, dict[str, Any]],
    used: set[str],
) -> str:
    kind = block.get("kind") or "prose"
    if kind == "bullets":
        items = block.get("items") or []
        if not items and block.get("text"):
            items = [block["text"]]
        lis = "".join(f"<li>{_esc(i)}</li>" for i in items)
        return f'<ul class="bullets">{lis}</ul>'
    if kind == "table":
        tid = str(block.get("table_id") or "")
        table = tables.get(tid)
        if table:
            used.add(tid)
            return render_table(table)
        return ""
    if kind == "note":
        return f'<div class="note"><p class="prose">{_esc(block.get("text") or "")}</p></div>'
    text = str(block.get("text") or "")
    if not text:
        return ""
    paras = [p.strip() for p in text.split("\n\n") if p.strip()]
    return "".join(f'<p class="prose">{_esc(p)}</p>' for p in paras)


def render_proposal_html(
    proposal: dict[str, Any],
    *,
    theme_css: str = "",
    tokens: dict[str, Any] | None = None,
    logo_data_url: str = "",
    include_style_tag: bool = True,
    skeleton_slots: bool = False,
) -> str:
    tokens = tokens or default_theme_tokens()
    css = compile_theme_css(tokens, has_logo=bool(logo_data_url)) or theme_css
    cover = proposal.get("cover") or {}
    sections = proposal.get("sections") or []
    tables = {
        str(t.get("id")): t
        for t in (proposal.get("tables") or [])
        if isinstance(t, dict) and t.get("id")
    }
    used: set[str] = set()
    parts: list[str] = []
    if include_style_tag:
        parts.append(f"<style>\n{css}\n</style>")
    parts.append('<article class="proposal-doc">')
    header_text = str(tokens.get("header_text") or "")
    if usable_running_chrome(header_text):
        parts.append(f'<div class="chrome-header">{_esc(header_text)}</div>')
    cover_bits: list[str] = []
    if logo_data_url:
        cover_bits.append(
            f'<img class="cover-logo" src="{_esc(logo_data_url)}" alt="logo" />'
        )
    if cover.get("brand"):
        cover_bits.append(f'<p class="cover-brand">{_esc(cover["brand"])}</p>')
    title = cover.get("title") or cover.get("subtitle") or "Commercial Proposal"
    cover_bits.append(f'<h1 class="cover-title bp-cover-title">{_esc(title)}</h1>')
    prepared = str(cover.get("prepared_for") or "").strip()
    if prepared:
        has_label = bool((tokens.get("layout") or {}).get("prepared_has_label"))
        if prepared.lower().startswith("prepared"):
            label = prepared
        elif has_label:
            label = f"Prepared for {prepared}"
        else:
            label = prepared
        cover_bits.append(f'<p class="cover-prepared">{_esc(label)}</p>')
    if cover.get("date"):
        cover_bits.append(f'<p class="cover-date">{_esc(cover["date"])}</p>')
    if (tokens.get("layout") or {}).get("cover_rule"):
        cover_bits.append('<hr class="cover-rule" />')
    tags = [str(t).strip() for t in (cover.get("product_tags") or []) if str(t).strip()]
    layout_cls = (
        cover.get("tag_layout")
        or (tokens.get("layout") or {}).get("tags_layout")
        or "centered_wrap"
    )
    if tags:
        lis = "".join(f"<li>{_esc(t)}</li>" for t in tags)
        cover_bits.append(
            f'<ul class="product-tags layout-{_esc(layout_cls)}">{lis}</ul>'
        )
    elif skeleton_slots and cover.get("has_tag_slot"):
        cover_bits.append(
            f'<ul class="product-tags layout-{_esc(layout_cls)}" data-slot-tags></ul>'
        )
    meta_rows = cover.get("meta_rows") or []
    if meta_rows:
        rows_html = []
        for row in meta_rows:
            if not isinstance(row, dict):
                continue
            rows_html.append(
                f"<tr><td>{_esc(row.get('label'))}</td>"
                f"<td>{_esc(row.get('value'))}</td></tr>"
            )
        cover_bits.append(
            f'<table class="cover-meta"><tbody>{"".join(rows_html)}</tbody></table>'
        )
    if cover_bits:
        align = str(
            cover.get("cover_align")
            or (tokens.get("layout") or {}).get("cover_align")
            or cover.get("brand_align")
            or "center"
        ).strip().lower()
        if align not in {"left", "center", "right"}:
            align = "center"
        parts.append(
            f'<div class="cover-block bp-playbook-cover cover-align-{_esc(align)}">'
        )
        parts.extend(cover_bits)
        parts.append("</div>")

    for si, sec in enumerate(sections):
        if not isinstance(sec, dict):
            continue
        key = str(sec.get("id") or sec.get("key") or f"section_{si + 1}")
        parts.append(f'<section class="sec" data-sec="{si}" data-slot="{_esc(key)}">')
        heading = sec.get("heading") or sec.get("title") or ""
        heading_html = f'<h1 class="sec-h bp-h2">{_esc(heading)}</h1>' if heading else ""
        blocks = sec.get("blocks") or []
        if skeleton_slots and not blocks:
            if heading_html:
                parts.append(heading_html)
            parts.append('<div class="bp-slot-body bp-body" data-slot-body></div>')
            parts.append("</section>")
            continue
        block_htmls: list[tuple[str, str]] = []
        for block in blocks:
            if not isinstance(block, dict):
                continue
            rendered = render_block(block, tables, used)
            if rendered:
                block_htmls.append((str(block.get("kind") or "prose"), rendered))
        if heading_html and block_htmls:
            first_kind, first_html = block_htmls[0]
            first_blk = f'<div class="blk" data-kind="{_esc(first_kind)}">{first_html}</div>'
            if first_html.startswith("<ul") or "<table" in first_html:
                parts.append(heading_html)
                parts.append(first_blk)
            else:
                parts.append(f'<div class="keep-start">{heading_html}{first_blk}</div>')
            for kind, html in block_htmls[1:]:
                parts.append(f'<div class="blk" data-kind="{_esc(kind)}">{html}</div>')
        elif heading_html:
            parts.append(heading_html)
        else:
            for kind, html in block_htmls:
                parts.append(f'<div class="blk" data-kind="{_esc(kind)}">{html}</div>')
        parts.append("</section>")

    for table in proposal.get("tables") or []:
        if not isinstance(table, dict):
            continue
        tid = str(table.get("id") or "")
        if tid and tid in used:
            continue
        if table.get("title"):
            parts.append(f'<h2 class="sec-h2">{_esc(table["title"])}</h2>')
        parts.append(render_table(table))

    assumptions = proposal.get("assumptions") or []
    if assumptions:
        lis = "".join(f"<li>{_esc(a)}</li>" for a in assumptions)
        parts.append(
            '<section class="sec" data-slot="assumptions">'
            '<h1 class="sec-h bp-h2">Assumptions</h1>'
            f'<ul class="bullets">{lis}</ul></section>'
        )
    footer_text = str(tokens.get("footer_text") or "")
    if usable_running_chrome(footer_text):
        parts.append(f'<div class="chrome-footer"><span>{_esc(footer_text)}</span></div>')
    parts.append("</article>")
    return "\n".join(parts)


def render_skeleton_html(
    template: dict[str, Any],
    *,
    theme_css: str,
    tokens: dict[str, Any] | None = None,
    logo_data_url: str = "",
    gold_cover: dict[str, Any] | None = None,
) -> str:
    """Empty playbook skeleton with data-slot / data-slot-table for Fastify gates."""
    tokens = tokens or default_theme_tokens()
    cover = skeleton_cover_from_gold(gold_cover, template)
    sections = []
    tables = []
    for sec in template.get("sections") or []:
        if not isinstance(sec, dict):
            continue
        key = str(sec.get("key") or sec.get("id") or "")
        table_id = str(sec.get("table_id") or "")
        blocks = []
        if table_id or (isinstance(sec.get("tableSpec"), dict) and sec.get("tableSpec", {}).get("columns")):
            slot_table = key
            blocks.append({"kind": "table", "table_id": slot_table})
            headers = []
            for ttype in template.get("table_types") or []:
                if isinstance(ttype, dict) and str(ttype.get("id") or "") in {table_id, key}:
                    headers = list(ttype.get("headers") or [])
                    break
            spec = sec.get("tableSpec") if isinstance(sec.get("tableSpec"), dict) else {}
            if not headers and spec.get("columns"):
                headers = [str(c) for c in spec["columns"]]
            tables.append({"id": slot_table, "headers": headers, "rows": []})
        sections.append(
            {
                "id": key,
                "heading": "",
                "kind": sec.get("kind") or "prose",
                "blocks": blocks,
            }
        )
    html = render_proposal_html(
        {"cover": cover, "sections": sections, "tables": tables, "assumptions": []},
        theme_css=theme_css,
        tokens=tokens,
        logo_data_url=logo_data_url,
        include_style_tag=False,
        skeleton_slots=True,
    )
    return html
