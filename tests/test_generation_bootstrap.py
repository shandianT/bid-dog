from pathlib import Path

from conftest import events


def test_default_generation_preflight_checks_opencode_without_sowork(engine, job, monkeypatch):
    checked = []

    def resolve(name, _eng=None):
        checked.append(name)
        return None

    monkeypatch.setattr(engine, "resolve_cli", resolve)
    conf = {"engine": {"kind": "s2", "s2_key": "test-key"}}

    result = engine.generation_preflight(str(job), conf)

    assert checked == ["opencode"]
    assert result["ok"] is False
    assert result["repair"] == "opencode"
    assert result["checks"][-1]["id"] == "runtime"
    assert result["checks"][-1]["status"] == "repairing"


def test_missing_default_shell_repairs_inside_job_and_rechecks_path(engine, job, monkeypatch):
    state = {"ready": False, "provisioned": []}

    def resolve(name, _eng=None):
        assert name == "opencode"
        return "/tmp/opencode-cli" if state["ready"] else None

    def provision(which):
        state["provisioned"].append(which)
        state["ready"] = True
        engine.PROV.update({"state": "done", "pct": 100, "note": "已安装并校验", "error": ""})

    monkeypatch.setattr(engine, "resolve_cli", resolve)
    monkeypatch.setattr(engine, "_provision_codex", provision)
    engine.PROV.update({"state": "idle", "pct": 0, "note": "", "error": ""})

    ok, note = engine.ensure_default_shell(str(job), {"kind": "s2"})

    assert ok is True
    assert state["provisioned"] == ["opencode"]
    assert "已就绪" in note
    worklog = [line for event in events(job) if event.get("type") == "worklog" for line in event["lines"]]
    assert any("修复生成组件" in line for line in worklog)
    assert any("生成组件已就绪" in line for line in worklog)


def test_launch_reports_environment_preparation_before_business_step_one(engine, tmp_path, monkeypatch):
    job = Path(engine.jpath("preflight-job"))
    job.mkdir(parents=True)
    (job / "采购文件.md").write_text("# 采购文件\n", encoding="utf-8")
    engine.write_json(str(job / "任务.json"), {"name": "预检任务", "tender": "采购文件.md", "staged": True})
    engine.write_json(engine.conf_path(), {"engine": {"kind": "s2", "s2_key": ""}})
    started = []
    monkeypatch.setattr(engine, "_start_reserved_worker", lambda *args: started.append(args))

    result = engine._launch_job("preflight-job", str(job), "auto")

    assert result["mode"] == "mock"
    progress = [event for event in events(job) if event.get("type") == "progress"]
    assert progress[-1]["step"] == 0
    assert progress[-1]["stage"] == "正在检查生成环境"
    assert started


def test_diagnostics_exposes_preflight_shell_source_and_repair_state(engine, job, monkeypatch):
    shell = "/managed/data/bin/opencode-cli"
    monkeypatch.setattr(engine, "resolve_cli", lambda name, _eng=None: shell if name == "opencode" else None)
    engine.write_json(engine.conf_path(), {"engine": {"kind": "s2", "s2_key": "test-key"}})
    engine.write_json(str(job / "preflight.json"), {
        "phase": "environment", "repair": "opencode", "checked_at": "2026-08-20T12:00:00",
        "checks": [{"id": "runtime", "status": "repairing", "message": "正在修复"}],
    })
    engine.PROV.update({"state": "running", "which": "opencode", "pct": 42,
                        "note": "正在下载", "path": "", "error": ""})

    result = engine._diagnostic_snapshot("job-1")

    assert result["runtime_source"] == shell
    assert result["provision"] == {"state": "running", "which": "opencode", "pct": 42,
                                    "note": "正在下载", "error": ""}
    assert result["job"]["preflight"]["repair"] == "opencode"
    assert result["job"]["last_activity"]


def test_job_flow_expands_environment_preflight_before_business_steps(engine, job):
    preflight = {
        "phase": "environment",
        "checked_at": "2026-08-21T09:00:00",
        "checks": [
            {"id": "storage", "label": "任务目录", "status": "pass", "message": "任务文件可以保存"},
            {"id": "skill", "label": "写作规则", "status": "pass", "message": "写作规则已就绪"},
            {"id": "connection", "label": "模型连接", "status": "pending", "message": "正在建立连接"},
            {"id": "runtime", "label": "生成组件", "status": "repairing", "message": "正在自动修复"},
        ],
    }
    engine.write_json(str(job / "preflight.json"), preflight)
    progress = {"type": "progress", "step": 0, "total": 12, "pct": 1,
                "stage": "正在修复生成组件", "ts": "2026-08-21T09:00:01"}

    flow = engine.job_flow(str(job), "running", {}, progress, {})

    assert flow["version"] == 2
    assert flow["current_phase"] == "environment"
    assert flow["checkpoint"] == {"step": 0, "label": "任务文件已保存"}
    assert flow["recoverable"] is True
    assert [phase["id"] for phase in flow["phases"]] == [
        "environment", "parse", "plan", "write", "assemble", "deliver"
    ]
    environment = flow["phases"][0]
    assert environment["state"] == "active"
    assert environment["evidence"] == "preflight.json"
    assert [check["state"] for check in environment["checks"]] == [
        "done", "done", "active", "active"
    ]


def test_job_flow_uses_verified_business_checkpoint_and_keeps_interrupted_job_recoverable(engine, job):
    progress = engine.read_json(str(job / "progress.json"), {})
    outcome = {"state": "stopped", "reason": "上游连接中断", "ts": "2026-08-21T09:10:00"}
    engine.write_json(str(job / "outcome.json"), outcome)

    flow = engine.job_flow(str(job), "stopped", {"oc_session": "session-1"}, progress, outcome)

    assert flow["current_phase"] == "parse"
    assert flow["checkpoint"]["step"] == 1
    assert flow["checkpoint"]["label"] == "体检素材"
    assert flow["recoverable"] is True
    assert flow["phases"][0]["state"] == "done"
    assert flow["phases"][1]["state"] == "attention"
    assert flow["phases"][1]["detail"] == "上游连接中断"


def test_job_listing_and_diagnostics_share_the_same_persisted_flow(engine, job, monkeypatch):
    monkeypatch.setattr(engine, "resolve_cli", lambda *_args, **_kwargs: "/managed/opencode-cli")
    listed = engine.list_jobs()
    diagnostic = engine._diagnostic_snapshot("job-1")

    assert listed[0]["flow"]["checkpoint"]["step"] == 1
    assert diagnostic["job"]["flow"] == listed[0]["flow"]
