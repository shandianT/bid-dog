import pytest


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
        if path == "/api/session":
            return 200, {"id": "probe-session"}
        if path.endswith("/prompt"):
            return 500, {"error": "synthetic prompt failure"}
        if path.endswith("/message"):
            return 200, []
        raise AssertionError(path)

    monkeypatch.setattr(engine, "oc_api", fake_api)

    ok, reason = engine.oc_probe()

    assert ok is False
    assert "HTTP 500" in reason
