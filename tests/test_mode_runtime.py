from fastapi.testclient import TestClient


def _config(model):
    return {
        "engine": {
            "kind": "s2",
            "s2_base_url": "https://gateway.invalid/v1",
            "s2_key": "runtime-test-key",
            "s2_model": model,
            "s2_verify_ssl": True,
        }
    }


def test_probe_cache_is_scoped_to_effective_mode(engine, monkeypatch):
    assert hasattr(engine, "oc_config_fingerprint")
    calls = []
    monkeypatch.setattr(engine, "oc_probe", lambda: (calls.append(1) or True, ""))
    engine.write_json(engine.conf_path(), _config("senseaudio-s2"))
    assert engine.oc_probe_once()[0]
    assert engine.oc_probe_once()[0]
    assert len(calls) == 1

    engine.write_json(engine.conf_path(), _config("deepseek-v4-flash"))
    assert engine.oc_probe_once()[0]
    assert len(calls) == 2


def test_running_task_rejects_global_mode_switch(engine):
    engine.write_json(engine.conf_path(), _config("senseaudio-s2"))
    engine.RUNNING.add("job-1")
    with TestClient(engine.app) as client:
        response = client.put(
            "/v1/agent",
            json={"kind": "s2", "s2_model": "deepseek-v4-flash", "s2_key": ""},
        )
    assert response.status_code == 409
    assert engine.s2_conf()["model"] == "senseaudio-s2"


def test_paused_session_also_rejects_global_mode_switch(engine, job):
    engine.write_json(engine.conf_path(), _config("senseaudio-s2"))
    meta = engine.read_json(str(job / "任务.json"), {})
    meta.update({"paused": True, "oc_session": "session-paused"})
    engine.write_json(str(job / "任务.json"), meta)
    with TestClient(engine.app) as client:
        response = client.put(
            "/v1/agent",
            json={"kind": "s2", "s2_model": "deepseek-v4-flash", "s2_key": ""},
        )
    assert response.status_code == 409
    assert engine.s2_conf()["model"] == "senseaudio-s2"


def test_stopped_but_resumable_session_rejects_global_mode_switch(engine, job):
    engine.write_json(engine.conf_path(), _config("senseaudio-s2"))
    meta = engine.read_json(str(job / "任务.json"), {})
    meta.update({"paused": False, "oc_session": "session-stopped"})
    engine.write_json(str(job / "任务.json"), meta)
    engine.write_json(
        str(job / "outcome.json"),
        {"state": "stopped", "reason": "synthetic interruption"},
    )
    with TestClient(engine.app) as client:
        response = client.put(
            "/v1/agent",
            json={"kind": "s2", "s2_model": "deepseek-v4-flash", "s2_key": ""},
        )
    assert response.status_code == 409
    assert engine.s2_conf()["model"] == "senseaudio-s2"


def test_launch_snapshots_model_without_secret(engine, job, monkeypatch):
    engine.write_json(engine.conf_path(), _config("senseaudio-s2"))
    monkeypatch.setattr(engine, "config_agent_cmd", lambda: "")
    monkeypatch.setattr(engine.threading.Thread, "start", lambda _self: None)

    engine._launch_job("job-1", str(job), mock="1")

    meta = engine.read_json(str(job / "任务.json"), {})
    snapshot = meta.get("engine_snapshot") or {}
    assert snapshot.get("model") == "senseaudio-s2"
    assert "key" not in " ".join(snapshot).lower()
    assert "runtime-test-key" not in str(snapshot)


def _prepare_oc_run(engine, monkeypatch):
    monkeypatch.setattr(engine, "oc_serve", lambda: "http://127.0.0.1:1")
    monkeypatch.setattr(engine, "oc_session", lambda *_args: "session-1")
    monkeypatch.setattr(engine, "oc_probe_once", lambda: (True, ""))
    monkeypatch.setattr(engine, "oc_send", lambda *_args, **_kwargs: (True, {}))
    monkeypatch.setattr(engine, "oc_watch", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(engine.time, "sleep", lambda _seconds: None)


def test_oc_run_error_never_reports_success(engine, job, monkeypatch):
    _prepare_oc_run(engine, monkeypatch)
    monkeypatch.setattr(engine, "oc_turn", lambda _sid: (True, "synthetic stream failure"))
    assert engine.oc_run(str(job), "work") == "interrupted"


def test_oc_run_stall_never_reports_success(engine, job, monkeypatch):
    _prepare_oc_run(engine, monkeypatch)
    monkeypatch.setattr(engine, "OC_STALL", 0)
    monkeypatch.setattr(engine, "oc_turn", lambda _sid: (False, ""))
    assert engine.oc_run(str(job), "work") == "interrupted"


def test_oc_run_only_succeeds_after_clean_finish(engine, job, monkeypatch):
    _prepare_oc_run(engine, monkeypatch)
    monkeypatch.setattr(engine, "OC_QUIET", 0)
    monkeypatch.setattr(engine, "oc_turn", lambda _sid: (True, ""))
    assert engine.oc_run(str(job), "work") == "completed"


def test_interrupted_server_run_is_never_replayed_from_scratch(engine, job, monkeypatch):
    cli_calls = []
    settle_calls = []
    monkeypatch.setattr(engine, "oc_run", lambda *_args: "interrupted")
    monkeypatch.setattr(engine, "real_agent", lambda *_args: cli_calls.append(1))
    monkeypatch.setattr(engine, "settle", lambda *_args, **kwargs: settle_calls.append(kwargs) or {"state": "stopped"})

    engine.agent_via_server_or_cli(str(job), "work", ["synthetic-cli"])

    assert cli_calls == []
    assert settle_calls and "中断" in settle_calls[-1].get("stop_reason", "")
