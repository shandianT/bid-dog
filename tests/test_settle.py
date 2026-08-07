from pathlib import Path
import hashlib

import pytest
from docx import Document

from conftest import events


def _texts(job):
    return [str(e.get("text") or "") for e in events(job) if e.get("type") in ("message", "error")]


def _latest(job, kind):
    return [e for e in events(job) if e.get("type") == kind][-1]


def _write_body_docx(path, paragraphs=80):
    document = Document()
    document.add_heading("投标文件", level=1)
    for index in range(paragraphs):
        document.add_paragraph("第%d项完整响应，满足招标文件要求并提供实施说明。" % (index + 1))
    document.save(path)


def _sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def test_body_word_is_the_only_direct_success(engine, job, monkeypatch):
    _write_body_docx(job / "投标文件_技术标.docx")
    monkeypatch.setattr(engine, "quality_audit", lambda *_: None)

    result = engine.settle(str(job))

    assert result["state"] == "done"
    assert engine.job_state(str(job)) == "done"
    assert _latest(job, "progress")["step"] == 12
    assert any("任务完成，已整理好" in text for text in _texts(job))


@pytest.mark.parametrize("payload", [b"x", b"PK" + b"not-a-real-word-file" * 300])
def test_corrupt_or_fake_docx_never_opens_the_delivery_gate(engine, job, payload):
    (job / "投标文件_技术标.docx").write_bytes(payload)

    result = engine.settle(str(job))

    assert result["state"] == "stopped"
    assert engine.job_state(str(job)) == "stopped"


def test_failed_redo_cannot_reuse_the_previous_word_as_new_success(engine, job):
    word = job / "投标文件_技术标.docx"
    _write_body_docx(word)
    meta = engine.read_json(str(job / "任务.json"), {})
    meta["redo_baseline"] = {"docx": {word.name: _sha256(word)}, "md": {}}
    engine.write_json(str(job / "任务.json"), meta)

    result = engine.settle(str(job), stop_reason="已停止（定向重做失败）")

    assert result["state"] == "stopped"
    assert engine.job_state(str(job)) == "stopped"


def test_body_markdown_must_export_word_before_success(engine, job, monkeypatch):
    (job / "投标文件_技术标.md").write_text("# 正文\n" + "完整响应。" * 800, encoding="utf-8")

    def make_word(job_path, known):
        name = "投标文件_技术标.docx"
        _write_body_docx(Path(job_path, name))
        known.add(name)
        return [name]

    monkeypatch.setattr(engine, "ensure_docx", make_word)
    monkeypatch.setattr(engine, "quality_audit", lambda *_: None)

    result = engine.settle(str(job))

    assert result["state"] == "done"
    assert engine.job_state(str(job)) == "done"
    assert any("任务完成，已整理好" in text for text in _texts(job))


def test_analysis_only_is_stopped_with_real_progress_and_log_tail(engine, job):
    (job / "招标文件_解析版.md").write_text("解析依据" * 300, encoding="utf-8")
    (job / "run.log").write_text("\n".join("TAIL-%02d" % i for i in range(1, 13)), encoding="utf-8")

    result = engine.settle(str(job))

    assert result["state"] == "stopped"
    assert engine.job_state(str(job)) == "stopped"
    progress = _latest(job, "progress")
    assert progress["step"] == 1
    assert progress["pct"] == 2
    assert "生成中断" in progress["stage"]
    errors = [e for e in events(job) if e.get("type") == "error"]
    assert "TAIL-05" in errors[-1]["text"]
    assert "TAIL-12" in errors[-1]["text"]
    assert {a["act"] for a in errors[-1]["actions"]} >= {"open_log", "rerun"}
    assert not any("任务完成，已整理好" in text for text in _texts(job))
    health = _latest(job, "health")
    assert health["level"] == "red"
    assert "没有可交付的 Word" in health["summary"]
    assert "修复" not in str(health)


def test_empty_output_is_stopped_without_fake_completion(engine, job):
    result = engine.settle(str(job))

    assert result["state"] == "stopped"
    assert engine.job_state(str(job)) == "stopped"
    assert "没有产出" in _latest(job, "progress")["stage"]
    assert not any("任务完成，已整理好" in text for text in _texts(job))


def test_markdown_export_failure_never_becomes_done(engine, job, monkeypatch):
    (job / "投标文件_技术标.md").write_text("# 正文\n" + "完整响应。" * 800, encoding="utf-8")
    monkeypatch.setattr(engine, "ensure_docx", lambda *_: [])

    result = engine.settle(str(job))

    assert result["state"] == "stopped"
    assert engine.job_state(str(job)) == "stopped"
    health = _latest(job, "health")
    assert "没有可交付的 Word" in health["summary"]
    assert any(a["act"] == "export_docx" for g in health["gaps"] for a in g.get("actions", []))
    assert not any("任务完成，已整理好" in text for text in _texts(job))


@pytest.mark.parametrize("name", ["招标文件_解析版.md", "成品质检报告.md", "废标风险清单.md"])
def test_analysis_files_are_never_offered_for_repair(engine, job, name):
    (job / name).write_text("分析依据" * 500, encoding="utf-8")

    engine.quality_audit(str(job), set(engine.list_deliverables(str(job))))

    emitted = events(job)
    assert not any(a.get("act") == "repair" for e in emitted for a in e.get("actions", []))
    assert not any(
        a.get("act") == "repair"
        for e in emitted
        for gap in e.get("gaps", [])
        for a in gap.get("actions", [])
    )
