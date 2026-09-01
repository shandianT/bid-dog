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


def test_rewrite_note_holds_a_whole_batch_of_missing_scoring_points(engine, job):
    """一章漏了好几个评分点时，界面把它们拼成一条补充要求下发——引擎一次只接受一章
    重写（整单会被 _reserve_running_reason 锁住），逐条派发的后几条必然被挡回来，而且
    后一次重写还会盖掉前一次的稿子。所以上限必须装得下整批。

    一条能有多长不是猜的：_coverage_view 把「原要求」和「缺口」两列各截到 140 字，
    所以最坏情况下一条评分点连着缺口说明接近 300 字——招标文件里整句照抄的评分条款
    就是这个长度。两条就顶到旧的 500 上限，而截断的补充要求比没有更危险。"""
    _init_pipeline(job, [{"id": "c1", "title": "施工组织设计", "output": "章节_01_施工组织设计.md"}])
    req_max, gap_max = 140, 140     # 与 engine._coverage_view 对这两列的截断长度一致

    def fill(text, n):
        return (text * (n // len(text) + 1))[:n]

    points = [
        "%s（分值 %s）；需补齐：%s" % (fill(req, req_max), score, fill(gap, gap_max))
        for req, score, gap in (
            ("投标人须提供近三年承担的同类市政管网工程业绩，单项合同金额不低于伍仟万元，"
             "须附中标通知书、施工合同关键页、业主履约证明，缺一不计分。", "5",
             "〔需补充〕第三个案例的合同扫描件与业主联系人，现有两例只有中标通知书。"),
            ("拟派项目负责人须具备市政公用工程一级建造师注册证书及安全生产考核合格证，"
             "近三年未担任其他在建项目负责人，须提供社保缴纳证明与在职承诺函。", "4",
             "〔需补充〕建造师注册证书与安全考核合格证扫描件，社保证明只到 2025 年 6 月。"),
            ("投标人近三年获得省部级及以上工程质量奖项的每项加一分，最高两分，"
             "须提供获奖证书原件影印件并加盖发证单位或公证机关印章。", "2",
             "〔需补充〕省部级及以上获奖证明原件影印，素材库里只有企业自评材料。"),
        )
    ]
    note = "补写以下评分点应答，逐条落位到本章合适位置：\n" + "\n".join(
        "%d. %s" % (n + 1, text) for n, text in enumerate(points))
    assert len(note) > 500, "样本要真的超过旧上限，否则这条测试证明不了什么"
    assert len(note) <= generation_pipeline.REWRITE_NOTE_MAX

    stored = generation_pipeline.rewrite_node(str(job), "chapter_write:c1", note)
    assert stored["user_note"] == note                  # 一个字都没被截掉
    state = generation_pipeline.load(str(job))
    node = next(n for n in state["nodes"] if n["id"] == "chapter_write:c1")
    prompt = engine._pipeline_direct_task(str(job), node)
    for text in points:
        assert text in prompt                           # 每一条都真的进了这一章的写作要求


def test_rewrite_note_is_still_bounded(engine, job):
    """放宽不等于不设限：超过上限仍然截断，用户补充要求进不了无边界的 prompt。"""
    _init_pipeline(job, [{"id": "c1", "title": "施工组织设计", "output": "章节_01_施工组织设计.md"}])
    node = generation_pipeline.rewrite_node(
        str(job), "chapter_write:c1", "补" * (generation_pipeline.REWRITE_NOTE_MAX + 500))
    assert len(node["user_note"]) == generation_pipeline.REWRITE_NOTE_MAX


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
