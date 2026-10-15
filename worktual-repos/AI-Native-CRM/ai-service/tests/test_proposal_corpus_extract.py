from __future__ import annotations

import base64
import io
import zipfile
from typing import Any

import pytest

from app.agents.proposal_corpus_extract_agent import run


def _tiny_docx(text: str) -> bytes:
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body></w:document>"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("word/document.xml", xml)
        zf.writestr("[Content_Types].xml", "<Types></Types>")
    return buf.getvalue()


class _DummyBrd:
    def model_dump(self) -> dict[str, Any]:
        return {"project_title": "ST Courier", "overview": "scope"}


@pytest.mark.asyncio
async def test_extract_docx_sends_text_not_pdf_bytes(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    async def fake_generate_json(_prompt, _schema, **kwargs):
        captured["pdf_bytes"] = kwargs.get("pdf_bytes")
        captured["extra_text"] = kwargs.get("extra_text")
        return _DummyBrd()

    monkeypatch.setattr(
        "app.agents.proposal_corpus_extract_agent.generate_json", fake_generate_json
    )
    monkeypatch.setattr(
        "app.agents.proposal_corpus_extract_agent.proposal_gemini_configured",
        lambda: True,
    )

    raw = _tiny_docx("ST Courier BRD scope and objectives")
    result = await run(
        {
            "itemId": "i1",
            "kind": "requirement",
            "filename": "_ST courier.docx",
            "contentBase64": base64.b64encode(raw).decode("ascii"),
            "fullText": "",
        }
    )
    assert result["ok"] is True
    assert result.get("source") == "ai"
    assert captured["pdf_bytes"] in (None, [])
    assert "ST Courier BRD" in (captured["extra_text"] or "")


@pytest.mark.asyncio
async def test_extract_uses_ingest_full_text_for_docx(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    async def fake_generate_json(_prompt, _schema, **kwargs):
        captured["pdf_bytes"] = kwargs.get("pdf_bytes")
        captured["extra_text"] = kwargs.get("extra_text")
        return _DummyBrd()

    monkeypatch.setattr(
        "app.agents.proposal_corpus_extract_agent.generate_json", fake_generate_json
    )
    monkeypatch.setattr(
        "app.agents.proposal_corpus_extract_agent.proposal_gemini_configured",
        lambda: True,
    )

    result = await run(
        {
            "itemId": "i1",
            "kind": "requirement",
            "filename": "brief.docx",
            "contentBase64": base64.b64encode(b"PK\x03\x04not-a-real-docx").decode("ascii"),
            "fullText": "Client wants courier tracking and SLA reporting.",
        }
    )
    assert result["ok"] is True
    assert captured["pdf_bytes"] in (None, [])
    assert "courier tracking" in (captured["extra_text"] or "")


@pytest.mark.asyncio
async def test_extract_brd_pdf_uses_ingest_text_not_gemini_pdf(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    async def fake_generate_json(_prompt, _schema, **kwargs):
        captured["pdf_bytes"] = kwargs.get("pdf_bytes")
        captured["extra_text"] = kwargs.get("extra_text")
        captured["thinking_level"] = kwargs.get("thinking_level")
        return _DummyBrd()

    monkeypatch.setattr(
        "app.agents.proposal_corpus_extract_agent.generate_json", fake_generate_json
    )
    monkeypatch.setattr(
        "app.agents.proposal_corpus_extract_agent.proposal_gemini_configured",
        lambda: True,
    )
    monkeypatch.setattr(
        "app.agents.proposal_corpus_extract_agent.parse_pdf_bytes",
        lambda _pdf: {},
    )

    result = await run(
        {
            "itemId": "i1",
            "kind": "requirement",
            "filename": "GoNutriline.pdf",
            "contentBase64": base64.b64encode(b"%PDF-1.4 fake").decode("ascii"),
            "fullText": "Client GoNutriline needs nutrition commerce and CCaaS.",
        }
    )
    assert result["ok"] is True
    assert result.get("source") == "ai"
    assert captured["pdf_bytes"] in (None, [])
    assert "GoNutriline" in (captured["extra_text"] or "")
    assert captured.get("thinking_level") == "low"


class _DummyProposal:
    def model_dump(self) -> dict[str, Any]:
        return {"cover": {"title": "Commercial Proposal"}, "sections": []}


@pytest.mark.asyncio
async def test_extract_proposal_retries_text_after_handshake_timeout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, Any]] = []

    async def fake_generate_json(_prompt, _schema, **kwargs):
        pdf = kwargs.get("pdf_bytes") or []
        calls.append({"pdf": bool(pdf)})
        if pdf:
            raise TimeoutError("The handshake operation timed out")
        return _DummyProposal()

    monkeypatch.setattr(
        "app.agents.proposal_corpus_extract_agent.generate_json", fake_generate_json
    )
    monkeypatch.setattr(
        "app.agents.proposal_corpus_extract_agent.proposal_gemini_configured",
        lambda: True,
    )
    monkeypatch.setattr(
        "app.agents.proposal_corpus_extract_agent.parse_pdf_bytes",
        lambda _pdf: {},
    )

    result = await run(
        {
            "itemId": "i2",
            "kind": "proposal",
            "filename": "GoNutriline Commercial Proposal.pdf",
            "contentBase64": base64.b64encode(b"%PDF-1.4 fake").decode("ascii"),
            "fullText": "Commercial Proposal for GoNutriline covering CCaaS and catalog.",
        }
    )
    assert result["ok"] is True
    assert result.get("source") == "ai"
    assert calls[0]["pdf"] is True
    assert any(not row["pdf"] for row in calls)
    assert result.get("instance", {}).get("cover", {}).get("title") == "Commercial Proposal"
