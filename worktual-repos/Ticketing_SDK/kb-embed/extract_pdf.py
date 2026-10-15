"""Extract exact PDF text. No rewrite, no invented copy."""

from __future__ import annotations

import io


def extract_pdf_text(file_bytes: bytes) -> str:
    data = file_bytes or b""
    if not data:
        return ""
    text = _extract_pymupdf(data)
    if text:
        return text
    return _extract_pypdf(data)


def _extract_pymupdf(file_bytes: bytes) -> str:
    try:
        import fitz
    except ImportError:
        return ""
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    try:
        pages: list[str] = []
        for page in doc:
            piece = (page.get_text() or "").strip()
            if piece:
                pages.append(piece)
        return "\n\n".join(pages).strip()
    finally:
        doc.close()


def _extract_pypdf(file_bytes: bytes) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:
        return ""
    reader = PdfReader(io.BytesIO(file_bytes))
    pages: list[str] = []
    for page in reader.pages:
        piece = (page.extract_text() or "").strip()
        if piece:
            pages.append(piece)
    return "\n\n".join(pages).strip()
