import asyncio
import json
import threading

from fastapi.testclient import TestClient


def _session_meta(engine, job, **changes):
    path = job / "任务.json"
    meta = engine.read_json(str(path), {})
    meta.update(changes)
    engine.write_json(str(path), meta)
    return meta


def test_crash_recovered_job_with_session_can_continue(engine, job):
    meta = _session_meta(engine, job, oc_session="session-after-restart", paused=False)
    engine.write_json(str(job / "progress.json"), {
        "type": "progress", "stage": "读取招标文件", "pct": 12, "step": 2, "total": 12,
    })

    assert engine.job_state(str(job), meta) == "unknown"
    assert "resume" in engine.job_can(str(job), "unknown", meta)


def test_stopping_a_paused_session_releases_its_model_lock(engine, job):
    _session_meta(engine, job, oc_session="session-paused", paused=True)

    with TestClient(engine.app) as client:
        response = client.post(f"/v1/jobs/{job.name}/stop")

    assert response.status_code == 200
    meta = engine.read_json(str(job / "任务.json"), {})
    assert meta.get("paused") is False
    assert job.name not in engine.config_locked_jobs()
    assert engine.read_json(str(job / "outcome.json"), {}).get("state") == "stopped"


def test_stop_during_resume_preflight_never_starts_a_worker(engine, job, monkeypatch):
    _session_meta(
        engine,
        job,
        oc_session="session-resume",
        paused=True,
        engine_snapshot={"model": engine.s2_conf()["model"]},
    )
    started = []

    def stop_while_reconnecting():
        stopped = engine.stop_job(job.name)
        assert stopped["ok"] is True
        return "http://127.0.0.1:18999"

    monkeypatch.setattr(engine, "oc_serve", stop_while_reconnecting)
    monkeypatch.setattr(engine, "oc_api", lambda *_args, **_kwargs: (200, {"id": "session-resume"}))
    monkeypatch.setattr(engine, "_start_reserved_worker", lambda *_args: started.append(_args))

    with TestClient(engine.app) as client:
        response = client.post(f"/v1/jobs/{job.name}/resume")

    assert response.status_code == 409
    assert started == []
    assert engine.read_json(str(job / "任务.json"), {}).get("paused") is False
    assert engine.read_json(str(job / "outcome.json"), {}).get("state") == "stopped"


def test_resume_rejects_a_different_provider_session_identity(engine, job, monkeypatch):
    conf = engine.read_json(engine.conf_path(), {})
    snapshot = {
        "model": engine.s2_conf(conf)["model"],
        "runtime_fingerprint": "previous-provider-session",
    }
    _session_meta(engine, job, oc_session="session-old-provider", paused=False,
                  engine_snapshot=snapshot)
    monkeypatch.setattr(engine, "oc_config_fingerprint", lambda _conf=None: "new-provider-session")
    monkeypatch.setattr(engine, "oc_serve", lambda: (_ for _ in ()).throw(
        AssertionError("配置身份不同时不应启动旧会话")))

    with TestClient(engine.app) as client:
        response = client.post(f"/v1/jobs/{job.name}/resume")

    assert response.status_code == 409
    assert "连接配置已更改" in response.json()["error"]
    assert "重跑" in response.json()["error"]


def test_rerun_request_is_idempotent_for_the_same_session_action(engine, job, monkeypatch):
    monkeypatch.setattr(engine, "_launch_job", lambda jid, path, mode: {
        "job_id": jid, "mode": "agent",
    })
    headers = {"Idempotency-Key": "rerun-click-123"}

    with TestClient(engine.app) as client:
        first = client.post(f"/v1/jobs/{job.name}/rerun", headers=headers)
        second = client.post(f"/v1/jobs/{job.name}/rerun", headers=headers)

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["job_id"] == first.json()["job_id"]
    assert second.json().get("deduplicated") is True
    children = [p for p in job.parent.iterdir() if p.is_dir() and p != job]
    assert len(children) == 1


def test_failed_rerun_dispatch_does_not_poison_the_idempotency_session(engine, job, monkeypatch):
    calls = []

    def flaky_launch(jid, _path, _mode):
        calls.append(jid)
        if len(calls) == 1:
            raise RuntimeError("synthetic startup failure")
        return {"job_id": jid, "mode": "agent"}

    monkeypatch.setattr(engine, "_launch_job", flaky_launch)
    headers = {"Idempotency-Key": "rerun-retry-after-failure"}

    with TestClient(engine.app, raise_server_exceptions=False) as client:
        first = client.post(f"/v1/jobs/{job.name}/rerun", headers=headers)
        second = client.post(f"/v1/jobs/{job.name}/rerun", headers=headers)

    assert first.status_code == 500
    assert second.status_code == 200
    assert second.json().get("deduplicated") is not True
    children = [p for p in job.parent.iterdir() if p.is_dir() and p != job]
    assert len(children) == 1
    assert children[0].name == second.json()["job_id"]


def test_event_replay_waits_for_complete_lines_and_returns_exact_cursor(engine, job):
    event_path = job / "events.jsonl"
    first = {"type": "message", "role": "agent", "text": "complete"}
    event_path.write_text(json.dumps(first, ensure_ascii=False) + "\n{\"type\":\"message\"", encoding="utf-8")

    async def collect():
        response = engine.events(job.name, offset=0, follow=False)
        chunks = []
        async for chunk in response.body_iterator:
            chunks.append(chunk.decode() if isinstance(chunk, bytes) else chunk)
        return "".join(chunks)

    payload = asyncio.run(collect())
    data_lines = [line[6:] for line in payload.splitlines() if line.startswith("data: ")]
    assert len(data_lines) == 1
    event = json.loads(data_lines[0])
    assert event["text"] == "complete"
    assert event["_cursor"] == 1
    assert "id: 1" in payload


def test_stop_during_startup_preflight_never_dispatches_generation(engine, job, monkeypatch):
    _session_meta(engine, job, staged=True)
    started = []

    def stop_during_preflight(_job, _conf):
        stopped = engine.stop_job(job.name)
        assert stopped["ok"] is True
        return {"checks": [], "repair": False}

    monkeypatch.setattr(engine, "generation_preflight", stop_during_preflight)
    monkeypatch.setattr(engine, "config_agent_cmd", lambda: None)
    monkeypatch.setattr(engine, "_start_reserved_worker", lambda *_args: started.append(_args))

    with TestClient(engine.app) as client:
        response = client.post(f"/v1/jobs/{job.name}/start?mock=1")

    assert response.status_code == 409
    assert response.json().get("stopped") is True
    assert started == []
    assert engine.read_json(str(job / "outcome.json"), {}).get("state") == "stopped"


def test_stop_during_redo_preparation_never_dispatches_generation(engine, job, monkeypatch):
    started = []

    def stop_during_harvest(_job):
        stopped = engine.stop_job(job.name)
        assert stopped["ok"] is True

    monkeypatch.setattr(engine, "harvest", stop_during_harvest)
    monkeypatch.setattr(engine, "config_agent_cmd", lambda: None)
    monkeypatch.setattr(engine, "_start_reserved_worker", lambda *_args: started.append(_args))

    with TestClient(engine.app) as client:
        response = client.post(f"/v1/jobs/{job.name}/redo", json={"instruction": "重做第三章"})

    assert response.status_code == 409
    assert response.json().get("stopped") is True
    assert started == []
    assert engine.read_json(str(job / "outcome.json"), {}).get("state") == "stopped"


def test_failed_question_delivery_keeps_the_question_open(engine, job, monkeypatch):
    _session_meta(engine, job, oc_session="session-question", oc_questions={
        "question-1": {"session": "session-question", "text": "请确认报价"},
    })
    monkeypatch.setattr(engine, "oc_api", lambda *_args, **_kwargs: (503, {"error": "offline"}))

    with TestClient(engine.app) as client:
        response = client.post(f"/v1/jobs/{job.name}/answers", json={
            "question_id": "question-1", "choice": "暂不填报价",
        })

    assert response.status_code == 200
    assert response.json().get("ok") is False
    assert engine._pending_question_count(str(job)) == 1
    rows = [json.loads(line) for line in (job / "events.jsonl").read_text(encoding="utf-8").splitlines()]
    assert not any(row.get("type") == "question_closed" and row.get("id") == "question-1"
                   for row in rows)


def test_new_redo_generation_closes_questions_from_the_previous_session(engine, job, monkeypatch):
    engine.emit(str(job), {
        "type": "question", "id": "old-question", "text": "旧会话的问题", "options": ["是", "否"],
    })
    assert engine._pending_question_count(str(job)) == 1
    monkeypatch.setattr(engine, "config_agent_cmd", lambda: None)
    monkeypatch.setattr(engine, "_start_reserved_worker", lambda *_args: None)

    with TestClient(engine.app) as client:
        response = client.post(f"/v1/jobs/{job.name}/redo", json={"instruction": "重做第三章"})

    assert response.status_code == 200
    assert engine._pending_question_count(str(job)) == 0
    rows = [json.loads(line) for line in (job / "events.jsonl").read_text(encoding="utf-8").splitlines()]
    assert any(row.get("type") == "question_closed" and row.get("id") == "old-question"
               for row in rows)


def test_opencode_reconnect_accepts_new_only_event_streams(engine, job, monkeypatch):
    stop = threading.Event()
    calls = []

    class Stream:
        def __init__(self, lines, finish=False):
            self.lines = lines
            self.finish = finish

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def __iter__(self):
            for line in self.lines:
                yield ("data: " + json.dumps(line) + "\n").encode()
            if self.finish:
                stop.set()

    streams = [
        Stream([{"type": "reasoning.started", "properties": {}}]),
        Stream([{"type": "agent.switched", "properties": {"agent": "writer"}}], finish=True),
    ]

    def open_stream(*_args, **_kwargs):
        calls.append(1)
        return streams.pop(0)

    engine.OC.update({"base": "http://127.0.0.1:18999", "pw": ""})
    monkeypatch.setattr(engine.urllib.request, "urlopen", open_stream)
    monkeypatch.setattr(engine.time, "sleep", lambda _seconds: None)

    engine.oc_watch(str(job), "session-reconnect", stop)

    rows = [json.loads(line) for line in (job / "events.jsonl").read_text(encoding="utf-8").splitlines()]
    worklog = [text for row in rows if row.get("type") == "worklog" for text in row.get("lines", [])]
    assert calls == [1, 1]
    assert "思考中…" in worklog
    assert "切换角色:writer" in worklog
