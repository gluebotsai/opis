"""Page-clone PDF extraction must work in Docker (pymupdf on the app interpreter)."""

from __future__ import annotations

import asyncio
import base64
import os

import pytest

from app.agents import document_template_agent as dta


def _minimal_proposal_pdf() -> bytes:
    try:
        import fitz
    except ImportError:
        pytest.skip("pymupdf not installed")

    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 72), "Commercial Proposal — Sample Corp", fontsize=14)
    page.insert_text((72, 120), "Business Context", fontsize=12)
    raw = doc.tobytes()
    doc.close()
    return raw


def test_fitz_python_candidates_include_current_interpreter():
    current = os.path.realpath(os.sys.executable)
    cands = dta._fitz_python_candidates()
    assert cands, "expected at least one fitz candidate"
    assert os.path.realpath(cands[0]) == current


def test_extract_sample_bundle_produces_page_assets():
    raw = _minimal_proposal_pdf()
    b64 = base64.b64encode(raw).decode("ascii")
    text, assets, warnings = dta.extract_sample_bundle("sample-proposal.pdf", b64)
    page_ids = dta._page_ids_from_assets(assets)
    assert page_ids, f"expected page-* assets, warnings={warnings!r}, text_len={len(text)}"
    assert page_ids[0] == "page-1"


@pytest.mark.asyncio
async def test_document_template_run_page_clone_without_llm(monkeypatch):
    raw = _minimal_proposal_pdf()
    b64 = base64.b64encode(raw).decode("ascii")

    async def _no_llm(*_args, **_kwargs):
        raise AssertionError("page-clone must not call the LLM")

    monkeypatch.setattr(dta, "is_ai_configured", lambda: False)
    monkeypatch.setattr(dta, "generate_ai_text", _no_llm)

    out = await dta.run(
        kind="proposal",
        brief="Clone winning proposal visual master for playbook generation.",
        sampleFileBase64=b64,
        sampleFilename="sample-proposal.pdf",
        organizationName="Worktual",
    )

    assert out.get("ok") is True, out
    assert out.get("status") == "ok", out
    blueprint = out.get("blueprint") or {}
    assert blueprint.get("mode") == "page-clone"
    assert "bp-page-clone" in str(blueprint.get("html") or "")
    assets = out.get("assets") or []
    assert dta._page_ids_from_assets(assets)


def test_pypdf_candidates_still_skip_current_for_text_fallback():
    current = os.path.realpath(os.sys.executable)
    cands = dta._pdf_extract_python_candidates()
    assert all(os.path.realpath(p) != current for p in cands)


def test_vector_page_with_text_not_forced_to_raster():
    page = {
        "index": 0,
        "html": '<span class="pdf-text" style="left:1%">Hello</span>',
        "needsRasterFallback": True,
    }
    assert dta._vector_page_has_editable_text(page) is True
    assert dta._use_raster_page_instead_of_vector(page) is False


def test_vector_page_without_text_still_rasters():
    page = {"index": 0, "html": "", "needsRasterFallback": True}
    assert dta._use_raster_page_instead_of_vector(page) is True


def test_render_vector_pages_inprocess():
    raw = _minimal_proposal_pdf()
    from app.pdf_page_vector import render_vector_pages

    pages, count = render_vector_pages(raw)
    assert count >= 1
    assert pages
    assert "pdf-text" in str(pages[0].get("html") or "")
