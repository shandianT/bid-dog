import time

from fastapi.testclient import TestClient

from fakes.fake_upstream import LocalJsonServer


def test_new_release_is_fetched_async_and_exposed_by_health(fresh_engine):
    path = "/repos/shandianT/bid-dog/releases/latest"
    release = {
        "tag_name": "desktop-v9.9.9",
        "html_url": "https://github.com/shandianT/bid-dog/releases/tag/desktop-v9.9.9",
    }
    with LocalJsonServer({path: (200, release)}) as upstream:
        engine = fresh_engine(
            BID_NO_UPDATE_CHECK="0",
            BIDDOG_RELEASES_URL=upstream.base_url + path,
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
