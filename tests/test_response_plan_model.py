"""响应规划:本地索引永远先落盘,模型只做逐项核对;核对不成不拖垮整单。

背景:默认流水线里 response_plan 曾经完全不调模型——评分点矩阵只是含「分」字的行,
「响应位置」是一句常量,「缺口」全是〔需补充〕,于是覆盖仪表永远 0/N,按章补写一条
都派不出去。这组测试钉住新契约:
  · 本地索引先写好(保底);
  · 模型核对成功 → 落位只认真实章节,分值统一「N 分」,无缺口写「无」,覆盖能算出来;
  · 模型核对失败/关掉 → 沿用本地索引,节点照样完成,界面拿到 plan_source='local'。
"""
import json
import urllib.error
from pathlib import Path

import pytest


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


TENDER = (
    "# 评标办法\n\n综合评分法,总分 100 分。\n\n"
    "技术方案 60 分:实施方案完整性。\n售后服务 40 分:响应时间承诺。\n\n"
    "# 资格审查\n\n须提供有效营业执照,否则按无效投标处理。\n"
)

MODEL_PLAN = {
    "composition": ["投标函", "技术响应文件"],
    "scoring_points": [
        {"requirement": "实施方案完整性", "score": "60", "location": "技术与服务响应",
         "evidence": "实施方案正文", "gap": ""},
        {"requirement": "响应时间承诺", "score": "40 分", "location": "第2章",
         "evidence": "售后承诺函", "gap": "无"},
    ],
    "risks": [{"category": "资格", "requirement": "须提供有效营业执照",
               "risk": "缺失按无效投标处理", "action": "提交前核验并盖章"}],
    "chapter_guidance": [{"title": "技术与服务响应", "basis": ["技术方案 60 分"],
                          "scoring_points": ["实施方案完整性"], "material_slots": ["实施案例"]}],
}


def _plan_job(engine, tmp_path, name, tender=TENDER):
    job = Path(engine.jpath(name))
    job.mkdir(parents=True)
    skill_dir = tmp_path / (name + "-skill")
    skill_dir.mkdir()
    (skill_dir / "SKILL.md").write_text(
        "# 投标写作规则\n\n不得编造资质；未知事实标记为需补充。\n", encoding="utf-8")
    conf = _checkpoint_config(engine)
    conf["engine"]["skill_dir"] = str(skill_dir)
    engine.write_json(engine.conf_path(), conf)
    engine.write_json(str(job / "任务.json"), {
        "name": name, "run_id": "run-" + name, "tender": "采购文件.md"})
    engine.generation_pipeline.initialize(
        job, run_id="run-" + name, mode="fast",
        model_routes={"fast": engine.S2_DEFAULT_MODEL, "quality": engine.S2_QUALITY_MODEL},
        chapters=[
            {"id": "01", "title": "技术与服务响应", "output": "章节_01_技术与服务响应.md"},
            {"id": "02", "title": "售后服务方案", "output": "章节_02_售后服务方案.md"},
        ])
    (job / "招标文件_解析版.md").write_text(tender, encoding="utf-8")
    engine._set_skill_manifest(str(job), str(skill_dir), "plan-check", True,
                               "direct_model_completion")
    node = next(item for item in engine.generation_pipeline.load(job)["nodes"]
                if item["id"] == "response_plan")
    node.update({"attempt": 1, "attempt_serial": 1})
    return job, node


def _matrix_rows(engine, job):
    return engine._md_table_rows(str(Path(job) / "评分点响应矩阵.md"), 6)


def _diagnostic_codes(job):
    path = Path(job) / "diagnostics.jsonl"
    if not path.is_file():
        return []
    return [json.loads(line).get("code") for line in
            path.read_text(encoding="utf-8").splitlines() if line.strip()]


@pytest.fixture
def no_sleep(engine, monkeypatch):
    monkeypatch.setattr(engine.time, "sleep", lambda *_args, **_kwargs: None)


def test_model_check_locates_scoring_points_so_coverage_can_be_computed(
    engine, tmp_path, monkeypatch, no_sleep
):
    job, node = _plan_job(engine, tmp_path, "plan-model-ok")
    calls = []

    def fake_stream(_base, _key, payload, **_kwargs):
        calls.append(payload)
        return {"choices": [{"finish_reason": "stop",
                             "message": {"content": json.dumps(MODEL_PLAN, ensure_ascii=False)}}]}

    monkeypatch.setattr(engine, "_openai_stream_req", fake_stream)
    monkeypatch.setattr(engine, "_openai_req", lambda *_a, **_k: (_ for _ in ()).throw(
        AssertionError("stream path must be used first")))

    engine._pipeline_model_runner(str(job), node, "提取响应规划", engine.S2_DEFAULT_MODEL)

    # 模型拿到的是:章节目录 + 本地候选 + 招标节选;温度 0,规划契约在 system 里
    assert len(calls) == 1
    system, user = calls[0]["messages"][0]["content"], calls[0]["messages"][1]["content"]
    assert "location 只能从「章节目录」里原样照抄" in system
    assert "总分 100 分" in system
    assert "1. 技术与服务响应\n2. 售后服务方案" in user
    assert "本地索引候选" in user and "技术方案 60 分:实施方案完整性" in user
    assert calls[0]["temperature"] == 0 and calls[0]["max_tokens"] == 3200

    plan = engine.read_json(str(job / "response_plan.json"), {})
    assert plan["source"] == "model" and plan["model"] == engine.S2_DEFAULT_MODEL
    rows = _matrix_rows(engine, job)
    assert [(r[1], r[2], r[3], r[5]) for r in rows] == [
        ("实施方案完整性", "60 分", "技术与服务响应", "无"),
        ("响应时间承诺", "40 分", "售后服务方案", "无"),      # 「第2章」落到了真实标题
    ]
    matrix = (job / "评分点响应矩阵.md").read_text(encoding="utf-8")
    assert "规划来源:模型逐项核对" in matrix
    assert "缺失按无效投标处理" in (job / "废标风险清单.md").read_text(encoding="utf-8")
    assert "plan_model_checked" in _diagnostic_codes(job)

    # 覆盖口径终于算得出来:两条都落到了章节,章节没写完 → chapter_pending
    view = engine._coverage_view(str(job))
    assert view["plan_source"] == "model"
    assert view["total"] == 2 and view["covered"] == 0
    assert {item["node_id"] for item in view["items"]} == {"chapter_write:01", "chapter_write:02"}
    assert {item["reason"] for item in view["items"]} == {"chapter_pending"}

    # 规划应用到 DAG 后,本章提示词拿到的是「本章要拿的分」而不是含'分'字的句子
    engine.generation_pipeline.start_node(job, "response_plan", input_digest="plan")
    engine.generation_pipeline.complete_node(job, "response_plan", input_digest="plan")
    state = engine.generation_pipeline.apply_response_plan(job)
    first = next(n for n in state["nodes"] if n["id"] == "chapter_write:01")
    second = next(n for n in state["nodes"] if n["id"] == "chapter_write:02")
    assert "实施方案完整性(60 分)" in first["scoring_points"]
    assert first["material_slots"] == ["实施案例"]
    assert "响应时间承诺(40 分)" in second["scoring_points"]

    # 写完第一章 → 覆盖 1/2
    (job / "章节_01_技术与服务响应.md").write_text(
        "# 技术与服务响应\n\n" + "逐项响应实施方案完整性要求。" * 40, encoding="utf-8")
    engine.generation_pipeline.start_node(job, "chapter_write:01", input_digest="c1")
    engine.generation_pipeline.complete_node(job, "chapter_write:01", input_digest="c1")
    view = engine._coverage_view(str(job))
    assert (view["covered"], view["total"]) == (1, 2)


def test_model_failure_keeps_the_local_index_and_completes_the_node(
    engine, tmp_path, monkeypatch, no_sleep
):
    job, node = _plan_job(engine, tmp_path, "plan-model-down")
    calls = []

    def broken(*_args, **_kwargs):
        calls.append(1)
        raise urllib.error.URLError("gateway reset")

    monkeypatch.setattr(engine, "_openai_stream_req", broken)
    monkeypatch.setattr(engine, "_openai_req", broken)

    engine._pipeline_model_runner(str(job), node, "提取响应规划", engine.S2_DEFAULT_MODEL)

    assert len(calls) == engine.PLAN_MODEL_TRIES          # 有限重试,然后放手
    plan = engine.read_json(str(job / "response_plan.json"), {})
    assert plan["source"] == "local"
    assert [item["title"] for item in plan["chapters"]] == ["技术与服务响应", "售后服务方案"]
    assert "本地关键词索引" in (job / "评分点响应矩阵.md").read_text(encoding="utf-8")
    assert "无效投标" in (job / "废标风险清单.md").read_text(encoding="utf-8")
    assert "plan_model_fallback" in _diagnostic_codes(job)
    view = engine._coverage_view(str(job))
    assert view["plan_source"] == "local"
    assert all(item["node_id"] == "" for item in view["items"])   # 候选项没有落位,界面按「待核对」显示
    assert engine.skill_evidence(str(job))["state"] == "verified"


def test_plan_model_can_be_switched_off_by_environment(engine, tmp_path, monkeypatch):
    monkeypatch.setenv("BIDDOG_PLAN_MODEL", "0")
    job, node = _plan_job(engine, tmp_path, "plan-model-off")
    monkeypatch.setattr(engine, "_openai_stream_req", lambda *_a, **_k: (_ for _ in ()).throw(
        AssertionError("model must not be called when BIDDOG_PLAN_MODEL=0")))
    monkeypatch.setattr(engine, "_openai_req", lambda *_a, **_k: (_ for _ in ()).throw(
        AssertionError("model must not be called when BIDDOG_PLAN_MODEL=0")))

    engine._pipeline_model_runner(str(job), node, "提取响应规划", engine.S2_DEFAULT_MODEL)

    assert engine.read_json(str(job / "response_plan.json"), {})["source"] == "local"
    assert "plan_model_fallback" not in _diagnostic_codes(job)


def test_garbage_reply_is_retried_once_and_score_total_mismatch_is_flagged(
    engine, tmp_path, monkeypatch, no_sleep
):
    job, node = _plan_job(engine, tmp_path, "plan-model-retry")
    off = {**MODEL_PLAN, "scoring_points": [
        dict(MODEL_PLAN["scoring_points"][0], score="60"),
        dict(MODEL_PLAN["scoring_points"][1], score="10"),     # 合计 70,与总分 100 对不上
    ]}
    replies = ["这里没有 JSON,只有一段解释。", json.dumps(off, ensure_ascii=False)]
    calls = []

    def fake_stream(_base, _key, payload, **_kwargs):
        calls.append(payload)
        return {"choices": [{"finish_reason": "stop", "message": {"content": replies[len(calls) - 1]}}]}

    monkeypatch.setattr(engine, "_openai_stream_req", fake_stream)

    engine._pipeline_model_runner(str(job), node, "提取响应规划", engine.S2_DEFAULT_MODEL)

    assert len(calls) == 2
    plan = engine.read_json(str(job / "response_plan.json"), {})
    assert plan["source"] == "model"
    assert plan["notes"] and "总分 100 分不一致" in plan["notes"][0]
    assert "plan_score_total_mismatch" in _diagnostic_codes(job)
    assert "总分 100 分不一致" in (job / "评分点响应矩阵.md").read_text(encoding="utf-8")


def test_normalize_plan_only_trusts_real_chapter_titles(engine):
    titles = ["技术与服务响应", "售后服务方案", "商务响应与承诺"]
    assert engine._plan_match_title("售后服务方案", titles) == "售后服务方案"
    assert engine._plan_match_title("第三章", titles) == "商务响应与承诺"
    assert engine._plan_match_title("第 2 部分", titles) == "售后服务方案"
    assert engine._plan_match_title("技术响应", titles) == ""          # 不是包含关系就不硬凑
    assert engine._plan_match_title("售后服务", titles) == "售后服务方案"
    assert engine._plan_match_title("评分证据与对应章节", titles) == ""
    assert engine._plan_match_title("〔需补充〕", titles) == ""
    assert engine._cn_int("十二") == 12 and engine._cn_int("３") == 3 and engine._cn_int("abc") == 0

    assert engine._plan_score("20") == "20 分"
    assert engine._plan_score("7.5分") == "7.5 分"
    assert engine._plan_score("二十分") == "未知"
    assert engine._plan_score(None) == "未知"

    assert engine._pipeline_normalize_plan("not a dict", titles) is None
    assert engine._pipeline_normalize_plan({"scoring_points": [], "risks": []}, titles) is None
    compact = engine._pipeline_normalize_plan({
        "scoring_points": [
            {"requirement": "A", "score": 5, "location": "不存在的章", "gap": ""},
            {"requirement": "", "score": 5, "location": "售后服务方案"},
        ],
        "risks": [{"requirement": "须密封"}],
    }, titles, candidate={"chapter_guidance": [{"title": "商务响应与承诺", "basis": ["候选依据"]}]})
    assert compact["scoring_points"] == [{
        "requirement": "A", "score": "5 分", "location": "", "evidence": "招标文件_解析版.md", "gap": "无"}]
    assert compact["risks"][0]["category"] == "实质性要求"
    guided = {g["title"]: g for g in compact["chapter_guidance"]}
    assert set(guided) == set(titles)                          # 模型没提到的章节也有一条依据
    assert guided["商务响应与承诺"]["basis"] == ["候选依据"]


def test_plan_context_prefers_scoring_sections_when_over_budget(engine):
    parsed = ("# 项目概况\n" + "概况。" * 400 + "\n# 评标办法\n评分细则若干。\n"
              + "# 附件\n" + "附件内容。" * 400)
    picked = engine._pipeline_plan_context(parsed, 600)
    assert picked.startswith("# 评标办法")                     # 评分章节优先整段保留
    assert "# 项目概况" in picked                              # 再用文档开头补齐
    assert len(picked) <= 620


def test_confirm_card_wording_follows_plan_source(engine, tmp_path):
    job = tmp_path / "confirm-wording"
    job.mkdir()
    engine.write_json(str(job / "任务.json"), {"name": "措辞", "tender": "招标.docx"})
    (job / "招标文件_解析版.md").write_text("综合评分法\n", encoding="utf-8")
    (job / "评分点响应矩阵.md").write_text(
        "| 序号 | 原要求/评分点 | 分值 | 响应位置 | 证据 | 缺口 |\n|---|---|---:|---|---|---|\n"
        "| 1 | A | 60 分 | 技术 | 正文 | 无 |\n| 2 | B | 40 分 | 售后 | 正文 | 无 |\n", encoding="utf-8")
    engine.write_json(str(job / "response_plan.json"), {"chapters": [], "source": "local"})
    assert engine._parse_confirm_summary(str(job))["scoring"] == "识别到 2 处评分相关条款(候选,待模型核对) · 综合评分法"
    engine.write_json(str(job / "response_plan.json"), {"chapters": [], "source": "model"})
    assert engine._parse_confirm_summary(str(job))["scoring"] == "共 2 个评分点 · 合计 100 分 · 综合评分法"
