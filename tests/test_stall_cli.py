import os
import sys
import threading
import time
from pathlib import Path

from conftest import ROOT, events


def test_activity_signature_tracks_existing_outputs_but_not_control_file_churn(engine, job):
    assert hasattr(engine, "_job_activity_signature"), (
        "engine needs a deterministic _job_activity_signature(job) seam for CLI stall detection"
    )
    body = job / "投标文件_技术标.md"
    body.write_text("first", encoding="utf-8")
    baseline = engine._job_activity_signature(str(job))

    # Polling/progress persistence is engine activity, not agent progress.
    engine.write_json(str(job / "progress.json"), {"step": 1, "pct": 2})
    assert engine._job_activity_signature(str(job)) == baseline

    body.write_text("first\nsecond", encoding="utf-8")
    future_ns = time.time_ns() + 2_000_000_000
    os.utime(body, ns=(future_ns, future_ns))
    assert engine._job_activity_signature(str(job)) != baseline


def test_cli_agent_is_stopped_after_configurable_inactivity(engine, job, monkeypatch):
    monkeypatch.setenv("BIDDOG_CLI_STALL_SECONDS", "0.25")
    monkeypatch.setenv("BIDDOG_CLI_STALL_POLL", "0.05")
    monkeypatch.setattr(engine, "CLI_STALL_SECONDS", 0.25, raising=False)
    monkeypatch.setattr(engine, "CLI_STALL_POLL", 0.05, raising=False)
    monkeypatch.setattr(engine, "agent_env", lambda _eng=None: os.environ.copy())
    monkeypatch.setattr(engine, "harvest", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(engine, "ensure_docx", lambda *_args, **_kwargs: [])

    command = [sys.executable, str(ROOT / "tests" / "fakes" / "hanging_agent.py")]
    worker = threading.Thread(target=engine.real_agent, args=(str(job), command), daemon=True)
    worker.start()

    deadline = time.monotonic() + 1
    while time.monotonic() < deadline and "job-1" not in engine.PROCS:
        time.sleep(0.01)
    worker.join(timeout=2.5)
    stalled_too_long = worker.is_alive()

    # A failing red-phase test must not leave the synthetic process behind.
    if worker.is_alive():
        engine.kill_tree(engine.PROCS.get("job-1"))
        worker.join(timeout=5)

    assert not stalled_too_long, "CLI fallback ignored its inactivity gate"
    emitted = events(job)
    text = "\n".join(
        str(event.get("text") or event.get("stage") or "") for event in emitted
    )
    assert "长时间无进展" in text
    assert "STALL-TAIL-05" in text
    assert "STALL-TAIL-12" in text
    progress = engine.read_json(str(Path(job) / "progress.json"), {})
    assert progress.get("step") == 1
    assert int(progress.get("pct") or 0) < 100
