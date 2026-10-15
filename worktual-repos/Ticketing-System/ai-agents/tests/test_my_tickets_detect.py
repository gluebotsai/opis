"""Live-data helpers for “my tickets / for me” detection."""

from app.live_data import _wants_my_tickets


def test_wants_my_tickets_for_me():
    assert _wants_my_tickets("how many open tickets are there for me?")
    assert _wants_my_tickets("open tickets for me")
    assert _wants_my_tickets("how many tickets assigned to me?")
    assert _wants_my_tickets("show my tickets")
    assert not _wants_my_tickets("how many open tickets are there?")
    assert not _wants_my_tickets("show queue pressure")
