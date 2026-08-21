from pathlib import Path
import threading
import time

from fastapi.testclient import TestClient

from conftest import events


def _checkpoint_config(engine):
    conf = {"engine": {
        "kind": "s2", "s2_key": "test-key", "generation_mode": "fast",
        "s2_base_url": engine.S2_DEFAULT_BASE, "s2_model": engine.S2_DEFAULT_MODEL,
        "s2_verify_ssl": True, "s2_wire": "auto",
    }}
    conf["setup"] = {
        "model_ids": [engine.S2_DEFAULT_MODEL, engine.S2_QUALITY_MODEL],
        "text_verified_model_ids": [engine.S2_DEFAULT_MODEL, engine.S2_QUALITY_MODEL],
        "tested_connection_fingerprint": engine._connection_fingerprint(conf),
    }
    return conf


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


def test_pipeline_attempt_receives_only_declared_inputs(engine, job, tmp_path):
    engine.generation_pipeline.initialize(
        job, run_id="copy-inputs", mode="fast",
        model_routes={"fast": engine.S2_DEFAULT_MODEL, "quality": engine.S2_QUALITY_MODEL},
        chapters=[{"id": "01", "title": "项目理解", "output": "章节_01.md"}],
    )
    (job / "招标文件_解析版.md").write_text("公开解析文本", encoding="utf-8")
    (job / "你的要求.md").write_text("公开补充要求", encoding="utf-8")
    (job / "不应暴露.txt").write_text("本机秘密", encoding="utf-8")
    outside = tmp_path / "outside-secret.txt"
    outside.write_text("目录外秘密", encoding="utf-8")
    (job / "素材").mkdir()
    (job / "素材" / "允许.txt").write_text("允许素材", encoding="utf-8")
    (job / "素材" / "越界.txt").symlink_to(outside)
    target = tmp_path / "attempt"
    target.mkdir()
    node = {"id": "chapter_write:01"}

    engine._pipeline_copy_inputs(str(job), node, str(target))

    assert (target / "招标文件_解析版.md").is_file()
    assert (target / "你的要求.md").is_file()
    assert (target / "素材" / "允许.txt").is_file()
    assert not (target / "不应暴露.txt").exists()
    assert not (target / "素材" / "越界.txt").exists()


def test_dependent_chapter_copies_and_hashes_its_dependency_outputs(engine, job, tmp_path):
    engine.generation_pipeline.initialize(
        job, run_id="dependency-readset", mode="fast",
        model_routes={"fast": engine.S2_DEFAULT_MODEL, "quality": engine.S2_QUALITY_MODEL},
        chapters=[{"id": "old", "title": "旧节点", "output": "旧节点.md"}],
    )
    for name in ("投标文件组成.md", "评分点响应矩阵.md", "废标风险清单.md"):
        (job / name).write_text("# 规划\n\n" + "逐项响应。" * 40, encoding="utf-8")
    engine.write_json(str(job / "response_plan.json"), {"chapters": [
        {"id": "a", "title": "A", "output": "A.md", "basis": ["条款A"],
         "scoring_points": [], "material_slots": [], "dependencies": []},
        {"id": "b", "title": "B", "output": "B.md", "basis": ["条款B"],
         "scoring_points": [], "material_slots": [], "dependencies": ["a"]},
    ]})
    engine.generation_pipeline.start_node(job, "response_plan", input_digest="plan")
    engine.generation_pipeline.complete_node(job, "response_plan", input_digest="plan")
    state = engine.generation_pipeline.apply_response_plan(job)
    upstream = job / "A.md"
    upstream.write_text("上游版本一" * 80, encoding="utf-8")
    downstream = next(node for node in state["nodes"] if node["id"] == "chapter_write:b")
    target = tmp_path / "dependent-attempt"
    target.mkdir()

    engine._pipeline_copy_inputs(str(job), downstream, str(target))
    names = engine._pipeline_declared_input_names(str(job), downstream, state)
    before = engine.generation_pipeline.file_digest([job / name for name in names])
    upstream.write_text("上游版本二" * 80, encoding="utf-8")
    after = engine.generation_pipeline.file_digest([job / name for name in names])

    assert (target / "A.md").is_file()
    assert before != after


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
    listed_flow = dict(listed[0]["flow"])
    diagnostic_flow = dict(diagnostic["job"]["flow"])
    listed_silence = listed_flow.pop("silence_seconds")
    diagnostic_silence = diagnostic_flow.pop("silence_seconds")
    assert diagnostic_flow == listed_flow
    assert 0 <= diagnostic_silence - listed_silence <= 1


def test_s2_launch_uses_checkpoint_pipeline_instead_of_legacy_long_session(engine, tmp_path, monkeypatch):
    job = Path(engine.jpath("pipeline-launch"))
    job.mkdir(parents=True)
    (job / "采购文件.md").write_text("# 采购需求\n" + "软件平台建设与运维服务。" * 20, encoding="utf-8")
    engine.write_json(str(job / "任务.json"), {
        "name": "流水线启动", "tender": "采购文件.md", "staged": True,
        "template_snapshot": {"package": {"outline": [
            {"title": "项目理解", "purpose": "说明建设目标"},
            {"title": "实施方案", "purpose": "说明实施计划"},
        ]}},
    })
    engine.write_json(engine.conf_path(), _checkpoint_config(engine))
    started = []
    monkeypatch.setattr(engine, "generation_preflight", lambda *_args: {"ok": True, "repair": False})
    monkeypatch.setattr(engine, "config_agent_cmd", lambda: ["opencode", "run", engine.AGENT_PROMPT])
    monkeypatch.setattr(engine, "_start_reserved_worker", lambda *args: started.append(args))

    result = engine._launch_job("pipeline-launch", str(job), "auto")

    assert result["mode"] == "agent"
    assert started and started[0][2] is engine.generation_pipeline_worker
    state = engine.generation_pipeline.load(job)
    assert state["mode"] == "fast"
    assert [node["title"] for node in state["nodes"] if node["id"].startswith("chapter_write:")] == [
        "项目理解", "实施方案", "技术应答偏离表", "商务偏离表",
    ]


def test_pipeline_worker_runs_local_parse_short_nodes_and_word_checkpoint(engine, tmp_path, monkeypatch):
    job = Path(engine.jpath("pipeline-worker"))
    job.mkdir(parents=True)
    (job / "采购文件.md").write_text("# 采购需求\n" + "软件平台建设、部署、培训、验收和运维服务。" * 30, encoding="utf-8")
    meta = {
        "name": "流水线跑通", "tender": "采购文件.md", "staged": False, "run_id": "run-1",
        "template_snapshot": {"package": {"outline": [
            {"title": "项目理解"}, {"title": "实施方案"},
        ]}},
    }
    engine.write_json(str(job / "任务.json"), meta)
    engine.write_json(engine.conf_path(), _checkpoint_config(engine))
    engine._initialize_generation_pipeline(str(job), meta, engine.read_json(engine.conf_path(), {}))
    calls = []

    def model_runner(path, node, _prompt, model):
        calls.append((node["id"], model))
        for output in node["outputs"]:
            if output == "response_plan.json":
                engine.write_json(str(Path(path) / output), {"chapters": [
                    {"id": "plan_a", "title": "响应总述", "output": "规划_A_响应总述.md",
                     "basis": ["采购需求"], "scoring_points": ["总体方案"],
                     "material_slots": [], "dependencies": []},
                    {"id": "plan_b", "title": "实施交付", "output": "规划_B_实施交付.md",
                     "basis": ["交付要求"], "scoring_points": ["实施计划"],
                     "material_slots": ["实施案例"],
                     "dependencies": ["plan_a"]},
                ]})
            else:
                text = "# %s\n\n%s" % (node["title"], "逐项依据招标要求响应。" * 120)
                (Path(path) / output).write_text(text, encoding="utf-8")

    def export_word(path, known, force=False):
        from docx import Document
        document = Document()
        document.add_heading("投标文件", level=1)
        document.add_paragraph("逐项响应招标要求并提供可核验依据。" * 30)
        document.save(Path(path) / "投标文件_整册.docx")
        known.add("投标文件_整册.docx")
        return ["投标文件_整册.docx"]

    monkeypatch.setattr(engine, "_pipeline_model_runner", model_runner)
    monkeypatch.setattr(engine, "ensure_docx", export_word)
    def format_ok(path, _word=''):
        (Path(path) / "Word格式自检报告.md").write_text(
            "# 投标文件格式自检报告\n\n- 结论：✅ 全部通过（1 项）\n", encoding="utf-8")
        return {"status": "pass"}
    monkeypatch.setattr(engine, "word_format_audit", format_ok)
    monkeypatch.setattr(engine, "settle", lambda path, commit=True, **_kwargs: {
        "state": "done" if commit else "ready",
    })
    monkeypatch.setattr(engine, "delivery_summary", lambda path: {"ready": True})

    engine.generation_pipeline_worker(str(job))

    state = engine.generation_pipeline.load(job)
    assert state["state"] == "done"
    assert all(node["state"] == "done" for node in state["nodes"])
    assert calls[0][0] == "response_plan"
    assert {node for node, _model in calls[1:]} == {
        "chapter_write:plan_a", "chapter_write:plan_b",
        "chapter_write:technical_deviation", "chapter_write:business_deviation",
    }
    assert [node for node, _model in calls].index("chapter_write:plan_a") < [
        node for node, _model in calls].index("chapter_write:plan_b")
    assert {model for _node, model in calls} == {engine.S2_DEFAULT_MODEL}
    assert (job / "招标文件_解析版.md").is_file()
    assert (job / "投标文件_整册.md").is_file()
    assert (job / "投标文件_整册.docx").stat().st_size > 1024
    assert (job / "Word格式自检报告.md").is_file()


def test_pipeline_offline_e2e_reaches_real_word_delivery_gate(engine, monkeypatch):
    job = Path(engine.jpath("pipeline-real-word"))
    job.mkdir(parents=True)
    (job / "采购文件.md").write_text(
        "# 采购需求\n" + "统一平台建设、实施、培训、验收和运维要求。" * 80,
        encoding="utf-8",
    )
    meta = {
        "name": "真实Word门禁", "tender": "采购文件.md", "staged": False, "run_id": "real-word",
        "template_snapshot": {"package": {"outline": [
            {"title": "项目理解"}, {"title": "实施方案"},
        ]}},
    }
    engine.write_json(str(job / "任务.json"), meta)
    conf = _checkpoint_config(engine)
    engine.write_json(engine.conf_path(), conf)
    engine._initialize_generation_pipeline(str(job), meta, conf)

    def model_runner(path, node, _prompt, _model):
        title = str(node.get("title") or "响应")
        for output in node["outputs"]:
            target = Path(path) / output
            if output == "response_plan.json":
                engine.write_json(str(target), {"chapters": [
                    {"id": "01", "title": "项目理解", "output": "章节_01_项目理解.md",
                     "basis": ["采购需求"], "scoring_points": ["方案完整性"],
                     "material_slots": [], "dependencies": []}
                ]})
            elif "偏离表" in output:
                target.write_text(
                    f"# {title}\n\n| 序号 | 招标要求 | 投标响应 | 偏离情况 | 依据/证据 | 备注 |\n"
                    "|---|---|---|---|---|---|\n"
                    "| 1 | 按期交付 | 完全响应 | 无偏离 | 招标解析版 | 已核对 |\n"
                    + (title + "核对说明。") * 40,
                    encoding="utf-8",
                )
            else:
                sections = [
                    f"## {title}要点{i}\n\n{title}第{i}项给出独立的实施动作、交付标准、核对依据和风险控制。"
                    + (f"{title}细化措施{i}。" * 80)
                    for i in range(1, 9)
                ]
                target.write_text("# " + title + "\n\n" + "\n\n".join(sections), encoding="utf-8")

    monkeypatch.setattr(engine, "_pipeline_model_runner", model_runner)
    engine.generation_pipeline_worker(str(job))

    state = engine.generation_pipeline.load(job)
    word = job / "投标文件_整册.docx"
    assert state["state"] == "done"
    assert engine.read_json(str(job / "outcome.json"), {})["state"] == "done"
    assert engine.delivery_summary(str(job))["ready"] is True
    assert engine.delivery_summary(str(job))["format"]["status"] == "pass"
    assert engine._valid_docx(str(word)) is True


def test_resume_pipeline_does_not_require_old_opencode_session(engine, job, monkeypatch):
    meta = engine.read_json(str(job / "任务.json"), {})
    meta.update({"run_id": "resume-run", "staged": False})
    engine.write_json(str(job / "任务.json"), meta)
    engine.generation_pipeline.initialize(
        job, run_id="resume-run", mode="fast",
        model_routes={"fast": engine.S2_DEFAULT_MODEL, "quality": engine.S2_QUALITY_MODEL},
        chapters=[{"id": "01", "title": "项目理解", "output": "章节_01_项目理解.md"}],
    )
    started = []
    monkeypatch.setattr(engine, "_start_reserved_worker", lambda *args: started.append(args))

    with TestClient(engine.app) as client:
        response = client.post(f"/v1/jobs/{job.name}/resume")

    assert response.status_code == 200
    assert response.json()["pipeline"] is True
    assert started and started[0][2] is engine.generation_pipeline_worker


def test_resume_finalizes_done_pipeline_after_crash_before_outcome_commit(engine, job, monkeypatch):
    meta = engine.read_json(str(job / "任务.json"), {})
    meta.update({"run_id": "commit-pending", "staged": False})
    engine.write_json(str(job / "任务.json"), meta)
    state = engine.generation_pipeline.initialize(
        job, run_id="commit-pending", mode="fast",
        model_routes={"fast": engine.S2_DEFAULT_MODEL, "quality": engine.S2_QUALITY_MODEL},
        chapters=[{"id": "01", "title": "项目理解", "output": "章节_01.md"}],
    )
    for node in state["nodes"]:
        node["state"] = "done"
        node["finished_at"] = engine.now()
    state["state"] = "done"
    state["recoverable"] = False
    state["current_nodes"] = []
    engine.write_json(str(job / "pipeline.json"), state)
    monkeypatch.setattr(engine, "settle", lambda path, **_kwargs: {"state": "done"})
    started = []
    monkeypatch.setattr(engine, "_start_reserved_worker", lambda *args: started.append(args))

    with TestClient(engine.app) as client:
        response = client.post(f"/v1/jobs/{job.name}/resume")

    assert response.status_code == 200
    assert response.json()["finalized"] is True
    assert started == []
    assert engine._is_running(job.name) is False


def test_commit_pending_pipeline_exposes_resume_action(engine, job):
    state = engine.generation_pipeline.initialize(
        job, run_id="commit-pending-ui", mode="fast",
        model_routes={"fast": engine.S2_DEFAULT_MODEL, "quality": engine.S2_QUALITY_MODEL},
        chapters=[{"id": "01", "title": "项目理解", "output": "章节_01.md"}],
    )
    for node in state["nodes"]:
        node["state"] = "done"
    state.update({"state": "done", "recoverable": False, "current_nodes": []})
    engine.write_json(str(job / "pipeline.json"), state)

    assert "resume" in engine.job_can(str(job), "stopped", {})


def test_job_flow_uses_pipeline_node_truth_when_legacy_progress_is_stale(engine, job):
    meta = engine.read_json(str(job / "任务.json"), {})
    engine.generation_pipeline.initialize(
        job, run_id="flow-run", mode="fast",
        model_routes={"fast": engine.S2_DEFAULT_MODEL, "quality": engine.S2_QUALITY_MODEL},
        chapters=[{"id": "01", "title": "项目理解", "output": "章节_01_项目理解.md"}],
    )
    for name in ("投标文件组成.md", "评分点响应矩阵.md", "废标风险清单.md"):
        (job / name).write_text("# 规划\n" + "逐项响应。" * 40, encoding="utf-8")
    engine.write_json(str(job / "response_plan.json"), {"chapters": [
        {"id": "01", "title": "项目理解", "output": "章节_01_项目理解.md",
         "basis": ["采购需求"], "scoring_points": [],
         "material_slots": [], "dependencies": []}
    ]})
    engine.generation_pipeline.start_node(job, "response_plan", input_digest="plan")
    engine.generation_pipeline.complete_node(job, "response_plan", input_digest="plan")
    engine.generation_pipeline.start_node(job, "chapter_write:01", input_digest="chapter")
    stale = {"type": "progress", "stage": "正在读招标文件", "step": 1, "pct": 2, "total": 12}

    flow = engine.job_flow(str(job), "running", meta, stale, {})

    assert flow["current_phase"] == "write"
    assert "项目理解" in flow["current_action"]
    assert flow["pipeline"]["current_nodes"] == ["chapter_write:01"]
    write_phase = next(phase for phase in flow["phases"] if phase["id"] == "write")
    parse_phase = next(phase for phase in flow["phases"] if phase["id"] == "parse")
    assert any(check["id"] == "chapter_write:01" and check["state"] == "active"
               for check in write_phase["checks"])
    assert parse_phase["expected_seconds"] == 90
    assert write_phase["expected_seconds"] == 600
    assert parse_phase["estimate_source"] == "pipeline_reference"


def test_settle_never_commits_done_before_delivery_is_ready(engine, job, monkeypatch):
    committed = []
    halted = []
    monkeypatch.setattr(engine, "harvest", lambda *_args: None)
    monkeypatch.setattr(engine, "list_deliverables", lambda *_args: ["投标文件_整册.docx"])
    monkeypatch.setattr(engine, "_body_mds", lambda *_args: [])
    monkeypatch.setattr(engine, "_body_docxs", lambda *_args: ["投标文件_整册.docx"])
    monkeypatch.setattr(engine, "quality_audit", lambda *_args: {
        "status": "pass", "level": "green", "summary": "质检通过",
    })
    monkeypatch.setattr(engine, "delivery_summary", lambda *_args, **_kwargs: {
        "ready": False, "word": {"present": True}, "toc": {"status": "fail"},
    })
    monkeypatch.setattr(engine, "_commit_done", lambda *_args: committed.append(True) or True)
    monkeypatch.setattr(engine, "halt", lambda _job, why: halted.append(why))

    result = engine.settle(str(job), known={"投标文件_整册.docx"})

    assert result["state"] == "stopped"
    assert committed == []
    assert halted == ["已停止（出件检查未通过）"]


def test_pipeline_outcome_done_is_not_user_visible_until_delivery_node_is_done(engine, job, monkeypatch):
    engine.generation_pipeline.initialize(
        job, run_id="split-terminal", mode="fast",
        model_routes={"fast": engine.S2_DEFAULT_MODEL, "quality": engine.S2_QUALITY_MODEL},
        chapters=[{"id": "01", "title": "项目理解", "output": "章节_01.md"}],
    )
    engine.write_json(str(job / "outcome.json"), {
        "state": "done", "word": "投标文件_整册.docx", "ts": engine.now(),
    })
    monkeypatch.setattr(engine, "_body_docxs", lambda *_args: ["投标文件_整册.docx"])

    assert engine.job_state(str(job)) == "stopped"


def test_interrupting_pipeline_sessions_attempts_every_session(engine, job, monkeypatch):
    engine.PIPELINE_SESSIONS[job.name] = {"session-a", "session-b"}
    calls = []

    def interrupt(sid):
        calls.append(sid)
        return sid == "session-b"

    monkeypatch.setattr(engine, "_interrupt_or_finished", interrupt)

    assert engine._pipeline_interrupt_sessions(str(job)) is False
    assert set(calls) == {"session-a", "session-b"}


def test_stop_sets_cancel_tombstone_before_interrupting_sessions(engine, job, monkeypatch):
    owner = "owner-1"
    engine.RUNNING[job.name] = owner
    observed = []
    monkeypatch.setattr(engine, "_pipeline_interrupt_sessions", lambda _job: observed.append(
        engine.CANCEL.get(job.name)) or True)
    monkeypatch.setattr(engine, "_take_proc", lambda *_args: None)

    ok, requested = engine._stop_running_owner(str(job), job.name, owner)

    assert ok is True
    assert requested is True
    assert observed == [owner]


def test_node_retry_requires_and_deduplicates_idempotency_key(engine, job, monkeypatch):
    engine.generation_pipeline.initialize(
        job, run_id="retry-api", mode="fast",
        model_routes={"fast": engine.S2_DEFAULT_MODEL, "quality": engine.S2_QUALITY_MODEL},
        chapters=[{"id": "01", "title": "项目理解", "output": "章节_01_项目理解.md"}],
    )
    engine.generation_pipeline.fail_node(
        job, "chapter_write:01", "invalid_configuration", retryable=False)
    started = []
    monkeypatch.setattr(engine, "_start_reserved_worker", lambda *args: started.append(args))

    with TestClient(engine.app) as client:
        missing = client.post(f"/v1/jobs/{job.name}/nodes/chapter_write:01/retry")
        first = client.post(
            f"/v1/jobs/{job.name}/nodes/chapter_write:01/retry",
            headers={"Idempotency-Key": "retry-request-0001"},
        )
        duplicate = client.post(
            f"/v1/jobs/{job.name}/nodes/chapter_write:01/retry",
            headers={"Idempotency-Key": "retry-request-0001"},
        )

    assert missing.status_code == 400
    assert first.status_code == 200
    assert first.json()["deduplicated"] is False
    assert duplicate.status_code == 200
    assert duplicate.json()["deduplicated"] is True
    assert len(started) == 1


def test_concurrent_same_node_retry_key_is_deduplicated_before_side_effect(engine, job, monkeypatch):
    engine.generation_pipeline.initialize(
        job, run_id="retry-race", mode="fast",
        model_routes={"fast": engine.S2_DEFAULT_MODEL, "quality": engine.S2_QUALITY_MODEL},
        chapters=[{"id": "01", "title": "项目理解", "output": "章节_01.md"}],
    )
    engine.generation_pipeline.fail_node(job, "chapter_write:01", "blocked", retryable=False)
    entered = threading.Event()
    release = threading.Event()
    original_retry = engine.generation_pipeline.retry_node
    side_effects = []

    def delayed_retry(*args):
        side_effects.append(1)
        entered.set()
        release.wait(2)
        return original_retry(*args)

    monkeypatch.setattr(engine.generation_pipeline, "retry_node", delayed_retry)
    monkeypatch.setattr(engine, "_start_reserved_worker", lambda *_args: None)
    responses = []

    def request_retry():
        with TestClient(engine.app) as client:
            responses.append(client.post(
                f"/v1/jobs/{job.name}/nodes/chapter_write:01/retry",
                headers={"Idempotency-Key": "same-concurrent-retry"},
            ))

    first = threading.Thread(target=request_retry)
    first.start()
    assert entered.wait(1)
    second = threading.Thread(target=request_retry)
    second.start(); second.join(1)
    release.set(); first.join(1)

    assert sorted(response.status_code for response in responses) == [200, 202]
    assert sum(bool(response.json().get("deduplicated")) for response in responses) == 1
    assert next(response for response in responses if response.status_code == 202).json()["pending"] is True
    assert side_effects == [1]


def test_active_dispatch_lease_prevents_ultrafast_worker_double_dispatch(engine, job, monkeypatch):
    engine.generation_pipeline.initialize(
        job, run_id="retry-fast-worker", mode="fast",
        model_routes={"fast": engine.S2_DEFAULT_MODEL, "quality": engine.S2_QUALITY_MODEL},
        chapters=[{"id": "01", "title": "项目理解", "output": "章节_01.md"}],
    )
    engine.generation_pipeline.fail_node(job, "chapter_write:01", "blocked", retryable=False)
    key = "fast-worker-retry-key"
    engine.write_json(str(job / ".node_retry_requests.json"), {
        "chapter_write:01|" + key: {
            "node_id": "chapter_write:01", "accepted_at": engine.now(),
            "status": "dispatching", "lease_until": time.time() + 30,
            "dispatch_token": "finished-owner",
        }
    })
    started = []
    monkeypatch.setattr(engine, "_start_reserved_worker", lambda *args: started.append(args))

    with TestClient(engine.app) as client:
        response = client.post(
            f"/v1/jobs/{job.name}/nodes/chapter_write:01/retry",
            headers={"Idempotency-Key": key})

    assert response.status_code == 202
    assert response.json()["pending"] is True
    assert response.json()["deduplicated"] is True
    assert started == []


def test_failed_retry_dispatch_is_not_reported_as_accepted_on_duplicate(engine, job, monkeypatch):
    engine.generation_pipeline.initialize(
        job, run_id="retry-dispatch-failure", mode="fast",
        model_routes={"fast": engine.S2_DEFAULT_MODEL, "quality": engine.S2_QUALITY_MODEL},
        chapters=[{"id": "01", "title": "项目理解", "output": "章节_01.md"}],
    )
    engine.generation_pipeline.fail_node(job, "chapter_write:01", "blocked", retryable=False)
    monkeypatch.setattr(engine, "_start_reserved_worker",
                        lambda *_args: (_ for _ in ()).throw(RuntimeError("dispatch boom")))
    headers = {"Idempotency-Key": "retry-dispatch-failure-key"}

    with TestClient(engine.app, raise_server_exceptions=False) as client:
        first = client.post(f"/v1/jobs/{job.name}/nodes/chapter_write:01/retry", headers=headers)
        duplicate = client.post(f"/v1/jobs/{job.name}/nodes/chapter_write:01/retry", headers=headers)

    assert first.status_code == 500
    assert first.json()["code"] == "retry_dispatch_failed"
    assert duplicate.status_code == 500
    assert duplicate.json()["ok"] is False
    assert duplicate.json()["code"] == "retry_dispatch_failed"
    assert duplicate.json()["deduplicated"] is True


def test_new_retry_key_recovers_after_previous_dispatch_failure(engine, job, monkeypatch):
    engine.generation_pipeline.initialize(
        job, run_id="retry-new-key", mode="fast",
        model_routes={"fast": engine.S2_DEFAULT_MODEL, "quality": engine.S2_QUALITY_MODEL},
        chapters=[{"id": "01", "title": "项目理解", "output": "章节_01.md"}],
    )
    engine.generation_pipeline.fail_node(job, "chapter_write:01", "blocked", retryable=False)
    calls = []

    def dispatch(*args):
        calls.append(args)
        if len(calls) == 1:
            raise RuntimeError("dispatch boom")

    monkeypatch.setattr(engine, "_start_reserved_worker", dispatch)
    with TestClient(engine.app, raise_server_exceptions=False) as client:
        first = client.post(
            f"/v1/jobs/{job.name}/nodes/chapter_write:01/retry",
            headers={"Idempotency-Key": "retry-dispatch-old-key"})
        second = client.post(
            f"/v1/jobs/{job.name}/nodes/chapter_write:01/retry",
            headers={"Idempotency-Key": "retry-dispatch-new-key"})

    assert first.status_code == 500
    assert second.status_code == 200
    assert len(calls) == 2


def test_started_worker_is_not_redispatched_when_acceptance_receipt_write_fails(engine, job, monkeypatch):
    engine.generation_pipeline.initialize(
        job, run_id="retry-receipt-failure", mode="fast",
        model_routes={"fast": engine.S2_DEFAULT_MODEL, "quality": engine.S2_QUALITY_MODEL},
        chapters=[{"id": "01", "title": "项目理解", "output": "章节_01.md"}],
    )
    engine.generation_pipeline.fail_node(job, "chapter_write:01", "blocked", retryable=False)
    starts = []

    def ultrafast_dispatch(_base, owner, *_args):
        starts.append(owner)
        engine._release_running(job.name, owner)

    original_write = engine.write_json
    ledger_path = str(job / ".node_retry_requests.json")
    ledger_writes = 0

    def fail_acceptance_receipt(path, data):
        nonlocal ledger_writes
        if str(path) == ledger_path:
            ledger_writes += 1
            if ledger_writes == 2:
                raise OSError("disk busy after worker started")
        return original_write(path, data)

    monkeypatch.setattr(engine, "_start_reserved_worker", ultrafast_dispatch)
    monkeypatch.setattr(engine, "write_json", fail_acceptance_receipt)
    with TestClient(engine.app) as client:
        first = client.post(
            f"/v1/jobs/{job.name}/nodes/chapter_write:01/retry",
            headers={"Idempotency-Key": "retry-receipt-old-key"})
        second = client.post(
            f"/v1/jobs/{job.name}/nodes/chapter_write:01/retry",
            headers={"Idempotency-Key": "retry-receipt-new-key"})

    assert first.status_code == 202
    assert first.json()["code"] == "retry_dispatch_confirmation_pending"
    assert second.status_code == 202
    assert len(starts) == 1


def test_stale_dispatching_retry_intent_is_reconciled_instead_of_fake_success(engine, job, monkeypatch):
    engine.generation_pipeline.initialize(
        job, run_id="retry-stale-intent", mode="fast",
        model_routes={"fast": engine.S2_DEFAULT_MODEL, "quality": engine.S2_QUALITY_MODEL},
        chapters=[{"id": "01", "title": "项目理解", "output": "章节_01.md"}],
    )
    engine.generation_pipeline.fail_node(job, "chapter_write:01", "blocked", retryable=False)
    key = "stale-dispatching-retry-key"
    engine.write_json(str(job / ".node_retry_requests.json"), {
        "chapter_write:01|" + key: {
            "node_id": "chapter_write:01", "accepted_at": engine.now(), "status": "dispatching",
        }
    })
    started = []
    monkeypatch.setattr(engine, "_start_reserved_worker", lambda *args: started.append(args))

    with TestClient(engine.app) as client:
        response = client.post(
            f"/v1/jobs/{job.name}/nodes/chapter_write:01/retry",
            headers={"Idempotency-Key": key})

    assert response.status_code == 200
    assert response.json()["deduplicated"] is False
    assert len(started) == 1


def test_deterministic_source_parse_failure_is_blocked_not_auto_retried(engine, tmp_path):
    job = Path(engine.jpath("bad-source"))
    job.mkdir(parents=True)
    (job / "空白.txt").write_text(" \n", encoding="utf-8")
    meta = {"name": "空白采购文件", "tender": "空白.txt", "run_id": "bad-source"}
    engine.write_json(str(job / "任务.json"), meta)
    conf = _checkpoint_config(engine)
    engine.write_json(engine.conf_path(), conf)
    engine._initialize_generation_pipeline(str(job), meta, conf)

    engine.generation_pipeline_worker(str(job))

    state = engine.generation_pipeline.load(job)
    source = next(node for node in state["nodes"] if node["id"] == "source_parse")
    assert source["state"] == "blocked"
    assert state["state"] == "blocked"
    assert engine.generation_pipeline.summary(job)["retrying"] == 0
