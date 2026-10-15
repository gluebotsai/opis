"""In-process PDF → positioned pageHtml (pdf-text spans) for page-clone templates."""

from __future__ import annotations

import base64
import logging
from typing import Any

logger = logging.getLogger(__name__)

MAX_PAGES = 20
MAX_IMAGE_B64 = 1_500_000


def _shrink_image(data: bytes, ext: str, max_b64: int = 950_000) -> tuple[bytes, str]:
    enc = base64.b64encode(data).decode("ascii")
    if len(enc) <= max_b64:
        return data, ext
    try:
        import fitz

        ft = ext if ext in ("png", "jpeg", "jpg", "gif", "bmp", "tif", "tiff") else "png"
        img = fitz.open(stream=data, filetype=ft)
        pix = fitz.Pixmap(img, 0)
        img.close()
        if pix.n >= 4:
            pix = fitz.Pixmap(fitz.csRGB, pix)
        base = pix
        for scale in (0.85, 0.7, 0.55, 0.4, 0.3):
            mat = fitz.Matrix(scale, scale)
            spix = fitz.Pixmap(base, mat) if scale < 1.0 else base
            for q in (85, 75, 65, 55, 45):
                jpg = spix.tobytes("jpeg", jpg_quality=q)
                if len(base64.b64encode(jpg)) <= max_b64:
                    return jpg, "jpeg"
        jpg = spix.tobytes("jpeg", jpg_quality=40)
        return jpg, "jpeg"
    except Exception:
        return data, ext


def _rgb_int_to_hex(color_int: int | None) -> str:
    if color_int is None:
        return "#000000"
    r = (color_int >> 16) & 255
    g = (color_int >> 8) & 255
    b = color_int & 255
    return f"#{r:02x}{g:02x}{b:02x}"


def _color_tuple_to_int(rgb_tuple: tuple[float, ...] | None) -> int | None:
    if not rgb_tuple:
        return None
    r, g, b = [max(0, min(255, int(round(c * 255)))) for c in rgb_tuple]
    return (r << 16) + (g << 8) + b


def _esc(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _pct(value: float, denom: float) -> float:
    if not denom:
        return 0.0
    return round(max(0.0, value) / denom * 100, 4)


def _render_page(page: Any, pw: float, ph: float, img_id_prefix: str) -> tuple[str, list[dict[str, Any]], bool]:
    images: list[dict[str, Any]] = []
    needs_fallback = False
    html_parts: list[str] = []

    try:
        drawings = page.get_drawings()
    except Exception:
        drawings = []

    for d in drawings:
        stroke_color = d.get("color")
        fill_color = d.get("fill")
        width = d.get("width") or 1.0
        for item in d.get("items", []):
            op = item[0]
            if op == "re":
                rect = item[1]
                left = _pct(rect.x0, pw)
                top = _pct(rect.y0, ph)
                w = _pct(rect.width, pw)
                h = _pct(rect.height, ph)
                border = _rgb_int_to_hex(_color_tuple_to_int(stroke_color)) if stroke_color else "#000000"
                style = f"left:{left}%;top:{top}%;width:{w}%;height:{h}%;border:{width}px solid {border};"
                if fill_color:
                    style += f"background-color:{_rgb_int_to_hex(_color_tuple_to_int(fill_color))};"
                html_parts.append(f'<div class="pdf-shape pdf-rect" style="{style}"></div>')
            elif op == "l":
                p1, p2 = item[1], item[2]
                x0, y0 = min(p1.x, p2.x), min(p1.y, p2.y)
                w = abs(p2.x - p1.x) or width
                h = abs(p2.y - p1.y) or width
                border = _rgb_int_to_hex(_color_tuple_to_int(stroke_color)) if stroke_color else "#000000"
                stroke = (
                    f"border-left:{width}px solid {border};"
                    if h > w * 2
                    else f"border-top:{width}px solid {border};"
                )
                style = (
                    f"left:{_pct(x0, pw)}%;top:{_pct(y0, ph)}%;"
                    f"width:{_pct(w, pw)}%;height:{_pct(h, ph)}%;"
                    f"{stroke}"
                )
                html_parts.append(f'<div class="pdf-shape pdf-line" style="{style}"></div>')

    try:
        info_list = page.get_image_info(xrefs=True)
    except Exception:
        info_list = []
    try:
        text_dict = page.get_text("dict")
    except Exception:
        text_dict = {"blocks": []}
    inline_blocks = [b for b in text_dict.get("blocks", []) if b.get("type") == 1]

    def _bbox_close(a: tuple[float, ...], b: tuple[float, ...], tol: float = 2.0) -> bool:
        return all(abs(a[i] - b[i]) <= tol for i in range(4))

    placed = 0
    for idx, info in enumerate(info_list):
        bbox = info.get("bbox")
        if not bbox:
            continue
        x0, y0, x1, y1 = bbox
        xref = info.get("xref") or 0
        data: bytes | None = None
        ext = "png"
        if xref:
            try:
                base_image = page.parent.extract_image(xref)
                data = base_image.get("image")
                ext = base_image.get("ext", "png")
            except Exception:
                data = None
        if not data:
            for b in inline_blocks:
                if _bbox_close(tuple(b.get("bbox") or (0, 0, 0, 0)), tuple(bbox)):
                    data = b.get("image")
                    ext = b.get("ext", ext)
                    break
        if not data:
            continue
        data, ext = _shrink_image(data, ext)
        b64 = base64.b64encode(data).decode("ascii")
        if len(b64) > MAX_IMAGE_B64:
            data, ext = _shrink_image(data, ext, max_b64=700_000)
            b64 = base64.b64encode(data).decode("ascii")
        if len(b64) > MAX_IMAGE_B64:
            needs_fallback = True
            continue
        img_id = f"{img_id_prefix}-{idx}"
        mime = f"image/{'jpeg' if ext in ('jpg', 'jpeg') else ext}"
        images.append({"id": img_id, "mime": mime, "dataBase64": b64})
        style = (
            f"left:{_pct(x0, pw)}%;top:{_pct(y0, ph)}%;"
            f"width:{_pct(x1 - x0, pw)}%;height:{_pct(y1 - y0, ph)}%;"
        )
        html_parts.append(f'<img class="pdf-image" src="asset:{img_id}" style="{style}" alt=""/>')
        placed += 1

    if placed < len(info_list):
        needs_fallback = True

    try:
        raw_text = page.get_text("dict")
    except Exception:
        raw_text = {"blocks": []}
    for block in raw_text.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                text = span.get("text", "")
                if not text.strip():
                    continue
                x0, y0, x1, y1 = span["bbox"]
                font_name = span.get("font", "")
                flags = span.get("flags", 0)
                is_bold = bool(flags & 2**4) or "bold" in font_name.lower()
                is_italic = (
                    bool(flags & 2**1)
                    or "italic" in font_name.lower()
                    or "oblique" in font_name.lower()
                )
                size_pct = _pct(span.get("size", 12.0), pw)
                box_h = max(float(y1) - float(y0), float(span.get("size", 12.0)) * 1.15)
                style = (
                    f"left:{_pct(x0, pw)}%;top:{_pct(y0, ph)}%;"
                    f"width:{_pct(x1 - x0, pw)}%;max-width:{_pct(x1 - x0, pw)}%;"
                    f"height:{_pct(box_h, ph)}%;"
                    f"font-size:{size_pct}cqw;"
                    f"color:{_rgb_int_to_hex(span.get('color'))};"
                    f"font-weight:{'bold' if is_bold else 'normal'};"
                    f"font-style:{'italic' if is_italic else 'normal'};"
                )
                html_parts.append(f'<span class="pdf-text" style="{style}">{_esc(text)}</span>')

    return "".join(html_parts), images, needs_fallback


def render_vector_pages(raw: bytes) -> tuple[list[dict[str, Any]], int]:
    """Extract positioned pageHtml from a PDF using PyMuPDF in-process."""
    try:
        import fitz
    except ImportError as exc:
        logger.warning("pdf_page_vector: pymupdf not installed: %s", exc)
        return [], 0

    try:
        doc = fitz.open(stream=raw, filetype="pdf")
    except Exception:
        logger.exception("pdf_page_vector: fitz.open failed")
        return [], 0

    page_count = int(doc.page_count)
    out_pages: list[dict[str, Any]] = []
    try:
        for i in range(min(page_count, MAX_PAGES)):
            page = doc.load_page(i)
            rect = page.rect
            pw, ph = rect.width, rect.height
            try:
                html, images, needs_fallback = _render_page(page, pw, ph, f"pimg-{i + 1}")
            except Exception:
                logger.exception("pdf_page_vector: render page %s failed", i + 1)
                html, images, needs_fallback = "", [], True
            out_pages.append(
                {
                    "index": i,
                    "width": round(pw, 2),
                    "height": round(ph, 2),
                    "html": html,
                    "images": images,
                    "needsRasterFallback": needs_fallback,
                }
            )
    finally:
        doc.close()

    return out_pages, page_count
