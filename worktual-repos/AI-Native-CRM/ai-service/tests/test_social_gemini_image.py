from app.services.social_gemini_image import aspect_ratio_for_platform


def test_social_aspect_ratio_by_platform():
    assert aspect_ratio_for_platform("instagram") == "4:5"
    assert aspect_ratio_for_platform("linkedin") == "16:9"
    assert aspect_ratio_for_platform("facebook") == "16:9"
    assert aspect_ratio_for_platform("unknown") == "1:1"
