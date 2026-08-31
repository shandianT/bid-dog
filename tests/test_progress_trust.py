"""进度可信与「Word 已生成仍报错」修复的回归。

三个真实故障路径:
1. 事件回放的证据钳制只认智能体模式的产物文件,流水线任务被钳回「检查资料 1/12」;
2. 格式门禁把样式不符当交付失败,Word 明明已导出可用,整单却报错;
3. 质检重建 Word 后旧格式报告 stale,delivery 判红。
"""
import json
import os

import generation_pipeline
from test_p0_features import _init_pipeline, _set_node


def test_pipeline_checkpoint_step_maps_engine_written_node_states(engine, job):
    assert engine._pipeline_checkpoint_step(str(job)) == 0     # 无流水线 → 不加分
    _init_pipeline(job, [
        {"id": "c1", "title": "施工组织设计", "output": "章节_01_施工组织设计.md"},
        {"id": "c2", "title": "安全文明施工", "output": "章节_02_安全文明施工.md"},
    ])
    _set_node(job, "source_parse", state="done")
    assert engine._pipeline_checkpoint_step(str(job)) == 4
    _set_node(job, "response_plan", state="done")
    assert engine._pipeline_checkpoint_step(str(job)) == 6
    _set_node(job, "chapter_write:c1", state="running")
    assert engine._pipeline_checkpoint_step(str(job)) == 7     # 在写章节 → 至少到第 7 步
    _set_node(job, "chapter_write:c1", state="done")
    assert engine._pipeline_checkpoint_step(str(job)) == 8
    _set_node(job, "word_export", state="done")
    assert engine._pipeline_checkpoint_step(str(job)) == 12


def test_sanitize_progress_trusts_pipeline_checkpoints(engine, job):
    claimed = {"type": "progress", "stage": "分章撰写中:施工组织设计",
               "pct": 55, "step": 7, "total": 12}
    # 没有流水线、也没有智能体模式的证据文件:仍按文件证据钳制(防伪造不回退)
    clamped = engine.sanitize_event(str(job), dict(claimed))
    assert clamped["step"] < 7
    # 流水线节点(引擎亲手写盘)证明确实写到章节:回放保留真实进度与阶段名
    _init_pipeline(job, [{"id": "c1", "title": "施工组织设计", "output": "章节_01_施工组织设计.md"}])
    for node in ("source_parse", "response_plan"):
        _set_node(job, node, state="done")
    _set_node(job, "chapter_write:c1", state="running")
    kept = engine.sanitize_event(str(job), dict(claimed))
    assert kept["step"] == 7
    assert kept["stage"] == "分章撰写中:施工组织设计"
    assert kept["verified"] is True
    # 证据仍然不允许「超报」:声明 12 步但节点只到第 7 步 → 钳回
    over = engine.sanitize_event(str(job), dict(claimed, step=12, pct=99))
    assert over["step"] <= 8


def _docx(path):
    from docx import Document
    document = Document()
    for index in range(30):
        document.add_paragraph("第%d项完整响应,满足采购要求并提供实施说明。" % (index + 1))
    document.save(path)


def test_word_format_status_classifies_warn_stale_fail(engine, job):
    _docx(str(job / "投标文件_整册.docx"))
    digest = engine._file_digest(str(job / "投标文件_整册.docx"))
    report = job / "Word格式自检报告.md"

    # 检查跑完但有样式不符(带 SHA 绑定)→ warn:文件可用,提交前人工确认
    report.write_text("# 报告\n\n- 结论：❌ 未通过\n- SHA-256：`%s`\n" % digest, encoding="utf-8")
    assert engine._word_format_status(str(job))["status"] == "warn"
    # 检查没跑成(无 SHA 绑定)→ fail
    report.write_text("# 报告\n\n- 结论：❌ 未通过\n- 原因:格式检查执行失败\n", encoding="utf-8")
    assert engine._word_format_status(str(job))["status"] == "fail"
    # 通过但 Word 已被重建 → stale(由 delivery_summary 现场重检自愈)
    report.write_text("# 报告\n\n- 结论：✅ 全部通过\n- SHA-256：`%s`\n" % ("0" * 64), encoding="utf-8")
    assert engine._word_format_status(str(job))["status"] == "stale"
    report.write_text("# 报告\n\n- 结论：✅ 全部通过\n- SHA-256：`%s`\n" % digest, encoding="utf-8")
    assert engine._word_format_status(str(job))["status"] == "pass"


def test_delivery_summary_treats_style_warn_as_deliverable(engine, job, monkeypatch):
    _init_pipeline(job, [{"id": "c1", "title": "施工组织设计", "output": "章节_01_施工组织设计.md"}])
    _docx(str(job / "投标文件_整册.docx"))
    digest = engine._file_digest(str(job / "投标文件_整册.docx"))
    (job / "Word格式自检报告.md").write_text(
        "# 报告\n\n- 结论：❌ 未通过\n- SHA-256：`%s`\n" % digest, encoding="utf-8")
    monkeypatch.setattr(engine, "_docx_has_toc", lambda _p: True)
    monkeypatch.setattr(engine, "_deviation_item", lambda _j, _n: {"status": "pass", "rows": 3})
    monkeypatch.setattr(engine, "_quality_result_from_disk",
                        lambda _j, _s: {"status": "pass", "level": "green", "summary": "内容检查通过"})
    summary = engine.delivery_summary(str(job))
    assert summary["format"]["status"] == "warn"
    assert summary["ready"] is True                       # 样式不符不再拦交付
    assert summary["checks"]["status"] == "warning"
    assert "格式自检有不符项" in summary["checks"]["summary"]


def test_delivery_summary_reaudits_stale_report_instead_of_failing(engine, job, monkeypatch):
    _init_pipeline(job, [{"id": "c1", "title": "施工组织设计", "output": "章节_01_施工组织设计.md"}])
    _docx(str(job / "投标文件_整册.docx"))
    (job / "Word格式自检报告.md").write_text(
        "# 报告\n\n- 结论：✅ 全部通过\n- SHA-256：`%s`\n" % ("0" * 64), encoding="utf-8")
    monkeypatch.setattr(engine, "_docx_has_toc", lambda _p: True)
    monkeypatch.setattr(engine, "_deviation_item", lambda _j, _n: {"status": "pass", "rows": 3})
    monkeypatch.setattr(engine, "_quality_result_from_disk",
                        lambda _j, _s: {"status": "pass", "level": "green", "summary": "内容检查通过"})
    reran = {}
    def fake_audit(target_job, word_name=""):
        reran["yes"] = True
        digest = engine._file_digest(os.path.join(str(target_job), "投标文件_整册.docx"))
        (job / "Word格式自检报告.md").write_text(
            "# 报告\n\n- 结论：✅ 全部通过\n- SHA-256：`%s`\n" % digest, encoding="utf-8")
        return {"status": "pass", "report": "Word格式自检报告.md", "failed": 0, "summary": "ok"}
    monkeypatch.setattr(engine, "word_format_audit", fake_audit)
    summary = engine.delivery_summary(str(job))
    assert reran.get("yes") is True                       # stale → 现场重检,不判红
    assert summary["format"]["status"] == "pass"
    assert summary["ready"] is True


def test_confirm_answer_clears_waiting_outcome(engine, job, monkeypatch):
    from fastapi.testclient import TestClient
    engine.write_json(str(job / "outcome.json"),
                      {"state": "stopped", "reason": "等待确认解析结果（确认后自动继续）"})
    monkeypatch.setattr(engine, "generation_pipeline_worker", lambda _job: None)
    with TestClient(engine.app) as client:
        body = client.post("/v1/jobs/job-1/answers",
                           json={"question_id": "confirm_parse:run-1",
                                 "choice": engine.CONFIRM_PARSE_ACCEPT}).json()
    assert body["ok"] is True
    assert not (job / "outcome.json").exists()            # 等待终态被清掉,任务回到运行轨道


def test_environment_phase_never_reports_wall_clock_idle_as_machine_time(engine, job):
    """隔夜再打开旧任务时,环境准备阶段曾报出「实际 8 小时 · 通常 1 分钟」。

    起点是建任务那一刻,终点在没有落盘证据时被拿「此刻」兜底,于是把用户去吃饭、
    隔天才点开始的空档全算成了机器耗时。一线看到的是「这破软件卡了 8 小时」。
    """
    meta = engine.read_json(str(job / "任务.json"), {})
    meta["created_at"] = "2026-08-01 09:00:00"        # 很久以前建的单
    engine.write_json(str(job / "任务.json"), meta)
    _init_pipeline(job, [{"id": "c1", "title": "施工组织设计", "output": "章节_01_施工组织设计.md"}])
    for node in ("source_parse", "response_plan"):
        _set_node(job, node, state="done")
    _set_node(job, "chapter_write:c1", state="done")

    flow = engine.job_flow(str(job))
    env = next(p for p in flow["phases"] if p["id"] == "environment")
    assert env["state"] == "done"
    elapsed = env.get("elapsed_seconds")
    # 要么根本不报实际值,要么必须落在一个人类看了不会当成故障的范围内。
    assert elapsed is None or elapsed <= max(env["expected_seconds"] * 20, 1800), \
        "环境准备报出了 %s 秒,又把用户空等算成了机器耗时" % elapsed


def test_coverage_items_carry_the_reason_they_are_not_covered(engine, job):
    """界面上「为什么没算覆盖」以前靠 node_id 空不空反推,出现过同一行左边写
    「落位:技术方案」右边写「未定位到章节」的自相矛盾。原因必须由后端给准。"""
    (job / "评分点响应矩阵.md").write_text("\n".join([
        "# 评分点响应矩阵", "",
        "| 序号 | 原要求/评分点 | 分值 | 响应位置 | 证据 | 缺口 |",
        "|---|---|---:|---|---|---|",
        "| 1 | 已覆盖项 | 3 | 施工组织设计 | 解析版 | 无 |",
        "| 2 | 留着缺口 | 4 | 施工组织设计 | 解析版 | 〔需补充〕业绩 |",
        "| 3 | 还没落位 | 5 | 〔需补充〕 | 〔需补充〕 | 〔需补充〕 |",
        "",
    ]), encoding="utf-8")
    _init_pipeline(job, [{"id": "c1", "title": "施工组织设计", "output": "章节_01_施工组织设计.md"}])
    _set_node(job, "chapter_write:c1", state="running")          # 章节还没写完

    view = engine._coverage_view(str(job))
    reasons = [item["reason"] for item in view["items"]]
    assert reasons == ["chapter_pending", "gap", "unlocated"]

    _set_node(job, "chapter_write:c1", state="done")             # 写完后第一行才算覆盖
    view = engine._coverage_view(str(job))
    assert view["covered"] == 1
    assert [item["reason"] for item in view["items"]] == ["", "gap", "unlocated"]
