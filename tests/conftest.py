import atexit
import importlib.util
import os
import shutil
import sys
import tempfile
import uuid
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
_BOOTSTRAP_HOME = tempfile.mkdtemp(prefix="bid-dog-tests-")
atexit.register(shutil.rmtree, _BOOTSTRAP_HOME, True)
os.environ.setdefault("BID_HOME", _BOOTSTRAP_HOME)
os.environ.setdefault("BID_NO_UPDATE_CHECK", "1")
sys.path.insert(0, str(ROOT / "server"))

import engine_v1 as _engine  # noqa: E402


@pytest.fixture
def engine(tmp_path, monkeypatch):
    monkeypatch.setattr(_engine, "DATA", str(tmp_path))
    _engine.RUNNING.clear()
    _engine.SHUTTING_DOWN = False
    _engine.EXITING = False
    _engine.OC_REPLAYING = False
    _engine.JOB_CONTROL.clear()
    _engine.SHUTDOWN_GENERATION = 0
    if getattr(_engine, "_EXIT_TIMER", [None])[0]:
        _engine._EXIT_TIMER[0].cancel()
        _engine._EXIT_TIMER[0] = None
    _engine.CANCEL.clear()
    if hasattr(_engine, "TERMINAL_OWNERS"):
        _engine.TERMINAL_OWNERS.clear()
    _engine.PROCS.clear()
    _engine.PROC_OWNERS.clear()
    _engine.DETACHED_CHILDREN.clear()
    _engine.RELAY_LAST.clear()
    if hasattr(_engine, "PIPELINE_SESSIONS"):
        _engine.PIPELINE_SESSIONS.clear()
    _engine.OC.update({"proc": None, "port": 0, "base": "", "pw": ""})
    if hasattr(_engine, "_OC_PROBED"):
        _engine._OC_PROBED.update({"ok": False, "why": "", "ts": 0.0})
    return _engine


@pytest.fixture
def fresh_engine(tmp_path, monkeypatch):
    """Import an isolated engine module after applying test-only environment.

    Startup behavior (for example the asynchronous release check) cannot be
    tested by mutating the already-imported singleton.  This factory gives each
    call its own BID_HOME and module globals without starting a real server.
    """

    created = []

    def load(**environment):
        data = tmp_path / ("fresh-" + uuid.uuid4().hex)
        data.mkdir(parents=True)
        monkeypatch.setenv("BID_HOME", str(data))
        monkeypatch.setenv("BID_WEB_DIR", str(ROOT / "app" / "src"))
        for key, value in environment.items():
            monkeypatch.setenv(key, str(value))
        name = "bid_dog_engine_test_" + uuid.uuid4().hex
        spec = importlib.util.spec_from_file_location(name, ROOT / "server" / "engine_v1.py")
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        assert spec.loader is not None
        spec.loader.exec_module(module)
        created.append(name)
        return module

    yield load

    for name in created:
        sys.modules.pop(name, None)


@pytest.fixture
def job(engine, tmp_path):
    path = tmp_path / "jobs" / "job-1"
    path.mkdir(parents=True)
    (path / "招标文件.docx").write_bytes(b"tender")
    engine.write_json(
        str(path / "任务.json"),
        {"name": "测试任务", "tender": "招标文件.docx", "created_at": engine.now()},
    )
    engine.emit(
        str(path),
        {"type": "progress", "stage": "已派发", "pct": 2, "step": 1, "total": 12},
    )
    return path


def events(path):
    out = []
    p = Path(path) / "events.jsonl"
    if not p.exists():
        return out
    for line in p.read_text(encoding="utf-8").splitlines():
        if line.strip():
            import json

            out.append(json.loads(line))
    return out
