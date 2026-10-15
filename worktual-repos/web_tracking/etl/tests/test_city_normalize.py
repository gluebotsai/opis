from ingest.city_normalize import normalize_city_name, resolve_display_city


def test_normalize_chennai_corporation():
    assert normalize_city_name("Chennai Corporation") == "Chennai"
    assert normalize_city_name("Greater Chennai Corporation") == "Chennai"


def test_resolve_suburb_with_ip_metro():
    assert (
        resolve_display_city(
            primary="St Thomas Mount",
            locality="St Thomas Mount",
            ip_city="Chennai",
        )
        == "Chennai"
    )


def test_resolve_state_district():
    assert (
        resolve_display_city(
            primary="St Thomas Mount",
            locality="St Thomas Mount",
            state_district="Chennai District",
        )
        == "Chennai"
    )
