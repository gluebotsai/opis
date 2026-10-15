from ingest.validation import PayloadValidationError, validate_client_ip


def test_validate_client_ip_ipv4():
    assert validate_client_ip("203.0.113.50") == "203.0.113.50"


def test_validate_client_ip_mapped_ipv4():
    assert validate_client_ip("::ffff:198.51.100.30") == "198.51.100.30"


def test_validate_client_ip_rejects_invalid():
    try:
        validate_client_ip("not-an-ip")
        assert False, "expected PayloadValidationError"
    except PayloadValidationError:
        pass
