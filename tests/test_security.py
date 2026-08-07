from fastapi.testclient import TestClient


def test_provider_listing_never_returns_stored_api_key(engine):
    engine.write_json(
        engine.conf_path(),
        {
            "providers": [
                {
                    "id": "provider-1",
                    "name": "test",
                    "base_url": "https://gateway.invalid/v1",
                    "api_key": "synthetic-secret-that-must-not-leak",
                    "model": "senseaudio-s2",
                }
            ]
        },
    )

    with TestClient(engine.app) as client:
        response = client.get("/v1/providers")

    assert response.status_code == 200
    body = response.json()[0]
    assert body["key_set"] is True
    assert "api_key" not in body
    assert "synthetic-secret" not in response.text


def test_untrusted_browser_origin_cannot_read_or_mutate_desktop_engine(engine):
    with TestClient(engine.app) as client:
        response = client.get(
            "/v1/providers",
            headers={"Origin": "https://evil.example"},
        )

    assert response.status_code == 403
    assert "access-control-allow-origin" not in response.headers


def test_tauri_origin_remains_allowed(engine):
    with TestClient(engine.app) as client:
        response = client.get(
            "/v1/health",
            headers={"Origin": "tauri://localhost"},
        )

    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "tauri://localhost"
