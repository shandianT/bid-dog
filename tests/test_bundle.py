import io
import json
import re
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient


def _runtime_key():
    return "s" + "k-" + ("B" * 32)


def test_diagnostic_bundle_contains_evidence_and_redacts_every_key(engine, job):
    secret = _runtime_key()
    plain_secret = "plain-provider-credential-123456789"
    custom_secret = "plain-custom-command-secret-123456789"
    engine.write_json(
        engine.conf_path(),
        {
            "engine": {
                "kind": "s2",
                "s2_key": secret,
                "cmd": "runner --credential " + custom_secret,
                "env": "API_KEY=" + custom_secret,
            },
            "providers": [
                {"id": "p1", "api_key": plain_secret,
                 "base_url": "https://user:pass@example.invalid/v1?token=query-secret"}
            ],
            "relay_token": "local-token-that-must-also-be-redacted",
        },
    )
    (job / "run.log").write_text(
        "\n".join(["API_KEY=" + custom_secret, "provider=" + plain_secret]
                  + ["LOG-%03d" % i for i in range(600)]),
        encoding="utf-8",
    )
    engine.RELAY_LAST.update({"error": "echoed " + plain_secret})

    with TestClient(engine.app) as client:
        response = client.get("/v1/jobs/job-1/bundle")

    assert response.status_code == 200
    assert "zip" in response.headers.get("content-type", "").lower()
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    names = {Path(name).name for name in archive.namelist() if not name.endswith("/")}
    assert {"events.jsonl", "run.log", "任务.json", "progress.json"} <= names
    assert any("config" in name.lower() or "配置" in name for name in names)
    assert any(
        marker in name.lower()
        for name in names
        for marker in ("system", "engine", "environment", "环境", "引擎")
    )

    combined = b"\n".join(archive.read(name) for name in archive.namelist() if not name.endswith("/"))
    assert secret.encode("utf-8") not in combined
    assert plain_secret.encode("utf-8") not in combined
    assert custom_secret.encode("utf-8") not in combined
    assert b"local-token-that-must-also-be-redacted" not in combined
    assert b"user:pass" not in combined
    assert b"query-secret" not in combined
    assert b"https://example.invalid/v1" in combined
    assert re.search(rb"sk-[A-Za-z0-9]{20,}", combined) is None


def test_bundle_uses_only_tail_500_log_lines(engine, job):
    lines = ["LINE-%03d" % index for index in range(650)]
    (job / "run.log").write_text("\n".join(lines), encoding="utf-8")

    with TestClient(engine.app) as client:
        response = client.get("/v1/jobs/job-1/bundle")

    assert response.status_code == 200
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    log_name = next(name for name in archive.namelist() if Path(name).name == "run.log")
    exported = archive.read(log_name).decode("utf-8").splitlines()
    assert 1 <= len(exported) <= 500
    assert exported[-1] == lines[-1]
    assert lines[0] not in exported


def test_missing_job_bundle_is_404(engine):
    with TestClient(engine.app) as client:
        response = client.get("/v1/jobs/not-there/bundle")

    assert response.status_code == 404


def test_desktop_bundle_save_writes_zip_and_reveals_it(engine, job, monkeypatch):
    opened = []
    monkeypatch.setattr(engine, "_open_local", lambda path, reveal=False: opened.append((path, reveal)))
    with TestClient(engine.app) as client:
        response = client.post("/v1/jobs/job-1/bundle/save")
    assert response.status_code == 200
    saved = Path(response.json()["path"])
    assert saved.is_file()
    assert zipfile.is_zipfile(saved)
    assert opened == [(str(saved), True)]


def test_desktop_release_opener_is_allowlisted(engine, monkeypatch):
    opened = []
    monkeypatch.setattr(engine, "_open_local", lambda path, reveal=False: opened.append(path))
    with TestClient(engine.app) as client:
        bad = client.post("/v1/open_release", json={"url": "https://example.invalid/phish"})
        good = client.post(
            "/v1/open_release",
            json={"url": "https://github.com/shandianT/bid-dog/releases/tag/desktop-v0.18.2"},
        )
    assert bad.status_code == 400
    assert good.status_code == 200
    assert opened == ["https://github.com/shandianT/bid-dog/releases/tag/desktop-v0.18.2"]
