import io

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


def test_windows_redirected_stdio_is_reconfigured_to_utf8(engine, monkeypatch):
    raw = io.BytesIO()
    redirected = io.TextIOWrapper(raw, encoding="cp1252", errors="strict")
    monkeypatch.setattr(engine.sys, "stdout", redirected)

    engine._configure_stdio_utf8()
    print("[中标狗] 引擎启动", file=engine.sys.stdout, flush=True)

    assert raw.getvalue().decode("utf-8") == "[中标狗] 引擎启动\n"


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
    assert engine._reserve_running("job-1")
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


def test_stopped_session_does_not_block_the_default_mode_for_new_jobs(engine, job):
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
    assert response.status_code == 200
    assert engine.s2_conf()["model"] == "deepseek-v4-flash"


def test_stopped_session_cannot_resume_after_its_model_was_changed(engine, job, monkeypatch):
    engine.write_json(engine.conf_path(), _config("deepseek-v4-flash"))
    meta = engine.read_json(str(job / "任务.json"), {})
    meta.update({
        "paused": False,
        "oc_session": "session-stopped",
        "engine_snapshot": {"model": "senseaudio-s2"},
    })
    engine.write_json(str(job / "任务.json"), meta)
    engine.write_json(str(job / "outcome.json"), {"state": "stopped", "reason": "synthetic interruption"})
    monkeypatch.setattr(engine, "oc_serve", lambda: (_ for _ in ()).throw(
        AssertionError("模型不一致时不应启动旧会话")))

    with TestClient(engine.app) as client:
        response = client.post(f"/v1/jobs/{job.name}/resume")

    assert response.status_code == 409
    assert "模式已更改" in response.json()["error"]
    assert "重跑" in response.json()["error"]


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
    assert engine.oc_run(str(job), "work", allow_cli_fallback=False) == "interrupted"


def test_user_stop_wins_over_a_late_provider_interruption(engine, job, monkeypatch):
    _prepare_oc_run(engine, monkeypatch)
    owner = engine._reserve_running(job.name)
    assert owner

    def interrupted_after_stop(_sid):
        assert engine._request_cancel(job.name, owner)
        return True, "Provider turn interrupted"

    monkeypatch.setattr(engine, "oc_turn", interrupted_after_stop)
    try:
        result = engine.oc_run(str(job), "work")
    finally:
        engine._release_running(job.name, owner)

    assert result == engine.OC_RUN_CANCELLED
    runtime = engine.read_json(str(job / "runtime.json"), {})
    assert runtime.get("execution_path") != "cli_compat"


def test_oc_run_stall_never_reports_success(engine, job, monkeypatch):
    _prepare_oc_run(engine, monkeypatch)
    monkeypatch.setattr(engine, "OC_STALL", 0)
    monkeypatch.setattr(engine, "oc_turn", lambda _sid: (False, ""))
    assert engine.oc_run(str(job), "work", allow_cli_fallback=False) == "interrupted"


def test_oc_run_only_succeeds_after_clean_finish(engine, job, monkeypatch):
    _prepare_oc_run(engine, monkeypatch)
    monkeypatch.setattr(engine, "OC_QUIET", 0)
    monkeypatch.setattr(engine, "oc_turn", lambda _sid: (True, ""))
    assert engine.oc_run(str(job), "work") == "completed"


def test_interrupted_server_run_is_never_replayed_from_scratch(engine, job, monkeypatch):
    cli_calls = []
    settle_calls = []
    monkeypatch.setattr(engine, "oc_run", lambda *_args: "interrupted")
    monkeypatch.setattr(engine, "ensure_default_shell", lambda *_args, **_kwargs: (True, "ready"))
    monkeypatch.setattr(engine, "real_agent", lambda *_args: cli_calls.append(1))
    monkeypatch.setattr(engine, "settle", lambda *_args, **kwargs: settle_calls.append(kwargs) or {"state": "stopped"})

    engine.agent_via_server_or_cli(str(job), "work", ["synthetic-cli"])

    assert cli_calls == []
    assert settle_calls and "中断" in settle_calls[-1].get("stop_reason", "")


def test_clean_exit_stops_detached_opencode_server(engine, monkeypatch):
    class FakeProcess:
        pid = 12345

        @staticmethod
        def poll():
            return None

    proc = FakeProcess()
    detached = FakeProcess()
    killed = []
    exited = []
    engine.OC.update(
        {
            "proc": proc,
            "port": 9123,
            "base": "http://127.0.0.1:9123",
            "pw": "synthetic-password",
            "fingerprint": "synthetic-fingerprint",
        }
    )
    engine.DETACHED_CHILDREN[id(detached)] = detached
    monkeypatch.setattr(engine, "kill_tree", lambda target: killed.append(target))
    monkeypatch.setattr(engine.os, "_exit", lambda code: exited.append(code))

    engine._exit_process_cleanly()

    assert killed == [detached, proc]
    assert exited == [0]
    assert engine.OC == {"proc": None, "port": 0, "base": "", "pw": "", "fingerprint": ""}


def test_shutdown_rejects_new_launches_until_desktop_reconnects(engine, monkeypatch):
    scheduled = []
    monkeypatch.setattr(
        engine, "_schedule_clean_exit",
        lambda generation, delay: scheduled.append((generation, delay)),
    )

    result = engine.shutdown()

    assert result["exiting"] is True
    assert scheduled and scheduled[-1][1] == 0.3
    assert engine._reserve_running("late-job") is None

    engine.health()
    owner = engine._reserve_running("late-job")
    assert owner
    assert engine._release_running("late-job", owner) is True


def test_stale_shutdown_generation_cannot_exit_after_health_reconnect(engine, monkeypatch):
    exits = []
    monkeypatch.setattr(engine, "_exit_process_cleanly", lambda: exits.append(1))
    with engine.RUNNING_LOCK:
        engine.SHUTDOWN_GENERATION = 7
        engine.SHUTTING_DOWN = True
        engine.HOST_GONE = True

    response = engine.health()

    assert response["ok"] is True
    assert engine._exit_if_shutdown(7) is False
    assert exits == []


def test_shutdown_waits_for_job_control_before_exit_commit(engine, monkeypatch):
    exits = []
    monkeypatch.setattr(engine, "_exit_process_cleanly", lambda: exits.append(1))
    control, owner = engine._begin_job_control("job-being-deleted")
    assert control and owner is None
    with engine.RUNNING_LOCK:
        engine.SHUTDOWN_GENERATION = 11
        engine.SHUTTING_DOWN = True
        engine.HOST_GONE = True

    assert engine._exit_if_shutdown(11) is False
    assert exits == []

    engine._end_job_control("job-being-deleted", control)
    assert engine._exit_if_shutdown(11) is True
    assert exits == [1]


def test_shutdown_waits_for_skill_evidence_replay_before_exit_commit(engine, monkeypatch):
    exits = []
    monkeypatch.setattr(engine, "_exit_process_cleanly", lambda: exits.append(1))
    with engine.RUNNING_LOCK:
        engine.SHUTDOWN_GENERATION = 12
        engine.SHUTTING_DOWN = True
        engine.HOST_GONE = True
        engine.OC_REPLAYING = True

    assert engine._exit_if_shutdown(12) is False
    assert exits == []

    engine._end_oc_replay()
    assert engine._exit_if_shutdown(12) is True
    assert exits == [1]


def test_job_control_and_skill_replay_are_mutually_exclusive_in_both_orders(engine):
    control, _owner = engine._begin_job_control("job-1")
    assert control
    assert engine._begin_oc_replay() is False
    engine._end_job_control("job-1", control)

    assert engine._begin_oc_replay() is True
    blocked_control, blocked_owner = engine._begin_job_control("job-1")
    assert blocked_control is None
    assert blocked_owner is None
    engine._end_oc_replay()


def test_irreversible_exit_rejects_new_job_control(engine):
    with engine.RUNNING_LOCK:
        engine.EXITING = True

    control, owner = engine._begin_job_control("job-1")

    assert control is None
    assert owner is None
