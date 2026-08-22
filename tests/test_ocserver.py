import pytest
from urllib.parse import parse_qs, urlsplit


def _messages(engine, monkeypatch, payload, status=200):
    monkeypatch.setattr(engine, "oc_api", lambda *_args, **_kwargs: (status, payload))


@pytest.mark.parametrize(
    ("finish", "done", "error_text"),
    [
        (None, False, ""),
        ("tool-calls", False, ""),
        ("stop", True, ""),
        ("length", True, "长度"),
        ("content-filter", True, "拦截"),
        ("cancelled", True, "取消"),
    ],
)
def test_latest_assistant_finish_value_controls_turn_completion(
    engine, monkeypatch, finish, done, error_text
):
    _messages(engine, monkeypatch, [{"type": "assistant", "finish": finish}])

    actual_done, actual_error = engine.oc_turn("session-1")
    assert actual_done is done
    assert error_text in actual_error


def test_stop_from_a_user_message_is_not_completion(engine, monkeypatch):
    _messages(engine, monkeypatch, [{"type": "user", "finish": "stop"}])

    assert engine.oc_turn("session-1") == (False, "")


def test_latest_message_order_is_not_reversed(engine, monkeypatch):
    _messages(
        engine,
        monkeypatch,
        [
            {"type": "assistant", "finish": None},
            {"type": "assistant", "finish": "stop"},
        ],
    )

    assert engine.oc_turn("session-1") == (False, "")


def test_assistant_error_is_terminal_and_visible(engine, monkeypatch):
    _messages(
        engine,
        monkeypatch,
        [{"type": "assistant", "finish": "error", "error": {"message": "synthetic failure"}}],
    )

    done, error = engine.oc_turn("session-1")
    assert done is True
    assert error == "synthetic failure"


def test_missing_or_failed_message_list_is_never_guessed_complete(engine, monkeypatch):
    _messages(engine, monkeypatch, [], status=503)

    assert engine.oc_turn("session-1") == (False, "")


def test_probe_rejects_failed_prompt_even_when_message_list_is_empty(engine, monkeypatch):
    def fake_api(path, *_args, **_kwargs):
        if path.startswith("/session?directory="):
            return 200, {"id": "probe-session", "directory": str(engine.DATA)}
        if path.endswith(("/prompt", "/prompt_async")):
            return 500, {"error": "synthetic prompt failure"}
        if path.endswith("/message"):
            return 200, []
        raise AssertionError(path)

    monkeypatch.setattr(engine, "oc_api", fake_api)

    ok, reason = engine.oc_probe()

    assert ok is False
    assert "HTTP 500" in reason


def test_oc_send_uses_opencode_11818_parts_contract_and_pins_requested_model(engine, monkeypatch):
    captured = {}

    def fake_api(path, data=None, **_kwargs):
        captured.update({"path": path, "data": data})
        return 202, {}

    monkeypatch.setattr(engine, "oc_api", fake_api)
    model = {"providerID": "biddog-s2", "modelID": "senseaudio-s2"}

    ok, _body = engine.oc_send("session-1", "继续生成", model=model)

    assert ok is True
    assert captured["path"] == "/session/session-1/prompt_async"
    assert captured["data"]["model"] == model
    assert captured["data"]["parts"] == [{"type": "text", "text": "继续生成"}]
    assert "prompt" not in captured["data"]
    assert "delivery" not in captured["data"]


def test_oc_send_without_model_keeps_queue_delivery_for_running_session(engine, monkeypatch):
    captured = {}

    def fake_api(path, data=None, **_kwargs):
        captured.update({"path": path, "data": data})
        return 200, {}

    monkeypatch.setattr(engine, "oc_api", fake_api)

    ok, _body = engine.oc_send("session-1", "补充要求", delivery="queue")

    assert ok is True
    assert captured == {
        "path": "/api/session/session-1/prompt",
        "data": {"delivery": "queue", "prompt": {"text": "补充要求"}},
    }


def test_oc_turn_reads_11818_standard_messages_and_uses_latest_assistant(engine, monkeypatch):
    seen = []

    def fake_api(path, *_args, **_kwargs):
        seen.append(path)
        return 200, [
            {"info": {"role": "user", "time": {"created": 1}}},
            {"info": {"role": "assistant", "finish": "stop", "time": {"created": 2}}},
        ]

    monkeypatch.setattr(engine, "oc_api", fake_api)

    assert engine.oc_turn("session-1") == (True, "")
    assert seen == ["/session/session-1/message"]


def test_oc_create_session_uses_11818_formal_contract_and_preserves_directory(
    engine, monkeypatch, tmp_path
):
    captured = {}

    def fake_api(path, data=None, **_kwargs):
        captured.update({"path": path, "data": data})
        return 200, {"id": "session-1", "directory": str(tmp_path)}

    monkeypatch.setattr(engine, "oc_api", fake_api)

    sid = engine.oc_create_session(str(tmp_path), "节点隔离会话")

    parsed = urlsplit(captured["path"])
    assert sid == "session-1"
    assert parsed.path == "/session"
    assert parse_qs(parsed.query) == {"directory": [str(tmp_path)]}
    assert captured["data"] == {"title": "节点隔离会话"}


def test_oc_create_session_accepts_same_directory_through_platform_alias(
    engine, monkeypatch, tmp_path
):
    real_dir = tmp_path / "real"
    real_dir.mkdir()
    alias_dir = tmp_path / "alias"
    try:
        alias_dir.symlink_to(real_dir, target_is_directory=True)
    except OSError:
        pytest.skip("platform does not allow test symlinks")

    def fake_api(_path, _data=None, **_kwargs):
        return 200, {"id": "session-1", "directory": str(real_dir)}

    monkeypatch.setattr(engine, "oc_api", fake_api)

    assert engine.oc_create_session(str(alias_dir), "路径别名") == "session-1"
