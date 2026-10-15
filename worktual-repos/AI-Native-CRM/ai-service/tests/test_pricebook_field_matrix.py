"""B2B price book fields — API shape documentation (no coworker patch surface)."""

from __future__ import annotations

# Fields exercised by backend/scripts/e2e-pricebook-field-matrix.ts
PRICE_BOOK_CREATE_FIELDS = ("name", "code", "currency", "isDefault")
PRICE_BOOK_ENTRY_FIELDS = (
    "priceBookId",
    "productId",
    "offerId",
    "addonId",
    "amount",
    "billingFrequency",
)


def test_price_book_create_field_set() -> None:
    assert len(PRICE_BOOK_CREATE_FIELDS) >= 4


def test_price_book_entry_field_set() -> None:
    assert "priceBookId" in PRICE_BOOK_ENTRY_FIELDS
    assert "amount" in PRICE_BOOK_ENTRY_FIELDS
