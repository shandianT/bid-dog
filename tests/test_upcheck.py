import time

from fastapi.testclient import TestClient

from fakes.fake_upstream import LocalJsonServer


def test_new_release_is_fetched_async_and_exposed_by_health(fresh_engine):
    path = "/repos/shandianT/bid-dog/releases/latest"
    release = {
        "tag_name": "desktop-v9.9.9",
        "html_url": "https://github.com/shandianT/bid-dog/releases/tag/desktop-v9.9.9",
    }
    with LocalJsonServer({path: (200, release), "/release_policy.json": (404, {})}) as upstream:
        engine = fresh_engine(
            BID_NO_UPDATE_CHECK="0",
            BIDDOG_RELEASES_URL=upstream.base_url + path,
            BIDDOG_POLICY_URL=upstream.base_url + "/release_policy.json",
        )
        with TestClient(engine.app) as client:
            deadline = time.monotonic() + 3
            health = {}
            while time.monotonic() < deadline:
                health = client.get("/v1/health").json()
                if (health.get("update") or {}).get("status") == "available":
                    break
                time.sleep(0.05)

    update = health.get("update") or {}
    assert update.get("status") == "available"
    assert update.get("latest") == "9.9.9"
    assert update.get("url") == release["html_url"]
    assert upstream.requests


def test_offline_release_check_never_delays_or_surfaces_an_error(fresh_engine, free_tcp_port):
    started = time.monotonic()
    engine = fresh_engine(
        BID_NO_UPDATE_CHECK="0",
        BIDDOG_RELEASES_URL="http://127.0.0.1:%d/releases/latest" % free_tcp_port,
        BIDDOG_POLICY_URL="http://127.0.0.1:%d/release_policy.json" % free_tcp_port,
        BIDDOG_UPDATE_TIMEOUT="0.1",
    )
    imported_in = time.monotonic() - started

    with TestClient(engine.app) as client:
        started = time.monotonic()
        health = client.get("/v1/health").json()
        health_in = time.monotonic() - started

    assert imported_in < 1.5
    assert health_in < 0.5
    assert "traceback" not in str(health).lower()
    assert not (health.get("update") or {}).get("error")


def test_release_policy_is_preferred_and_persisted(fresh_engine):
    policy = {
        "latest": "9.9.8",
        "url": "https://bid-dog.vercel.app/download",
        "minimum_supported": "0.19.0",
        "sunset": "2099-01-01",
    }
    with LocalJsonServer({"/release_policy.json": (200, policy)}) as upstream:
        engine = fresh_engine(
            BID_NO_UPDATE_CHECK="0",
            BIDDOG_POLICY_URL=upstream.base_url + "/release_policy.json",
            BIDDOG_RELEASES_URL=upstream.base_url + "/never-called",
        )
        with TestClient(engine.app) as client:
            deadline = time.monotonic() + 3
            health = {}
            while time.monotonic() < deadline:
                health = client.get("/v1/health").json()
                if (health.get("update") or {}).get("status") == "available":
                    break
                time.sleep(0.05)

    update = health.get("update") or {}
    assert update.get("status") == "available"
    assert update.get("latest") == "9.9.8"
    assert update.get("source") == "policy"
    cached = engine.read_json(engine._policy_cache_path(), {})
    assert cached.get("latest") == "9.9.8"
    assert cached.get("minimum_supported") == "0.19.0"
    assert cached.get("checked_at")


def test_version_gate_blocks_only_expired_and_only_new_generation(engine, monkeypatch):
    monkeypatch.setenv("BID_NO_UPDATE_CHECK", "0")
    # 无策略、源码运行:一切正常
    assert engine.version_gate()["mode"] == "ok"
    # 低于最低支持版、限期未到:强提示但放行
    engine.write_json(engine._policy_cache_path(), {
        "latest": "99.0.0", "minimum_supported": "99.0.0",
        "sunset": "2099-01-01", "checked_at": engine.now()})
    assert engine.version_gate()["mode"] == "required"
    with TestClient(engine.app) as client:
        response = client.post("/v1/jobs",
                               files={"tender": ("招标.md", b"# t", "text/markdown")},
                               data={"start": "0", "name": "required-ok"})
        assert response.status_code == 200
    # 过期:开新单被 426 拦下,已有内容的查看/导出不受影响
    engine.write_json(engine._policy_cache_path(), {
        "latest": "99.0.0", "minimum_supported": "99.0.0",
        "sunset": "2000-01-01", "checked_at": engine.now()})
    assert engine.version_gate()["mode"] == "expired"
    with TestClient(engine.app) as client:
        response = client.post("/v1/jobs",
                               files={"tender": ("招标.md", b"# t", "text/markdown")},
                               data={"start": "0", "name": "expired-blocked"})
        assert response.status_code == 426
        body = response.json()
        assert body["code"] == "version_sunset" and body["action"] == "update"
        assert client.get("/v1/jobs").status_code == 200          # 只读一切照旧
        health = client.get("/v1/health").json()
        assert health["version_gate"]["mode"] == "expired"
    # 运维开关可一键解除
    monkeypatch.setenv("BIDDOG_NO_SUNSET", "1")
    assert engine.version_gate()["mode"] == "ok"


def test_build_sunset_expires_unpoliced_packaged_builds(engine, monkeypatch):
    monkeypatch.setenv("BID_NO_UPDATE_CHECK", "0")
    monkeypatch.setenv("BIDDOG_FORCE_SUNSET", "1")
    monkeypatch.setattr(engine, "BUILD_SUNSET", "2000-01-01")
    # 打包构建过了保质期、又从未取到策略:停开新单
    assert engine.version_gate()["mode"] == "expired"
    # 任何一次成功的策略拉取(且未被列为过低版本)即恢复:服务端可远程续期
    engine.write_json(engine._policy_cache_path(),
                      {"latest": engine.ENGINE_VERSION, "checked_at": engine.now()})
    assert engine.version_gate()["mode"] == "ok"
