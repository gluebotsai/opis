from __future__ import annotations

from app.agents.enrich_lead_agent import _clean_fields
from app.tools.bs4_extract import (
    city_from_page_text,
    extract_employee_count_from_text,
    extract_firmographics,
    first_about_page_url,
    first_location_page_url,
    first_product_page_url,
    guess_industry,
    normalize_products_value,
    parse_headcount_token,
)
from app.tools.wikidata_lookup import (
    _score_wikipedia_company_page,
    parse_wikipedia_infobox_employees,
    parse_wikipedia_infobox_headquarters,
    parse_wikipedia_infobox_products,
    parse_wikipedia_infobox_website,
    pick_employee_count,
    wikipedia_title_from_url,
)
from app.tools.company_identity import (
    acronym_matches_entity_text,
    company_identity_allows_domain,
    company_name_matches_domain,
    company_name_matches_linkedin,
    is_generic_location_label,
    is_short_company_acronym,
    is_synthetic_company_logo_url,
    is_trusted_firmographic_source,
    logo_url_belongs_to_company,
    normalize_company_city,
    wiki_firmographics_match_company,
)
from app.tools.ddg_search import rank_domain
from app.tools.page_fetch import is_private_host


def test_rank_domain_prefers_name_match():
    assert rank_domain("acme.com", "Acme Inc") > rank_domain("random.io", "Acme Inc")


def test_rank_domain_rejects_unrelated_dotcom():
    assert rank_domain("zoho.com", "Zendesk") < 50
    assert rank_domain("zendesk.com", "Zendesk") >= 70


def test_wikipedia_search_scoring_prefers_cognizant_over_car():
    cognizant = (
        "Cognizant Technology Solutions Corporation is an American "
        "domiciled Indian multinational information technology services "
        "and outsourcing company."
    )
    cadillac = (
        "The Cadillac CTS is a luxury car manufactured and marketed by "
        "General Motors under the Cadillac brand from 2002 until 2019."
    )
    assert _score_wikipedia_company_page("CTS", "Cognizant", cognizant) >= 50
    assert _score_wikipedia_company_page("CTS", "Cadillac CTS", cadillac) < 0
    assert wikipedia_title_from_url(
        "https://en.wikipedia.org/wiki/Cognizant"
    ) == "Cognizant"
    infobox = """
{{Infobox company
| name = Cognizant
| website = {{URL|www.cognizant.com}}
}}
"""
    assert parse_wikipedia_infobox_website(infobox) == "cognizant.com"


def test_parse_wikipedia_infobox_products_skips_empty_services():
    mixed = """
{{Infobox company
| name = Cognizant
| services =
| revenue = {{increase}} {{US$|21.108 billion|link=yes}} (2025)
| products = Cognizant Neuro; Cognizant Skybuffer
}}
"""
    assert parse_wikipedia_infobox_products(mixed) == (
        "Cognizant Neuro; Cognizant Skybuffer"
    )
    empty_only = """
{{Infobox company
| name = Cognizant
| services =
| revenue = {{increase}} {{US$|21.108 billion|link=yes}} (2025)
}}
"""
    assert parse_wikipedia_infobox_products(empty_only) is None
    assert normalize_products_value("| revenue = (2025)") is None


def test_acronym_matches_cognizant_not_cadillac():
    assert is_short_company_acronym("CTS")
    assert is_short_company_acronym("IBM")
    assert not is_short_company_acronym("Zepto")
    assert not is_short_company_acronym("Hotstar")
    assert not is_short_company_acronym("Zoho")
    assert company_name_matches_domain("CTS", "cts.com")
    assert company_name_matches_domain("IBM", "ibm.com")
    assert not company_name_matches_domain("CTS", "ctscorp.com")
    assert not company_name_matches_domain("CTS", "cognizant.com")
    # Brands: real sites often append product words (zeptonow.com).
    assert company_name_matches_domain("Zepto", "zepto.com")
    assert company_name_matches_domain("Zepto", "zeptonow.com")
    assert company_name_matches_domain("Hotstar", "hotstar.com")
    assert company_name_matches_domain("Hotstar", "jiohotstar.com")
    assert not company_name_matches_domain("Hotstar", "disneyplus.com")
    # HCL-style brand forms (acronym is the wiki title / lead token).
    assert acronym_matches_entity_text(
        "HCL",
        "HCL Technologies Limited is an Indian multinational information "
        "technology (IT) and consultant company headquartered in Noida.",
    )
    assert acronym_matches_entity_text(
        "HCL",
        "HCLTech HCL Technologies Limited is an Indian multinational "
        "information technology company headquartered in Noida.",
    )
    assert not acronym_matches_entity_text(
        "HCL",
        "HCL is a chemistry abbreviation for hydrochloric acid used in labs.",
    )
    assert company_identity_allows_domain(
        "Hotstar",
        "disneyplus.com",
        evidence_text=(
            "Disney+ Hotstar is an Indian subscription video on-demand "
            "streaming service owned by Disney India."
        ),
        source_url="https://en.wikipedia.org/wiki/Disney%2B_Hotstar",
    )
    assert not company_identity_allows_domain(
        "Hotstar",
        "disneyplus.com",
        evidence_text="Some unrelated streaming notes.",
        source_url="https://en.wikipedia.org/wiki/Streaming_media",
    )
    assert acronym_matches_entity_text(
        "CTS",
        "Cognizant Technology Solutions Corporation is an American "
        "domiciled Indian multinational information technology services "
        "and outsourcing company.",
    )
    assert not acronym_matches_entity_text(
        "CTS",
        "The Cadillac CTS is a luxury car manufactured and marketed by "
        "General Motors under the Cadillac brand.",
    )
    assert not acronym_matches_entity_text(
        "CTS",
        "Cubic Corporation is an American multinational defense and public "
        "transportation equipment manufacturer. The company was founded in 1949 "
        "and was publicly traded from 1951 to 2021. It operates two business "
        "segments: Cubic Transportation Systems (CTS) and Cubic Mission.",
    )
    assert acronym_matches_entity_text(
        "CTS",
        "cognizant.com https://en.wikipedia.org/wiki/Cognizant "
        "Cognizant Technology Solutions Corporation is an American "
        "domiciled Indian multinational information technology services company.",
    )
    assert company_identity_allows_domain(
        "CTS",
        "cognizant.com",
        evidence_text=(
            "Cognizant Technology Solutions Corporation is an American "
            "domiciled Indian multinational information technology services "
            "company."
        ),
        source_url="https://en.wikipedia.org/wiki/Cognizant",
    )
    assert not company_identity_allows_domain(
        "CTS",
        "zoho.com",
        evidence_text="Zoho Corporation is an Indian software company.",
        source_url="https://en.wikipedia.org/wiki/Zoho_Corporation",
    )
    assert wiki_firmographics_match_company(
        "CTS",
        {
            "wikiTitle": "Cognizant",
            "domain": "cognizant.com",
            "description": (
                "Cognizant Technology Solutions Corporation is an American "
                "domiciled Indian multinational information technology "
                "services and outsourcing company."
            ),
            "sourceUrl": "https://en.wikipedia.org/wiki/Cognizant",
        },
    )


def test_company_identity_blocks_zendesk_zoho_mixup():
    assert company_name_matches_domain("Zendesk", "zendesk.com")
    assert not company_name_matches_domain("Zendesk", "zoho.com")
    assert company_name_matches_linkedin(
        "Zendesk", "https://www.linkedin.com/company/zendesk"
    )
    assert not company_name_matches_linkedin(
        "Zendesk", "https://www.linkedin.com/company/zoho"
    )
    assert not wiki_firmographics_match_company(
        "Zendesk",
        {"domain": "zoho.com", "linkedinUrl": "https://www.linkedin.com/company/zoho"},
    )
    assert wiki_firmographics_match_company(
        "Zendesk",
        {
            "domain": "zendesk.com",
            "linkedinUrl": "https://www.linkedin.com/company/zendesk",
        },
    )


def test_clean_fields_drops_mismatched_identity():
    cleaned = _clean_fields(
        {
            "domain": {"value": "zoho.com", "confidence": 90},
            "linkedinUrl": {
                "value": "https://www.linkedin.com/company/zoho",
                "confidence": 90,
            },
            "industry": {"value": "Software", "confidence": 70},
        },
        "Zendesk",
    )
    assert "domain" not in cleaned
    assert "linkedinUrl" not in cleaned
    assert cleaned["industry"]["value"] == "Software"


def test_clean_fields_keeps_cognizant_domain_for_cts():
    desc = (
        "Cognizant Technology Solutions Corporation is an American "
        "domiciled Indian multinational information technology services "
        "and outsourcing company."
    )
    cleaned = _clean_fields(
        {
            "domain": {
                "value": "cognizant.com",
                "confidence": 80,
                "sourceUrl": "https://en.wikipedia.org/wiki/Cognizant",
            },
            "companyDescription": {
                "value": desc,
                "confidence": 82,
                "sourceUrl": "https://en.wikipedia.org/wiki/Cognizant",
            },
        },
        "CTS",
    )
    assert cleaned["domain"]["value"] == "cognizant.com"
    assert "Cognizant Technology Solutions" in cleaned["companyDescription"]["value"]


def test_logo_identity_blocks_zoho_on_zendesk_and_hexaware():
    assert not logo_url_belongs_to_company(
        "Zendesk",
        "https://www.zoho.com/sites/default/files/zoho-logo.png",
        source_url="https://www.zendesk.com/",
    )
    assert not logo_url_belongs_to_company(
        "Hexaware",
        "https://www.zohowebstatic.com/sites/zweb/images/commonlogo/zoho-logo.svg",
    )
    assert is_synthetic_company_logo_url(
        "https://www.google.com/s2/favicons?domain=zendesk.com&sz=128"
    )
    assert not logo_url_belongs_to_company(
        "Zendesk",
        "https://www.google.com/s2/favicons?domain=zoho.com&sz=128",
    )
    assert not logo_url_belongs_to_company(
        "Zendesk",
        "https://www.google.com/s2/favicons?domain=zendesk.com&sz=128",
        source_url="favicon:zendesk.com",
    )
    assert logo_url_belongs_to_company(
        "Zendesk",
        "https://d1eipm3vz40hy0.cloudfront.net/images/logos/zendesk-logo.png",
    )
    assert logo_url_belongs_to_company(
        "Zendesk",
        "https://www.zendesk.com/apple-touch-icon.png",
    )
    assert logo_url_belongs_to_company(
        "Zoho",
        "https://www.zohowebstatic.com/sites/zweb/images/commonlogo/zoho-logo.svg",
    )
    assert logo_url_belongs_to_company(
        "Hexaware",
        "https://www.hexaware.com/favicon.ico",
    )
    assert logo_url_belongs_to_company(
        "Zendesk",
        "https://www.zendesk.com/favicon.ico",
        source_url="https://www.zendesk.com/",
    )
    assert not logo_url_belongs_to_company(
        "Zendesk",
        "https://www.zoho.com/favicon.ico",
        source_url="https://www.zendesk.com/",
    )
    assert logo_url_belongs_to_company(
        "Zendesk",
        "https://commons.wikimedia.org/wiki/Special:FilePath/Zendesk_logo.svg",
    )
    assert logo_url_belongs_to_company(
        "HCL",
        "https://www.hcltech.com/favicon.ico",
        company_domain="hcltech.com",
    )
    assert logo_url_belongs_to_company(
        "HCL",
        "https://commons.wikimedia.org/wiki/Special:FilePath/HCLTech-new-logo.svg",
    )
    assert logo_url_belongs_to_company(
        "Meta",
        "https://commons.wikimedia.org/wiki/Special:FilePath/Meta_Platforms_Inc._logo.svg",
        company_domain="meta.com",
    )
    assert not logo_url_belongs_to_company(
        "Meta",
        "https://commons.wikimedia.org/wiki/Special:FilePath/Zoho_logo.svg",
        company_domain="meta.com",
    )


def test_pick_best_logo_prefers_current_brand_over_former_and_campus():
    from app.tools.wikidata_lookup import (
        is_likely_brand_logo_image_url,
        pick_best_logo_filename,
    )

    assert pick_best_logo_filename(
        [
            "Facebook, Inc. Logo 2019.svg",
            "Meta Platforms Inc. logo.svg",
            "Meta HQ 2023.png",
        ],
        "Meta",
    ) == "Meta Platforms Inc. logo.svg"
    assert pick_best_logo_filename(
        ["HCL Tech Noida SEZ Campus.png", "HCLTech-new-logo.svg"],
        "HCL",
    ) == "HCLTech-new-logo.svg"
    assert not is_likely_brand_logo_image_url(
        "https://upload.wikimedia.org/wikipedia/commons/6/67/HCL_Tech_Noida_SEZ_Campus.png"
    )


def test_clean_fields_drops_mismatched_logo_even_when_source_page_matches():
    cleaned = _clean_fields(
        {
            "logoUrl": {
                "value": "https://www.zoho.com/sites/default/files/zoho-logo.png",
                "confidence": 90,
                "sourceUrl": "https://www.zendesk.com/",
            }
        },
        "Zendesk",
    )
    assert "logoUrl" not in cleaned


def test_clean_fields_keeps_matching_logo():
    cleaned = _clean_fields(
        {
            "logoUrl": {
                "value": "https://www.zendesk.com/apple-touch-icon.png",
                "confidence": 80,
                "sourceUrl": "https://www.zendesk.com/",
            }
        },
        "Zendesk",
    )
    assert "logoUrl" in cleaned


def test_clean_fields_drops_synthetic_favicon():
    cleaned = _clean_fields(
        {
            "logoUrl": {
                "value": "https://www.google.com/s2/favicons?domain=zendesk.com&sz=128",
                "confidence": 80,
                "sourceUrl": "favicon:zendesk.com",
            }
        },
        "Zendesk",
    )
    assert "logoUrl" not in cleaned


def test_rank_domain_penalizes_social():
    assert rank_domain("linkedin.com", "Acme") < 20


def test_ssrf_blocks_private():
    assert is_private_host("127.0.0.1")
    assert is_private_host("10.0.0.5")
    assert is_private_host("localhost")
    # Public hostname literal IP path — do not rely on live DNS (sandbox may
    # resolve example.com oddly).
    assert not is_private_host("8.8.8.8")
    assert is_private_host("192.168.1.1")


def test_guess_industry():
    assert guess_industry("We sell SaaS cloud software") == "Software"


def test_extract_logo_from_jsonld_and_icons():
    html = """
    <html><head>
      <script type="application/ld+json">
      {"@type":"Organization","name":"Hexaware",
       "logo":"https://www.hexaware.com/assets/hexaware-logo.svg"}
      </script>
    </head></html>
    """
    out = extract_firmographics(html, "https://www.hexaware.com/")
    assert out["logoUrl"] == "https://www.hexaware.com/assets/hexaware-logo.svg"

    icons = """
    <html><head>
      <link rel="apple-touch-icon" href="/apple-touch-icon.png">
      <link rel="icon" href="/favicon.ico">
    </head></html>
    """
    out2 = extract_firmographics(icons, "https://www.zendesk.com/")
    assert out2["logoUrl"] == "https://www.zendesk.com/apple-touch-icon.png"

    bare = "<html><head><title>Hexaware</title></head><body>IT services</body></html>"
    out3 = extract_firmographics(bare, "https://www.hexaware.com/")
    assert out3["logoUrl"] == "https://www.hexaware.com/favicon.ico"


def test_extract_json_ld():
    html = """
    <html><head>
    <script type="application/ld+json">
    {"@type":"Organization","name":"Acme","industry":"Software",
     "numberOfEmployees":120,
     "address":{"streetAddress":"1 Main","addressLocality":"Austin"}}
    </script>
    </head><body></body></html>
    """
    out = extract_firmographics(html, "https://acme.com")
    assert out["industry"] == "Software"
    assert out["employeeCount"] == 120
    assert out["city"] == "Austin"


def test_parse_wikipedia_infobox_products():
    wikitext = """
{{Infobox company
| name = Zendesk
| products = [[Zendesk Support]], [[Zendesk Chat|Chat]], Zendesk Talk
| employees = 5,000
}}
"""
    assert parse_wikipedia_infobox_products(wikitext) == (
        "Zendesk Support; Chat; Zendesk Talk"
    )


def test_own_site_headcount_including_k_plus():
    facts = (
        "Hexaware Key Facts 1.5B Annual Revenue (USD) 33K+ Global Employees "
        "68 Offices Worldwide 33+ Years of Excellence"
    )
    assert parse_headcount_token("33K+") == 33000
    assert parse_headcount_token("2026") is None
    assert extract_employee_count_from_text(facts) == 33000
    assert extract_employee_count_from_text("33+ Years of Excellence") is None
    assert extract_employee_count_from_text("Copyright 2026 employees") is None
    assert extract_employee_count_from_text("1.5B Annual Revenue (USD)") is None
    assert extract_employee_count_from_text("Zendesk has 5,860 employees worldwide") == 5860
    html = """
    <html><body>
      <div class="key_facts_slick">33K+ Global Employees</div>
    </body></html>
    """
    assert extract_firmographics(html, "https://hexaware.com/about-us/").get(
        "employeeCount"
    ) == 33000


def test_official_location_page_city():
    html = """
    <html><body>
      <a href="/location/">Locations</a>
      <a href="/location/india/">India</a>
      <p>Millennium Business Park, Navi Mumbai 400710, Maharashtra, India</p>
    </body></html>
    """
    assert first_location_page_url(html, "https://hexaware.com/") == (
        "https://hexaware.com/location/india/"
    )
    assert city_from_page_text(html) == "Navi Mumbai, Maharashtra, India"


def test_first_about_page_url():
    html = """
    <html><body>
      <a href="/about-us">About us</a>
      <a href="/products">Products</a>
    </body></html>
    """
    assert first_about_page_url(html, "https://www.hexaware.com/") == (
        "https://www.hexaware.com/about-us"
    )


def test_extract_company_description_and_products():
    html = """
    <html><head>
      <meta property="og:description"
        content="Zendesk builds customer service and engagement software for support teams worldwide.">
      <script type="application/ld+json">
      {"@type":"Organization","name":"Zendesk",
       "description":"Zendesk builds customer service and engagement software for support teams worldwide.",
       "makesOffer":[
         {"@type":"Offer","itemOffered":{"@type":"SoftwareApplication","name":"Zendesk Support"}},
         {"@type":"Offer","itemOffered":{"@type":"SoftwareApplication","name":"Zendesk Chat"}}
       ]}
      </script>
    </head>
    <body>
      <a href="/products/support">Products</a>
      <h2>Products</h2>
      <ul><li>Zendesk Support</li><li>Zendesk Chat</li></ul>
    </body></html>
    """
    out = extract_firmographics(html, "https://www.zendesk.com")
    assert "customer service" in (out.get("description") or "").lower()
    products = (out.get("products") or "").lower()
    assert "zendesk support" in products
    assert first_product_page_url(html, "https://www.zendesk.com") == (
        "https://www.zendesk.com/products/support"
    )
    assert normalize_products_value(["Zendesk Support", "Learn more", "Zendesk Chat"]) == (
        "Zendesk Support; Zendesk Chat"
    )
    assert normalize_products_value("brands =") is None


def test_wikipedia_hq_and_headcount_from_infobox():
    hexaware = """
{{Infobox company
| name = Hexaware Technologies
| hq_location_city = [[Navi Mumbai]]
| hq_location_country = [[India]]
| num_employees = 31,605 (2024)
}}
"""
    zendesk = """
{{Infobox company
| name = Zendesk
| headquarters = [[San Francisco]], [[California]], U.S.
| num_employees = {{increase}} 6,640 (2022)
| products = brands =
}}
"""
    assert is_generic_location_label("Headquarters")
    assert normalize_company_city("Headquarters") is None
    assert normalize_company_city("181 Fremont") is None
    assert parse_wikipedia_infobox_headquarters(
        "| hq_location = [[181 Fremont]]\n"
    ) is None
    assert parse_wikipedia_infobox_headquarters(hexaware) == "Navi Mumbai, India"
    assert parse_wikipedia_infobox_employees(hexaware) == (31605, 2024)
    assert parse_wikipedia_infobox_headquarters(zendesk) == (
        "San Francisco, California, U.S."
    )
    assert parse_wikipedia_infobox_employees(zendesk)[0] == 6640
    assert parse_wikipedia_infobox_products(zendesk) is None
    assert pick_employee_count(17000, 2019, 6640, 2022) == (6640, "wikipedia")
    assert pick_employee_count(17000, None, 31605, 2024) == (31605, "wikipedia")
    assert pick_employee_count(3830, 2020, 5860, None) == (5860, "wikipedia")
    assert is_trusted_firmographic_source("https://en.wikipedia.org/wiki/Zendesk")
    assert is_trusted_firmographic_source(
        "https://www.zendesk.com/about", "zendesk.com"
    )
    assert not is_trusted_firmographic_source(
        "https://www.google.com/search?q=zendesk+employees"
    )
