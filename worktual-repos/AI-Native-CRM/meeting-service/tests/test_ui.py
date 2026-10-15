def test_ui_disabled_by_default(client):
    assert client.get("/ui").status_code == 404
    assert client.post("/ui/token").status_code == 404
