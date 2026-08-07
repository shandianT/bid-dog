#!/usr/bin/env python3
"""Manual, secret-safe standard/fast stream probe. Not run by CI."""

import getpass
import json
import os
import ssl
import sys
import tempfile
import time
import urllib.request
from pathlib import Path


BASE = os.environ.get("BIDDOG_TEST_BASE", "https://api.senseaudio.cn/v1").rstrip("/")
MODELS = ("senseaudio-s2", "deepseek-v4-flash")


def request(path, key, payload=None, timeout=30):
    data = json.dumps(payload).encode() if payload is not None else None
    headers = {"Authorization": "Bearer " + key, "User-Agent": "bid-dog-manual-probe"}
    if data is not None:
        headers["Content-Type"] = "application/json"
        headers["Accept"] = "text/event-stream"
    req = urllib.request.Request(BASE + path, data=data, headers=headers)
    return urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context())


def probe_model(key, model):
    started = time.monotonic()
    chunks = 0
    done = False
    try:
        response = request(
            "/chat/completions",
            key,
            {"model": model, "stream": True, "max_tokens": 8,
             "messages": [{"role": "user", "content": "只回复 OK"}]},
            timeout=45,
        )
        opened_ms = round((time.monotonic() - started) * 1000)
        for raw in response:
            line = raw.strip()
            if not line.startswith(b"data:"):
                continue
            chunks += 1
            if line[5:].strip() == b"[DONE]":
                done = True
                break
        return {"model": model, "ok": done, "opened_ms": opened_ms,
                "total_ms": round((time.monotonic() - started) * 1000), "chunks": chunks,
                "complete_marker": done}
    except Exception as exc:
        return {"model": model, "ok": False,
                "total_ms": round((time.monotonic() - started) * 1000),
                "error_type": type(exc).__name__}


def probe_local_relays(key):
    """Exercise both in-app relay paths without persisting the supplied Key."""
    from fastapi.testclient import TestClient

    root = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix="bid-dog-manual-") as data_home:
        os.environ["BID_HOME"] = data_home
        os.environ["BID_NO_UPDATE_CHECK"] = "1"
        sys.path.insert(0, str(root / "server"))
        import engine_v1 as engine

        results = []
        for model in MODELS:
            upstream = {"base_url": BASE, "api_key": key, "model": model,
                        "verify_ssl": True, "wire": "auto"}
            wire = b"".join(engine._relay_stream({"input": "只回复 OK"}, upstream))
            results.append({"path": "responses-bridge", "model": model,
                            "ok": b"response.completed" in wire and b"response.failed" not in wire})

            engine.s2_conf = lambda _conf=None, value=upstream: dict(value)
            token = engine.relay_token()
            with TestClient(engine.app) as client:
                response = client.post(
                    "/v1/relay/chat/completions",
                    headers={"Authorization": "Bearer " + token},
                    json={"model": model, "stream": True, "max_tokens": 8,
                          "messages": [{"role": "user", "content": "只回复 OK"}]},
                )
            raw = response.content
            results.append({"path": "chat-passthrough", "model": model,
                            "ok": response.status_code == 200 and b"[DONE]" in raw and b'"error"' not in raw,
                            "status": response.status_code})
        return results


def main():
    key = getpass.getpass("测试 Key（不会回显或落盘）: ").strip()
    if not key:
        raise SystemExit("未输入 Key")
    report = {"base": BASE, "models_endpoint": False, "runs": []}
    try:
        response = request("/models", key, timeout=15)
        data = json.loads(response.read().decode("utf-8", "ignore"))
        available = {item.get("id") for item in (data.get("data") or [])}
        report["models_endpoint"] = True
        report["requested_models_available"] = {model: model in available for model in MODELS}
    except Exception as exc:
        report["models_error_type"] = type(exc).__name__
    for _round in range(3):
        for model in MODELS:
            report["runs"].append(probe_model(key, model))
    report["relay_runs"] = probe_local_relays(key)
    key = ""
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
