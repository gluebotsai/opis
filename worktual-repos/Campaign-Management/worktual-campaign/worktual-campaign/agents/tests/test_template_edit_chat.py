"""Edit-space chat is text-only; template preview lives on Live template (right)."""

from __future__ import annotations

from pathlib import Path

FE = Path(__file__).resolve().parents[2] / "frontend" / "src"
EDIT_PAGE = FE / "pages" / "CampaignTemplateEditPage.tsx"
HELPER = FE / "lib" / "template-edit-chat.ts"
PREVIEW = FE / "components" / "campaigns" / "ChannelTemplatePreview.tsx"


def visible_edit_chat_rows(rows: list[dict]) -> list[dict]:
    return [r for r in rows if r.get("kind") == "text"]


def test_visible_rows_exclude_template_seed() -> None:
    rows = [
        {"id": "t0", "kind": "template", "fields": {"subject": "Hi"}},
        {"id": "u1", "kind": "text", "text": "make it shorter"},
    ]
    out = visible_edit_chat_rows(rows)
    assert [r["kind"] for r in out] == ["text"]
    assert out[0]["text"] == "make it shorter"


def test_visible_rows_empty_without_anything() -> None:
    assert visible_edit_chat_rows([]) == []


def test_edit_page_chat_does_not_render_template_preview() -> None:
    text = EDIT_PAGE.read_text()
    assert "visibleEditChatRows" in text
    assert "return abExtra[abVariant]" not in text
    assert "Current template" not in text
    chat_left = text.split("left={", 1)[1].split("right={", 1)[0]
    assert "ChannelTemplatePreview" not in chat_left


def test_helper_hides_template_seed_from_chat() -> None:
    text = HELPER.read_text()
    assert "ensureTemplateSeedRow" in text
    assert 'return rows.filter((r) => r.kind === "text")' in text
    assert "Live template" in text


def test_email_preview_uses_body_and_html_when_greeting_exists() -> None:
    text = PREVIEW.read_text()
    assert "hasRenderableEmailLayout" in text
    assert "body," in text or "resolved.body" in text
