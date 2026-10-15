from unittest.mock import MagicMock, patch

from ingest.geo_merge import merge_client_location
from ingest.reverse_geocode import parse_nominatim_response, reverse_geocode_coords


def test_parse_nominatim_response():
    data = {
        "address": {
            "city": "Bengaluru",
            "state": "Karnataka",
            "country": "India",
            "country_code": "in",
            "ISO3166-2-lvl4": "IN-KA",
        }
    }
    parsed = parse_nominatim_response(data)
    assert parsed["country"] == "IN"
    assert parsed["countryName"] == "India"
    assert parsed["region"] == "KA"
    assert parsed["regionName"] == "Karnataka"
    assert parsed["city"] == "Bengaluru"


def test_parse_nominatim_chennai_municipality():
    data = {
        "address": {
            "municipality": "Chennai Corporation",
            "state": "Tamil Nadu",
            "country": "India",
            "country_code": "in",
        }
    }
    parsed = parse_nominatim_response(data)
    assert parsed["city"] == "Chennai"


def test_parse_nominatim_suburb_with_district():
    data = {
        "address": {
            "suburb": "St Thomas Mount",
            "state_district": "Chennai District",
            "state": "Tamil Nadu",
            "country": "India",
            "country_code": "in",
        }
    }
    parsed = parse_nominatim_response(data)
    assert parsed["city"] == "Chennai"
    assert parsed.get("locality") == "St Thomas Mount"


@patch("ingest.reverse_geocode.urllib.request.urlopen")
def test_reverse_geocode_coords(mock_urlopen):
    mock_resp = MagicMock()
    mock_resp.read.return_value = (
        b'{"address":{"city":"London","state":"England","country":"United Kingdom","country_code":"gb"}}'
    )
    mock_resp.__enter__.return_value = mock_resp
    mock_urlopen.return_value = mock_resp

    result = reverse_geocode_coords(51.5074, -0.1278)
    assert result["city"] == "London"
    assert result["country"] == "GB"
    assert result["regionName"] == "England"


@patch("ingest.geo_merge.reverse_geocode_coords")
def test_merge_client_location_adds_city_from_gps(mock_reverse):
    mock_reverse.return_value = {
        "country": "IN",
        "countryName": "India",
        "region": "KA",
        "regionName": "Karnataka",
        "city": "Bengaluru",
    }

    body = {
        "_geo": {
            "ip": "203.0.113.1",
            "country": "US",
            "city": "New York",
            "location_source": "client_ip",
        },
        "profiles": {
            "location": {
                "permission": "granted",
                "latitude": 12.9716,
                "longitude": 77.5946,
                "accuracy": 20,
            }
        },
    }

    geo = merge_client_location(body)

    assert geo["latitude"] == 12.9716
    assert geo["longitude"] == 77.5946
    assert geo["city"] == "Bengaluru"
    assert geo["country"] == "IN"
    assert geo["regionName"] == "Karnataka"
    assert geo["location_source"] == "gps"
    assert "ip_geo" in geo
