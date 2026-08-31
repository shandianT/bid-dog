import io
import urllib.error

from fastapi.testclient import TestClient


def _runtime_key():
    return "s" + "k-" + ("S" * 32)


def test_provider_listing_never_returns_stored_api_key(engine):
    alternate_secret = "plain-alternate-credential-123456"
    engine.write_json(
        engine.conf_path(),
        {
            "providers": [
                {
                    "id": "provider-1",
                    "name": "test",
                    "base_url": "https://gateway.invalid/v1",
                    "api_key": "synthetic-secret-that-must-not-leak",
                    "apiKey": alternate_secret,
                    "access_token": alternate_secret,
                    "credentials": {"primary": alternate_secret},
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
    assert alternate_secret not in response.text
    assert set(body) <= {
        "id", "name", "base_url", "model", "vision_model", "kind", "verify_ssl", "key_set"
    }


def test_agent_status_never_returns_saved_command_or_environment(engine):
    secret = _runtime_key()
    engine.write_json(
        engine.conf_path(),
        {
            "engine": {
                "kind": "custom",
                "cmd": "runner --token " + secret,
                "env": "API_KEY=" + secret,
            }
        },
    )

    with TestClient(engine.app) as client:
        response = client.get("/v1/agent")

    assert response.status_code == 200
    body = response.json()
    assert body["cmd"] == ""
    assert body["env"] == ""
    assert body["cmd_set"] is True
    assert body["env_set"] is True
    assert secret not in response.text


def test_agent_blank_secret_fields_preserve_existing_values(engine):
    secret = _runtime_key()
    engine.write_json(
        engine.conf_path(),
        {"engine": {"kind": "custom", "cmd": "runner " + secret, "env": "API_KEY=" + secret}},
    )

    with TestClient(engine.app) as client:
        response = client.put("/v1/agent", json={"kind": "custom", "cmd": "", "env": ""})

    assert response.status_code == 200
    saved = engine.read_json(engine.conf_path(), {})["engine"]
    assert saved["cmd"] == "runner " + secret
    assert saved["env"] == "API_KEY=" + secret


def test_probe_models_redacts_key_echoed_by_upstream(engine, monkeypatch):
    secret = _runtime_key()

    def fail(*_args, **_kwargs):
        raise urllib.error.HTTPError(
            "https://gateway.invalid/v1/models",
            401,
            "unauthorized",
            {},
            io.BytesIO(("echoed=" + secret).encode()),
        )

    monkeypatch.setattr(engine, "_models_cached", lambda *_args: None)
    monkeypatch.setattr(engine, "_openai_req", fail)
    with TestClient(engine.app) as client:
        response = client.post(
            "/v1/providers/probe_models",
            json={"base_url": "https://gateway.invalid/v1", "api_key": secret},
        )

    assert response.status_code == 200
    assert secret not in response.text
    assert "已隐藏" in response.text


def test_provider_test_redacts_key_echoed_by_upstream(engine, monkeypatch):
    secret = _runtime_key()
    engine.write_json(
        engine.conf_path(),
        {
            "providers": [
                {
                    "id": "provider-1",
                    "base_url": "https://gateway.invalid/v1",
                    "api_key": secret,
                    "model": "senseaudio-s2",
                }
            ]
        },
    )

    def fail(*_args, **_kwargs):
        raise urllib.error.HTTPError(
            "https://gateway.invalid/v1/chat/completions",
            401,
            "unauthorized",
            {},
            io.BytesIO(("echoed=" + secret).encode()),
        )

    monkeypatch.setattr(engine, "_openai_req", fail)
    with TestClient(engine.app) as client:
        response = client.post("/v1/providers/provider-1/test")

    assert response.status_code == 200
    assert secret not in response.text
    assert "已隐藏" in response.text


def test_relay_status_redacts_known_nonstandard_credentials(engine):
    secret = "plain-runtime-credential-123456789"
    engine.write_json(
        engine.conf_path(),
        {
            "engine": {"kind": "s2", "s2_key": secret},
            "relay_token": "plain-relay-token-123456789",
        },
    )
    engine.RELAY_LAST.update({"error": "upstream echoed " + secret})

    with TestClient(engine.app) as client:
        response = client.get("/v1/relay/status")

    assert response.status_code == 200
    assert secret not in response.text
    assert "凭据" in response.text or "API Key" in response.text


def test_untrusted_browser_origin_cannot_read_or_mutate_desktop_engine(engine):
    with TestClient(engine.app) as client:
        response = client.get(
            "/v1/providers",
            headers={"Origin": "https://evil.example"},
        )

    assert response.status_code == 403
    assert "access-control-allow-origin" not in response.headers


def test_localhost_subdomain_origin_allowed_but_lookalike_rejected(engine):
    # 新前端是 ES module:规范规定 module 脚本一律按 CORS 抓取,同源也带 Origin,
    # 所以 tauri.localhost:端口 必须能过闸;而「以 localhost 开头的外网域」仍要拒——
    # *.localhost 整族恒为回环(RFC 6761),localhost.evil.example 不是。
    with TestClient(engine.app) as client:
        ok = client.get("/v1/health", headers={"Origin": "http://tauri.localhost:18893"})
        bad = client.get("/v1/health", headers={"Origin": "http://localhost.evil.example"})
    assert ok.status_code == 200
    assert bad.status_code == 403


def test_tauri_origin_remains_allowed(engine):
    with TestClient(engine.app) as client:
        response = client.get(
            "/v1/health",
            headers={"Origin": "tauri://localhost"},
        )

    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "tauri://localhost"
