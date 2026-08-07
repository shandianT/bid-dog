import json

from conftest import events


def test_evidence_table_matches_twelve_product_steps(engine):
    assert len(engine.STAGES) == 12
    assert len(engine.STAGE_EVIDENCE) == 12
    assert [x["step"] for x in engine.STAGE_EVIDENCE] == list(range(1, 13))


def test_claimed_step_without_files_is_clamped_and_explained(engine, job):
    claim = {"type": "progress", "stage": "逐条应答", "pct": 70, "step": 8, "total": 12}

    accepted = engine.ingest_agent_event(str(job), claim)

    assert accepted["step"] < 8
    assert accepted["pct"] < 100
    assert engine.read_json(str(job / "progress.json"), {})["step"] < 8
    assert any("声称完成第 8 步" in " ".join(e.get("lines", [])) for e in events(job))


def test_agent_cannot_self_mark_an_unproven_claim_as_verified(engine, job):
    claim = {
        "type": "progress",
        "stage": "完成",
        "pct": 100,
        "step": 12,
        "total": 12,
        "verified": True,
    }

    accepted = engine.ingest_agent_event(str(job), claim)

    assert accepted["step"] < 12
    assert accepted["pct"] < 100


def test_raw_legacy_progress_is_sanitized_before_sse(engine, job):
    raw = {"type": "progress", "stage": "完成", "pct": 100, "step": 12, "total": 12}

    safe = engine.sanitize_event(str(job), raw)

    assert safe["step"] < 12
    assert safe["pct"] < 100


def test_halt_clamps_unverified_legacy_progress_to_disk_evidence(engine, job):
    engine.write_json(
        str(job / "progress.json"),
        {"type": "progress", "stage": "完成", "pct": 99, "step": 12, "total": 12},
    )

    engine.halt(str(job), "已停止（测试）")

    progress = engine.read_json(str(job / "progress.json"), {})
    assert progress["step"] < 12
    assert progress["pct"] <= int(progress["step"] * 100 / 12)


def test_half_fixture_can_never_end_at_twelve(engine, job):
    (job / "招标文件_解析版.md").write_text("解析" * 800, encoding="utf-8")
    engine.settle(str(job))

    assert engine.read_json(str(job / "progress.json"), {})["step"] < 12
    assert engine.job_state(str(job)) == "stopped"


def test_agent_signal_file_is_not_the_canonical_event_stream(engine, job):
    claim_path = job / engine.AGENT_EVENTS_FILE
    claim_path.write_text(json.dumps({"type": "progress", "step": 8, "pct": 70}), encoding="utf-8")

    assert claim_path.name != "events.jsonl"


def test_agent_signal_drain_keeps_partial_line_for_next_poll(engine, job):
    claim_path = job / engine.AGENT_EVENTS_FILE
    first = json.dumps({"type": "progress", "step": 8, "pct": 70})
    claim_path.write_text(first + "\n" + '{"type":"progress"', encoding="utf-8")

    offset, accepted = engine.drain_agent_events(str(job), 0)

    assert offset == 1
    assert len(accepted) == 1
    assert accepted[0]["step"] < 8
    claim_path.write_text(
        first + "\n" + json.dumps({"type": "message", "role": "agent", "text": "continued"}) + "\n",
        encoding="utf-8",
    )
    offset, accepted = engine.drain_agent_events(str(job), offset)
    assert offset == 2
    assert accepted[0]["text"] == "continued"
