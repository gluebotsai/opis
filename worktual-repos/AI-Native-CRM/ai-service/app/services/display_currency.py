"""Symbol for analytics amounts. A turn sets the tenant code; otherwise USD."""

from __future__ import annotations

from contextvars import ContextVar

_CODE: ContextVar[str] = ContextVar("display_currency", default="USD")

_SYMBOLS = {
    "USD": "$",
    "INR": "₹",
    "EUR": "€",
    "GBP": "£",
    "AED": "AED ",
    "CAD": "CA$",
    "AUD": "A$",
    "SGD": "S$",
    "JPY": "¥",
}


def set_display_currency(code: str | None) -> None:
    _CODE.set((code or "USD").strip().upper() or "USD")


def format_money_amount(value: float, currency: str | None = None) -> str:
    code = (currency or _CODE.get() or "USD").strip().upper() or "USD"
    symbol = _SYMBOLS.get(code, f"{code} ")
    return f"{symbol}{value:,.0f}"
