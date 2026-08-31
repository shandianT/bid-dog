"""P0 一批功能的回归:评分点覆盖度、单章重写、解析确认门。"""
import json
import os
import threading

import generation_pipeline
from fastapi.testclient import TestClient


MATRIX = """# 评分点响应矩阵

| 序号 | 原要求/评分点 | 分值 | 响应位置 | 证据 | 缺口 |
|---|---|---:|---|---|---|
| 1 | BIM 施工模拟方案 | 3 | 施工组织设计 | 解析版 | 无 |
| 2 | 近三年类似业绩 | 5 | 资质与业绩 | 历史标书 | 〔需补充〕第三个案例 |
| 3 | 绿色施工专项方案 | 2 | 安全文明施工 | 解析版 | 无 |
"""

RISKS = """# 废标风险清单

| 序号 | 类别 | 招标要求 | 风险 | 提交前动作 |
|---|---|---|---|---|
| 1 | 资格 | 安全生产许可证有效 | 证书过期即废标 | 核对有效期 |
| 2 | 签章 | 按格式签字盖章 | 漏章无效 | 逐页核对 |
"""


def _init_pipeline(job, chapters):
    return generation_pipeline.initialize(
        str(job), run_id="run-1", mode="fast",
        model_routes={"fast": "test-model", "quality": "test-model"},
        chapters=chapters,
    )


def _set_node(job, node_id, **fields):
    path = os.path.join(str(job), "pipeline.json")
    state = json.load(open(path, encoding="utf-8"))
    node = next(n for n in state["nodes"] if n["id"] == node_id)
    node.update(fields)
    json.dump(state, open(path, "w", encoding="utf-8"), ensure_ascii=False)
    return node


def test_coverage_reports_matrix_rows_against_chapter_states(engine, job):
    _init_pipeline(job, [
        {"id": "c1", "title": "施工组织设计", "output": "章节_01_施工组织设计.md"},
        {"id": "c2", "title": "安全文明施工", "output": "章节_02_安全文明施工.md"},
    ])
    _set_node(job, "chapter_write:c1", state="done")          # 行1:缺口干净+章节完成 → 已覆盖
    (job / "评分点响应矩阵.md").write_text(MATRIX, encoding="utf-8")

    with TestClient(engine.app) as client:
        body = client.get("/v1/jobs/job-1/coverage").json()

    assert body["ok"] and body["available"]
    assert body["total"] == 3
    assert body["covered"] == 1                               # 行2缺口未清,行3章节未完成
    by_req = {item["requirement"]: item for item in body["items"]}
    assert by_req["BIM 施工模拟方案"]["covered"] is True
    assert by_req["BIM 施工模拟方案"]["node_id"] == "chapter_write:c1"
    assert by_req["近三年类似业绩"]["covered"] is False
    assert by_req["绿色施工专项方案"]["covered"] is False
    assert by_req["绿色施工专项方案"]["node_id"] == "chapter_write:c2"


def test_coverage_absent_matrix_is_reported_not_erred(engine, job):
    with TestClient(engine.app) as client:
        body = client.get("/v1/jobs/job-1/coverage").json()
    assert body["ok"] is True and body["available"] is False


def test_rewrite_chapter_archives_old_draft_and_restarts_worker(engine, job, monkeypatch):
    _init_pipeline(job, [{"id": "c1", "title": "施工组织设计", "output": "章节_01_施工组织设计.md"}])
    _set_node(job, "chapter_write:c1", state="done")
    (job / "章节_01_施工组织设计.md").write_text("旧稿正文", encoding="utf-8")
    engine.write_json(str(job / "outcome.json"), {"state": "done"})

    ran = threading.Event()
    monkeypatch.setattr(engine, "generation_pipeline_worker", lambda _job: ran.set())

    with TestClient(engine.app) as client:
        body = client.post("/v1/jobs/job-1/chapters/chapter_write:c1/rewrite",
                           json={"note": "突出本地化施工经验"}).json()

    assert body["ok"] is True and body["version"] == 2
    assert ran.wait(5), "重写必须真的启动 worker"
    archived = job / "历史版本" / "章节_01_施工组织设计.v1.md"
    assert archived.read_text(encoding="utf-8") == "旧稿正文"
    assert not (job / "outcome.json").exists()
    state = generation_pipeline.load(str(job))
    node = next(n for n in state["nodes"] if n["id"] == "chapter_write:c1")
    assert node["user_note"] == "突出本地化施工经验"
    assert node["rewrite_serial"] == 1
    assert node["state"] == "done"        # done 保持,由契约摘要变化触发重跑
    assert state["state"] != "done"


def test_rewrite_rejects_non_chapter_and_busy_job(engine, job):
    _init_pipeline(job, [{"id": "c1", "title": "施工组织设计", "output": "章节_01_施工组织设计.md"}])
    with TestClient(engine.app) as client:
        response = client.post("/v1/jobs/job-1/chapters/assemble/rewrite", json={})
        assert response.status_code == 409
        assert "章节" in response.json()["error"]

        engine.RUNNING["job-1"] = "someone-else"
        try:
            response = client.post("/v1/jobs/job-1/chapters/chapter_write:c1/rewrite", json={})
            assert response.status_code == 409
            assert "正在生成" in response.json()["error"]
        finally:
            engine.RUNNING.pop("job-1", None)


def test_rewrite_note_changes_chapter_prompt(engine, job):
    _init_pipeline(job, [{"id": "c1", "title": "施工组织设计", "output": "章节_01_施工组织设计.md"}])
    generation_pipeline.rewrite_node(str(job), "chapter_write:c1", "工期按 18 个月")
    state = generation_pipeline.load(str(job))
    node = next(n for n in state["nodes"] if n["id"] == "chapter_write:c1")
    prompt = engine._pipeline_direct_task(str(job), node)
    assert "工期按 18 个月" in prompt and "单章重写" in prompt


def test_rewrite_resets_failed_chapter(engine, job):
    _init_pipeline(job, [{"id": "c1", "title": "施工组织设计", "output": "章节_01_施工组织设计.md"}])
    _set_node(job, "chapter_write:c1", state="failed", attempt=5, error_code="model_error")
    node = generation_pipeline.rewrite_node(str(job), "chapter_write:c1", "")
    assert node["state"] == "pending" and node["attempt"] == 0 and node["error_code"] == ""


def test_confirm_summary_extracts_key_facts_deterministically(engine, job):
    (job / "招标文件_解析版.md").write_text(
        "# 深圳市某棚户区改造项目招标文件\n\n"
        "- 投标文件递交截止时间：2026年9月15日 09:30\n"
        "- 资质要求：建筑工程施工总承包壹级，安全生产许可证有效\n"
        "- 评标办法：综合评估法，技术 55 分\n", encoding="utf-8")
    (job / "评分点响应矩阵.md").write_text(MATRIX, encoding="utf-8")
    (job / "废标风险清单.md").write_text(RISKS, encoding="utf-8")

    summary = engine._parse_confirm_summary(str(job))
    assert summary["project"] == "测试任务"
    assert "2026年9月15日" in summary["deadline"]
    assert "总承包壹级" in summary["qualification"]
    assert summary["scoring"].startswith("共 3 个评分点")
    assert "综合评估法" in summary["scoring"]
    assert summary["veto"].startswith("共 2 条")
    assert "资格" in summary["veto"]


def test_confirm_gate_blocks_until_confirmed(engine, job):
    meta = engine.read_json(str(job / "任务.json"), {})
    meta["confirm_parse"] = True
    engine.write_json(str(job / "任务.json"), meta)
    assert engine._confirm_gate_blocks(str(job), meta) is True
    engine.write_json(str(job / "解析确认.json"), {"confirmed": True})
    assert engine._confirm_gate_blocks(str(job), meta) is False
    meta["confirm_parse"] = False
    assert engine._confirm_gate_blocks(str(job), meta) is False


def test_confirm_answer_accept_restarts_worker(engine, job, monkeypatch):
    ran = threading.Event()
    monkeypatch.setattr(engine, "generation_pipeline_worker", lambda _job: ran.set())
    with TestClient(engine.app) as client:
        body = client.post("/v1/jobs/job-1/answers",
                           json={"question_id": "confirm_parse:run-1",
                                 "choice": engine.CONFIRM_PARSE_ACCEPT}).json()
    assert body["ok"] is True and body["delivered"] is True
    assert ran.wait(5)
    record = engine.read_json(str(job / "解析确认.json"), {})
    assert record["confirmed"] is True and record["corrections"] == ""
    closed = [e for e in _events(job) if e.get("type") == "question_closed"]
    assert closed and closed[-1]["id"] == "confirm_parse:run-1"


def test_confirm_answer_corrections_reach_requirements_file(engine, job, monkeypatch):
    monkeypatch.setattr(engine, "generation_pipeline_worker", lambda _job: None)
    with TestClient(engine.app) as client:
        body = client.post("/v1/jobs/job-1/answers",
                           json={"question_id": "confirm_parse:run-1",
                                 "text": "项目名应为：清湖片区二期"}).json()
    assert body["ok"] is True
    requirements = (job / "你的要求.md").read_text(encoding="utf-8")
    assert "解析确认修正" in requirements and "清湖片区二期" in requirements
    record = engine.read_json(str(job / "解析确认.json"), {})
    assert record["corrections"] == "项目名应为：清湖片区二期"


def test_create_job_persists_confirm_parse_flag(engine):
    with TestClient(engine.app) as client:
        response = client.post("/v1/jobs",
                               files={"tender": ("招标文件.md", b"# tender", "text/markdown")},
                               data={"start": "0", "confirm_parse": "1", "name": "flag-job"})
        assert response.status_code == 200
        jid = response.json()["job_id"]
        meta = engine.read_json(os.path.join(engine.jpath(jid), "任务.json"), {})
        assert meta["confirm_parse"] is True

        response = client.post("/v1/jobs",
                               files={"tender": ("招标文件.md", b"# tender", "text/markdown")},
                               data={"start": "0", "name": "no-flag-job"})
        jid = response.json()["job_id"]
        meta = engine.read_json(os.path.join(engine.jpath(jid), "任务.json"), {})
        assert meta["confirm_parse"] is False


def _events(job):
    out = []
    path = job / "events.jsonl"
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            out.append(json.loads(line))
    return out
