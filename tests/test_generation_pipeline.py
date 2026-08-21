import json
import sys
import zipfile
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "server"
if str(SERVER) not in sys.path:
    sys.path.insert(0, str(SERVER))

import generation_pipeline as pipeline


def _chapters():
    return [
        {"id": "01", "title": "项目理解", "output": "01_项目理解.md", "critical": False},
        {"id": "02", "title": "总体架构", "output": "02_总体架构.md", "critical": True},
    ]


def test_pipeline_initializes_bounded_nodes_and_freezes_fast_routes(tmp_path):
    state = pipeline.initialize(
        tmp_path,
        run_id="run-1",
        mode="fast",
        model_routes={"fast": "deepseek-v4-flash", "quality": "senseaudio-s2"},
        chapters=_chapters(),
        credential_fingerprint="abcdef123456",
        base_url="https://gateway.example/v1",
    )

    assert state["version"] == 1
    assert state["run_id"] == "run-1"
    assert state["mode"] == "fast"
    assert state["state"] == "pending"
    assert state["model_routes"] == {
        "fast": "deepseek-v4-flash",
        "quality": "senseaudio-s2",
        "credential_fingerprint": "abcdef123456",
        "base_url": "https://gateway.example/v1",
    }
    assert [node["id"] for node in state["nodes"]] == [
        "source_parse",
        "response_plan",
        "chapter_write:01",
        "chapter_write:02",
        "chapter_write:technical_deviation",
        "chapter_write:business_deviation",
        "assemble",
        "quality_review",
        "word_export",
        "delivery_gate",
    ]
    assert next(node for node in state["nodes"] if node["id"] == "chapter_write:02")["model_tier"] == "fast"
    assert next(node for node in state["nodes"] if node["id"] == "quality_review")["kind"] == "local"
    assert json.loads((tmp_path / "pipeline.json").read_text(encoding="utf-8")) == state


def test_standard_mode_routes_only_quality_review_to_quality_model(tmp_path):
    state = pipeline.initialize(
        tmp_path,
        run_id="run-standard",
        mode="standard",
        model_routes={"fast": "deepseek-v4-flash", "quality": "senseaudio-s2"},
        chapters=_chapters(),
    )

    model_tiers = {node["id"]: node["model_tier"] for node in state["nodes"]}
    assert model_tiers["response_plan"] == "fast"
    assert model_tiers["chapter_write:01"] == "fast"
    assert model_tiers["chapter_write:02"] == "fast"
    assert model_tiers["quality_review"] == "quality"
    assert next(node for node in state["nodes"] if node["id"] == "quality_review")["kind"] == "model"


def test_done_node_is_reused_and_input_change_requires_a_new_attempt(tmp_path):
    pipeline.initialize(
        tmp_path,
        run_id="run-1",
        mode="fast",
        model_routes={"fast": "deepseek-v4-flash", "quality": "senseaudio-s2"},
        chapters=_chapters(),
    )
    output = tmp_path / "01_项目理解.md"
    output.write_text("# 项目理解\n\n" + "依据与响应。" * 80, encoding="utf-8")

    started = pipeline.start_node(tmp_path, "chapter_write:01", input_digest="digest-a")
    assert started["attempt"] == 1
    done = pipeline.complete_node(tmp_path, "chapter_write:01", input_digest="digest-a")
    assert done["state"] == "done"

    reused = pipeline.start_node(tmp_path, "chapter_write:01", input_digest="digest-a")
    assert reused["state"] == "done"
    assert reused["attempt"] == 1

    restarted = pipeline.start_node(tmp_path, "chapter_write:01", input_digest="digest-b")
    assert restarted["state"] == "running"
    assert restarted["attempt"] == 1


def test_complete_node_rejects_missing_or_too_thin_outputs(tmp_path):
    pipeline.initialize(
        tmp_path,
        run_id="run-1",
        mode="fast",
        model_routes={"fast": "deepseek-v4-flash", "quality": "senseaudio-s2"},
        chapters=_chapters(),
    )
    pipeline.start_node(tmp_path, "chapter_write:01", input_digest="digest-a")

    with pytest.raises(pipeline.OutputValidationError, match="输出文件不存在"):
        pipeline.complete_node(tmp_path, "chapter_write:01", input_digest="digest-a")

    (tmp_path / "01_项目理解.md").write_text("太短", encoding="utf-8")
    with pytest.raises(pipeline.OutputValidationError, match="内容不足"):
        pipeline.complete_node(tmp_path, "chapter_write:01", input_digest="digest-a")


def test_recover_preserves_done_nodes_and_resets_only_unfinished_nodes(tmp_path):
    pipeline.initialize(
        tmp_path,
        run_id="run-1",
        mode="fast",
        model_routes={"fast": "deepseek-v4-flash", "quality": "senseaudio-s2"},
        chapters=_chapters(),
    )
    (tmp_path / "01_项目理解.md").write_text("# 项目理解\n\n" + "内容。" * 120, encoding="utf-8")
    pipeline.start_node(tmp_path, "chapter_write:01", input_digest="a")
    pipeline.complete_node(tmp_path, "chapter_write:01", input_digest="a")
    pipeline.start_node(tmp_path, "chapter_write:02", input_digest="b")
    pipeline.fail_node(tmp_path, "response_plan", "stream_idle_timeout", retryable=True)

    recovered = pipeline.recover(tmp_path)
    by_id = {node["id"]: node for node in recovered["nodes"]}
    assert by_id["chapter_write:01"]["state"] == "done"
    assert by_id["chapter_write:02"]["state"] == "pending"
    assert by_id["response_plan"]["state"] == "pending"
    assert recovered["state"] == "pending"
    assert recovered["recoverable"] is True


def test_pipeline_summary_reports_real_node_counts_and_retry(tmp_path):
    pipeline.initialize(
        tmp_path,
        run_id="run-1",
        mode="fast",
        model_routes={"fast": "deepseek-v4-flash", "quality": "senseaudio-s2"},
        chapters=_chapters(),
    )
    pipeline.start_node(tmp_path, "chapter_write:01", input_digest="a")
    pipeline.fail_node(tmp_path, "chapter_write:02", "stream_idle_timeout", retryable=True, retry_after=18)

    summary = pipeline.summary(tmp_path)
    assert summary["total"] == 10
    assert summary["running"] == 1
    assert summary["waiting"] == 8
    assert summary["retrying"] == 1
    assert summary["current_nodes"] == ["chapter_write:01"]
    assert summary["retry"] == {
        "node_id": "chapter_write:02",
        "attempt": 0,
        "max_attempts": 3,
        "retry_after_seconds": 18,
        "error_code": "stream_idle_timeout",
    }


def test_pipeline_file_never_persists_credentials_or_customer_text(tmp_path):
    secret = "s" + "k-example-secret-that-must-not-be-written"
    customer_text = "某客户内部预算与项目正文"
    pipeline.initialize(
        tmp_path,
        run_id="run-1",
        mode="fast",
        model_routes={"fast": "deepseek-v4-flash", "quality": "senseaudio-s2"},
        chapters=_chapters(),
        credential_fingerprint=pipeline.credential_fingerprint(secret),
        base_url="https://user:password@gateway.example/v1?token=query-secret#fragment",
    )
    raw = (tmp_path / "pipeline.json").read_text(encoding="utf-8")
    assert secret not in raw
    assert customer_text not in raw
    assert "sk-example" not in raw
    assert "user:password" not in raw
    assert "query-secret" not in raw
    assert "https://gateway.example/v1" in raw


def test_parse_text_source_writes_reusable_markdown_and_safe_manifest(tmp_path):
    source = tmp_path / "采购需求.txt"
    source.write_text("第一章 采购需求\n" + "系统建设、实施服务与验收要求。" * 20, encoding="utf-8")

    result = pipeline.parse_source(tmp_path, source.name)

    parsed = (tmp_path / "招标文件_解析版.md").read_text(encoding="utf-8")
    manifest = json.loads((tmp_path / "source_manifest.json").read_text(encoding="utf-8"))
    assert "系统建设" in parsed
    assert result["reused_extract"] is False
    assert manifest["source_name"] == source.name
    assert manifest["source_type"] == "txt"
    assert manifest["sha256"] == pipeline.file_digest([source])
    assert manifest["char_count"] >= 80
    assert "系统建设" not in json.dumps(manifest, ensure_ascii=False)


def test_parse_docx_source_extracts_paragraphs_and_table_cells(tmp_path):
    docx = pytest.importorskip("docx")
    source = tmp_path / "招标文件.docx"
    document = docx.Document()
    document.add_heading("第一章 项目概况", level=1)
    document.add_paragraph("本项目建设统一业务平台。" * 8)
    table = document.add_table(rows=2, cols=2)
    table.cell(0, 0).text = "评分项目"
    table.cell(0, 1).text = "评分标准"
    table.cell(1, 0).text = "实施方案"
    table.cell(1, 1).text = "完整得 10 分"
    document.save(source)

    result = pipeline.parse_source(tmp_path, source.name)

    parsed = (tmp_path / "招标文件_解析版.md").read_text(encoding="utf-8")
    assert "第一章 项目概况" in parsed
    assert "完整得 10 分" in parsed
    assert result["paragraph_count"] >= 2
    assert result["table_count"] == 1


def test_parse_source_reuses_cached_extract_without_parsing_docx_again(tmp_path, monkeypatch):
    source = tmp_path / "招标文件.docx"
    source.write_bytes(b"not-a-real-docx-but-cache-is-authoritative")
    cached = "第一章 招标范围\n" + "采购软件平台、部署、培训和运维服务。" * 20

    def should_not_run(_path):
        raise AssertionError("已有提取结果时不应再次打开 DOCX")

    monkeypatch.setattr(pipeline, "_extract_docx", should_not_run)
    result = pipeline.parse_source(
        tmp_path,
        source.name,
        cached_text=cached,
        cached_metadata={"heading_count": 1, "table_count": 0, "complete": True},
    )

    assert result["reused_extract"] is True
    assert result["heading_count"] == 1
    assert cached in (tmp_path / "招标文件_解析版.md").read_text(encoding="utf-8")


def test_parse_source_rejects_empty_or_image_only_input(tmp_path):
    source = tmp_path / "空白.txt"
    source.write_text(" \n", encoding="utf-8")

    with pytest.raises(pipeline.SourceParseError, match="未提取到足够正文"):
        pipeline.parse_source(tmp_path, source.name)


def test_docx_archive_guard_rejects_suspicious_expansion(tmp_path, monkeypatch):
    source = tmp_path / "异常.docx"
    with zipfile.ZipFile(source, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("word/document.xml", "A" * 20000)
    monkeypatch.setattr(pipeline, "DOCX_MAX_COMPRESSION_RATIO", 2)

    with pytest.raises(pipeline.SourceParseError, match="压缩比异常"):
        pipeline.parse_source(tmp_path, source.name)


def test_model_node_retries_only_current_node_and_uses_fast_route(tmp_path):
    pipeline.initialize(
        tmp_path,
        run_id="run-retry",
        mode="fast",
        model_routes={"fast": "deepseek-v4-flash", "quality": "senseaudio-s2"},
        chapters=_chapters(),
    )
    (tmp_path / "招标文件_解析版.md").write_text("# 解析\n" + "采购需求。" * 40, encoding="utf-8")
    calls = []

    def runner(node, prompt, model):
        calls.append((node["id"], model, prompt))
        if len(calls) == 1:
            raise pipeline.NodeExecutionError("stream_idle_timeout", retryable=True)
        for output in node["outputs"]:
            if output == "response_plan.json":
                (tmp_path / output).write_text(json.dumps({"chapters": [
                    {"id": "01", "title": "项目理解", "output": "01_项目理解.md",
                     "basis": ["采购需求"], "scoring_points": ["方案完整性"],
                     "material_slots": [], "dependencies": []}
                ]}, ensure_ascii=False), encoding="utf-8")
            else:
                (tmp_path / output).write_text("# 分析\n" + "逐项响应。" * 40, encoding="utf-8")

    result = pipeline.run_model_node(
        tmp_path,
        "response_plan",
        runner,
        prompt="读取解析版并写三个规划文件",
        sleep=lambda _seconds: None,
    )

    assert result["state"] == "done"
    assert result["attempt"] == 2
    assert [call[0] for call in calls] == ["response_plan", "response_plan"]
    assert {call[1] for call in calls} == {"deepseek-v4-flash"}
    assert pipeline.summary(tmp_path)["done"] == 1


def test_completed_model_node_is_not_replayed_on_resume(tmp_path):
    pipeline.initialize(
        tmp_path,
        run_id="run-resume",
        mode="fast",
        model_routes={"fast": "deepseek-v4-flash", "quality": "senseaudio-s2"},
        chapters=_chapters(),
    )
    output = tmp_path / "01_项目理解.md"
    output.write_text("# 项目理解\n" + "正文。" * 80, encoding="utf-8")
    digest = "unchanged-input"
    pipeline.start_node(tmp_path, "chapter_write:01", input_digest=digest)
    pipeline.complete_node(tmp_path, "chapter_write:01", input_digest=digest)

    called = []
    result = pipeline.run_model_node(
        tmp_path,
        "chapter_write:01",
        lambda *_args: called.append(True),
        prompt="不会执行",
        input_digest=digest,
    )

    assert result["state"] == "done"
    assert called == []


def test_standard_quality_node_uses_quality_route(tmp_path):
    pipeline.initialize(
        tmp_path,
        run_id="run-quality",
        mode="standard",
        model_routes={"fast": "deepseek-v4-flash", "quality": "senseaudio-s2"},
        chapters=_chapters(),
    )
    used = []

    def runner(node, _prompt, model):
        used.append((node["id"], model))
        (tmp_path / "成品质检报告.md").write_text("# 复核\n" + "检查结论。" * 20, encoding="utf-8")

    pipeline.run_model_node(tmp_path, "quality_review", runner, prompt="复核整册")

    assert used == [("quality_review", "senseaudio-s2")]


def test_attempt_outputs_are_validated_before_atomic_promotion(tmp_path):
    pipeline.initialize(
        tmp_path, run_id="run-attempt", mode="fast",
        model_routes={"fast": "deepseek-v4-flash", "quality": "senseaudio-s2"},
        chapters=_chapters(),
    )
    official = tmp_path / "01_项目理解.md"
    official.write_text("旧的正式内容" * 80, encoding="utf-8")
    node = pipeline.start_node(tmp_path, "chapter_write:01", input_digest="new")
    attempt = pipeline.attempt_directory(tmp_path, node)
    (attempt / "01_项目理解.md").write_text("太短", encoding="utf-8")

    with pytest.raises(pipeline.OutputValidationError):
        pipeline.promote_outputs(tmp_path, attempt, node)
    assert official.read_text(encoding="utf-8").startswith("旧的正式内容")

    (attempt / "01_项目理解.md").write_text("新的完整内容。" * 80, encoding="utf-8")
    pipeline.promote_outputs(tmp_path, attempt, node)
    assert official.read_text(encoding="utf-8").startswith("新的完整内容")


def test_recover_does_not_bypass_max_attempts_and_manual_retry_is_explicit(tmp_path):
    pipeline.initialize(
        tmp_path, run_id="run-limit", mode="fast",
        model_routes={"fast": "deepseek-v4-flash", "quality": "senseaudio-s2"},
        chapters=_chapters(),
    )
    previous_attempt_dirs = []
    for _ in range(3):
        node = pipeline.start_node(tmp_path, "chapter_write:01", input_digest="same")
        previous_attempt_dirs.append(pipeline.attempt_directory(tmp_path, node))
        pipeline.fail_node(tmp_path, "chapter_write:01", "stream_idle_timeout", retryable=True)
    assert node["attempt"] == 3
    recovered = pipeline.recover(tmp_path)
    failed = next(item for item in recovered["nodes"] if item["id"] == "chapter_write:01")
    assert failed["state"] == "failed"
    with pytest.raises(pipeline.PipelineError, match="最大尝试次数"):
        pipeline.start_node(tmp_path, "chapter_write:01", input_digest="same")

    reset = pipeline.retry_node(tmp_path, "chapter_write:01")
    assert reset["state"] == "pending"
    assert reset["attempt"] == 0
    restarted = pipeline.start_node(tmp_path, "chapter_write:01", input_digest="same")
    assert pipeline.attempt_directory(tmp_path, restarted) not in previous_attempt_dirs


def test_word_output_must_be_a_real_docx_archive(tmp_path):
    pipeline.initialize(
        tmp_path, run_id="run-word", mode="fast",
        model_routes={"fast": "deepseek-v4-flash", "quality": "senseaudio-s2"},
        chapters=_chapters(),
    )
    node = pipeline.start_node(tmp_path, "word_export", input_digest="word")
    (tmp_path / "投标文件_整册.docx").write_bytes(b"PK" + b"0" * 2048)
    with pytest.raises(pipeline.OutputValidationError, match="有效 DOCX"):
        pipeline.validate_outputs(tmp_path, node)


def _finish_response_plan(tmp_path, chapters):
    for name in ("投标文件组成.md", "评分点响应矩阵.md", "废标风险清单.md"):
        (tmp_path / name).write_text("# 规划\n\n" + "逐项响应。" * 40, encoding="utf-8")
    (tmp_path / "response_plan.json").write_text(
        json.dumps({"chapters": chapters}, ensure_ascii=False), encoding="utf-8")
    pipeline.start_node(tmp_path, "response_plan", input_digest="plan")
    pipeline.complete_node(tmp_path, "response_plan", input_digest="plan")


def test_response_plan_replaces_provisional_chapters_with_validated_dag(tmp_path):
    pipeline.initialize(
        tmp_path, run_id="dynamic", mode="fast",
        model_routes={"fast": "fast", "quality": "quality"}, chapters=_chapters(),
    )
    _finish_response_plan(tmp_path, [
        {"id": "overview", "title": "项目理解", "output": "规划_项目理解.md",
         "basis": ["采购需求"], "scoring_points": ["理解完整性"],
         "material_slots": ["项目案例"], "dependencies": []},
        {"id": "delivery", "title": "实施交付", "output": "规划_实施交付.md",
         "basis": ["交付要求"], "scoring_points": [],
         "material_slots": [], "dependencies": ["overview"]},
    ])

    state = pipeline.apply_response_plan(tmp_path)
    chapters = [node for node in state["nodes"] if node["id"].startswith("chapter_write:")]

    assert [node["id"] for node in chapters] == [
        "chapter_write:overview", "chapter_write:delivery",
        "chapter_write:technical_deviation", "chapter_write:business_deviation",
    ]
    delivery = next(node for node in chapters if node["id"] == "chapter_write:delivery")
    assert delivery["dependencies"] == ["chapter_write:overview"]
    overview = next(node for node in chapters if node["id"] == "chapter_write:overview")
    assert overview["basis"] == ["采购需求"]
    assert overview["scoring_points"] == ["理解完整性"]
    assert overview["material_slots"] == ["项目案例"]
    assert not any(node["id"] in ("chapter_write:01", "chapter_write:02") for node in chapters)


@pytest.mark.parametrize("chapters,error", [
    ([
        {"id": "same", "title": "A", "output": "a.md", "basis": ["a"],
         "scoring_points": [], "material_slots": [], "dependencies": []},
        {"id": "same", "title": "B", "output": "b.md", "basis": ["b"],
         "scoring_points": [], "material_slots": [], "dependencies": []},
    ], "id"),
    ([
        {"id": "a", "title": "A", "output": "a.md", "basis": ["a"],
         "scoring_points": [], "material_slots": [], "dependencies": ["b"]},
        {"id": "b", "title": "B", "output": "b.md", "basis": ["b"],
         "scoring_points": [], "material_slots": [], "dependencies": ["a"]},
    ], "环"),
    ([
        {"id": "technical_deviation", "title": "A", "output": "a.md", "basis": ["a"],
         "scoring_points": [], "material_slots": [], "dependencies": []},
    ], "id"),
    ([
        {"id": "A", "title": "A", "output": "A.md", "basis": ["a"],
         "scoring_points": [], "material_slots": [], "dependencies": []},
        {"id": "a", "title": "B", "output": "a.md", "basis": ["b"],
         "scoring_points": [], "material_slots": [], "dependencies": []},
    ], "id"),
])
def test_response_plan_rejects_duplicate_cycle_or_reserved_id(tmp_path, chapters, error):
    pipeline.initialize(
        tmp_path, run_id="invalid", mode="fast",
        model_routes={"fast": "fast", "quality": "quality"}, chapters=_chapters(),
    )
    with pytest.raises(pipeline.OutputValidationError, match=error):
        _finish_response_plan(tmp_path, chapters)


@pytest.mark.parametrize("output", [
    "bad:name.md", "bad?.md", "bad*name.md", "bad|name.md", "AUX .md",
    "AUX.foo.md", "CON.any.md", "NUL.backup.md",
    "COM¹.md", "COM².md", "COM³.md", "LPT¹.md", "LPT².md", "LPT³.md",
])
def test_response_plan_rejects_windows_unsafe_output_names(tmp_path, output):
    pipeline.initialize(
        tmp_path, run_id="windows-name", mode="fast",
        model_routes={"fast": "fast", "quality": "quality"}, chapters=_chapters(),
    )
    with pytest.raises(pipeline.OutputValidationError, match="输出文件不安全"):
        _finish_response_plan(tmp_path, [{
            "id": "safe", "title": "项目理解", "output": output,
            "basis": ["采购需求"], "scoring_points": [],
            "material_slots": [], "dependencies": [],
        }])


@pytest.mark.parametrize("output", [
    ("a" * 253) + ".md",
    ("中" * 90) + ".md",
    ("😀" * 121) + ".md",
])
def test_response_plan_rejects_cross_platform_overlong_output_names(tmp_path, output):
    pipeline.initialize(
        tmp_path, run_id="overlong-name", mode="fast",
        model_routes={"fast": "fast", "quality": "quality"}, chapters=_chapters(),
    )
    with pytest.raises(pipeline.OutputValidationError, match="输出文件不安全"):
        _finish_response_plan(tmp_path, [{
            "id": "safe", "title": "项目理解", "output": output,
            "basis": ["采购需求"], "scoring_points": [],
            "material_slots": [], "dependencies": [],
        }])


def test_response_plan_rejects_unicode_equivalent_output_names(tmp_path):
    pipeline.initialize(
        tmp_path, run_id="unicode-alias", mode="fast",
        model_routes={"fast": "fast", "quality": "quality"}, chapters=_chapters(),
    )
    with pytest.raises(pipeline.OutputValidationError, match="输出文件不安全"):
        _finish_response_plan(tmp_path, [
            {"id": "one", "title": "第一章", "output": "é.md", "basis": ["a"],
             "scoring_points": [], "material_slots": [], "dependencies": []},
            {"id": "two", "title": "第二章", "output": "e\u0301.md", "basis": ["b"],
             "scoring_points": [], "material_slots": [], "dependencies": []},
        ])


@pytest.mark.parametrize("field", ["output", "title", "basis", "scoring_points", "material_slots"])
def test_response_plan_rejects_isolated_unicode_surrogates_as_validation_error(tmp_path, field):
    pipeline.initialize(
        tmp_path, run_id="unicode-surrogate", mode="fast",
        model_routes={"fast": "fast", "quality": "quality"}, chapters=_chapters(),
    )
    chapter = {"id": "safe", "title": "项目理解", "output": "safe.md",
               "basis": ["采购需求"], "scoring_points": [],
               "material_slots": [], "dependencies": []}
    chapter[field] = ["bad\ud800"] if field in {"basis", "scoring_points", "material_slots"} else "bad\ud800.md"
    for name in ("投标文件组成.md", "评分点响应矩阵.md", "废标风险清单.md"):
        (tmp_path / name).write_text("# 规划\n\n" + "逐项响应。" * 40, encoding="utf-8")
    (tmp_path / "response_plan.json").write_text(
        json.dumps({"chapters": [chapter]}, ensure_ascii=True), encoding="utf-8")
    pipeline.start_node(tmp_path, "response_plan", input_digest="plan")
    with pytest.raises(pipeline.OutputValidationError, match="Unicode"):
        pipeline.complete_node(tmp_path, "response_plan", input_digest="plan")


def test_reapplying_same_response_plan_preserves_completed_chapter_checkpoint(tmp_path):
    pipeline.initialize(
        tmp_path, run_id="idempotent", mode="fast",
        model_routes={"fast": "fast", "quality": "quality"}, chapters=_chapters(),
    )
    planned = [{"id": "overview", "title": "项目理解", "output": "规划_项目理解.md",
                "basis": ["采购需求"], "scoring_points": [],
                "material_slots": [], "dependencies": []}]
    _finish_response_plan(tmp_path, planned)
    pipeline.apply_response_plan(tmp_path)
    output = tmp_path / "规划_项目理解.md"
    output.write_text("# 项目理解\n\n" + "有依据的响应。" * 80, encoding="utf-8")
    pipeline.start_node(tmp_path, "chapter_write:overview", input_digest="chapter")
    before = pipeline.complete_node(tmp_path, "chapter_write:overview", input_digest="chapter")

    state = pipeline.apply_response_plan(tmp_path)
    after = next(node for node in state["nodes"] if node["id"] == "chapter_write:overview")

    assert after["state"] == "done"
    assert after["attempt"] == before["attempt"] == 1
    assert after["finished_at"] == before["finished_at"]


def test_cancelled_model_node_returns_to_recoverable_pending_without_consuming_attempt(tmp_path):
    pipeline.initialize(
        tmp_path, run_id="cancelled", mode="fast",
        model_routes={"fast": "fast", "quality": "quality"}, chapters=_chapters(),
    )

    with pytest.raises(pipeline.NodeExecutionError) as caught:
        pipeline.run_model_node(
            tmp_path, "chapter_write:01",
            lambda *_args: (_ for _ in ()).throw(
                pipeline.NodeExecutionError("cancelled", retryable=False)),
            prompt="cancel",
        )

    state = pipeline.load(tmp_path)
    node = next(item for item in state["nodes"] if item["id"] == "chapter_write:01")
    assert caught.value.code == "cancelled"
    assert node["state"] == "pending"
    assert node["attempt"] == 0
    assert state["recoverable"] is True
