import urllib.error

import pytest
from fastapi.testclient import TestClient

from fakes.fake_upstream import ScriptedResponse


def _runtime_key():
    return "s" + "k-" + ("T" * 32)


def _chat_delta(text):
    return (
        'data: {"choices":[{"delta":{"content":%r}}]}\n\n' % text
    ).replace("'", '"').encode("utf-8")


def test_relay_records_when_execution_shell_drops_local_authorization(engine):
    with TestClient(engine.app) as client:
        result = client.post(
            "/v1/relay/chat/completions",
            json={"model": "senseaudio-s2", "messages": []},
        )

    assert result.status_code == 401
    assert engine.RELAY_LAST["mode"] == "auth"
    assert "未携带本机中继凭据" in engine.RELAY_LAST["error"]


def test_streaming_relay_flushes_each_available_upstream_chunk_without_waiting_for_8kb(engine):
    """A slow model may emit tiny SSE frames; the relay must forward them immediately."""
    frames = [b"data: first\n\n", b"data: second\n\n", b""]

    class SlowStreamingResponse:
        def __init__(self):
            self.read_calls = []

        def read1(self, size):
            self.read_calls.append(("read1", size))
            return frames.pop(0)

        def read(self, size=-1):
            self.read_calls.append(("read", size))
            raise AssertionError("streaming relay buffered with read() instead of flushing read1()")

    response = SlowStreamingResponse()
    chunks = list(engine._iter_upstream_chunks(response, streaming=True))

    assert chunks == [b"data: first\n\n", b"data: second\n\n"]
    assert response.read_calls == [("read1", 8192), ("read1", 8192), ("read1", 8192)]


@pytest.mark.parametrize("model", ["senseaudio-s2", "deepseek-v4-flash"])
def test_responses_bridge_never_turns_partial_text_disconnect_into_success(engine, monkeypatch, model):
    response = ScriptedResponse(
        chunks=[_chat_delta("已经收到的半段正文")],
        error=ConnectionResetError("synthetic mid-stream reset"),
    )
    monkeypatch.setattr(engine, "_upstream", lambda *_args, **_kwargs: response)
    upstream = {
        "base_url": "http://127.0.0.1:9/v1",
        "api_key": _runtime_key(),
        "model": model,
        "verify_ssl": False,
    }

    wire = b"".join(engine._relay_stream({"input": "write"}, upstream)).decode("utf-8")

    assert "response.failed" in wire
    assert "response.completed" not in wire
    assert engine.RELAY_LAST.get("error")


def test_partial_tool_arguments_are_failed_and_never_completed(engine, monkeypatch):
    chunk = (
        b'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1",'
        b'"function":{"name":"write","arguments":"{\\\"path\\\":"}}]}}]}\n\n'
    )
    monkeypatch.setattr(
        engine,
        "_upstream",
        lambda *_args, **_kwargs: ScriptedResponse(
            chunks=[chunk], error=ConnectionResetError("synthetic tool reset")
        ),
    )
    upstream = {
        "base_url": "http://127.0.0.1:9/v1",
        "api_key": _runtime_key(),
        "model": "deepseek-v4-flash",
        "verify_ssl": False,
    }

    wire = b"".join(engine._relay_stream({"input": "write"}, upstream)).decode("utf-8")

    assert "response.failed" in wire
    assert "response.completed" not in wire
    assert "response.output_item.done" not in wire


@pytest.mark.parametrize("model", ["senseaudio-s2", "deepseek-v4-flash"])
def test_chat_passthrough_reports_midstream_disconnect_instead_of_silent_eof(
    engine, monkeypatch, model
):
    chunk = b'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'
    monkeypatch.setattr(
        engine,
        "_upstream",
        lambda *_args, **_kwargs: ScriptedResponse(
            chunks=[chunk], error=ConnectionResetError("synthetic chat reset")
        ),
    )
    monkeypatch.setattr(
        engine,
        "s2_conf",
        lambda *_args, **_kwargs: {
            "base_url": "http://127.0.0.1:9/v1",
            "api_key": _runtime_key(),
            "model": model,
            "verify_ssl": False,
            "wire": "auto",
        },
    )
    token = engine.relay_token()

    with TestClient(engine.app) as client:
        result = client.post(
            "/v1/relay/chat/completions",
            headers={"Authorization": "Bearer " + token},
            json={"model": model, "stream": True, "messages": [{"role": "user", "content": "go"}]},
        )

    assert result.status_code == 200
    assert "error" in result.text.lower()
    assert engine.RELAY_LAST.get("error")


def test_connection_open_is_retried_before_any_stream_byte(engine, monkeypatch):
    attempts = []
    final = ScriptedResponse(chunks=[b"data: [DONE]\n\n"])

    def urlopen(*_args, **_kwargs):
        attempts.append(1)
        if len(attempts) < 3:
            raise urllib.error.URLError(ConnectionResetError("synthetic handshake reset"))
        return final

    monkeypatch.setattr(engine.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(engine, "RETRY_WAITS", (0, 0, 0))

    opened = engine._upstream(
        "http://127.0.0.1:9/v1",
        _runtime_key(),
        "/chat/completions",
        {"model": "deepseek-v4-flash", "stream": True},
        1,
        False,
    )

    assert opened is final
    assert len(attempts) == 3


@pytest.mark.parametrize("model", ["senseaudio-s2", "deepseek-v4-flash"])
def test_responses_passthrough_marks_partial_eof_as_failed(engine, monkeypatch, model):
    chunk = (
        b'event: response.output_text.delta\n'
        b'data: {"type":"response.output_text.delta","delta":"partial"}\n\n'
    )
    monkeypatch.setattr(
        engine,
        "_upstream",
        lambda *_args, **_kwargs: ScriptedResponse(chunks=[chunk]),
    )
    upstream = {
        "base_url": "http://127.0.0.1:9/v1",
        "api_key": _runtime_key(),
        "model": model,
        "verify_ssl": False,
    }

    wire = b"".join(
        engine._relay_passthrough({"model": model, "stream": True}, upstream)
    ).decode("utf-8")

    assert "response.failed" in wire
    assert "response.completed" not in wire
    assert engine.RELAY_LAST.get("error")


def test_responses_passthrough_preserves_a_real_terminal_event(engine, monkeypatch):
    terminal = (
        b'event: response.completed\n'
        b'data: {"type":"response.completed","response":{"status":"completed"}}\n\n'
    )
    monkeypatch.setattr(
        engine,
        "_upstream",
        lambda *_args, **_kwargs: ScriptedResponse(chunks=[terminal]),
    )
    upstream = {
        "base_url": "http://127.0.0.1:9/v1",
        "api_key": _runtime_key(),
        "model": "senseaudio-s2",
        "verify_ssl": False,
    }

    wire = b"".join(
        engine._relay_passthrough({"model": "senseaudio-s2", "stream": True}, upstream)
    ).decode("utf-8")

    assert wire.count("response.completed") >= 1
    assert "response.failed" not in wire


@pytest.mark.parametrize("request_body", [{"model": "senseaudio-s2"}, {"model": "senseaudio-s2", "stream": False}])
def test_responses_passthrough_nonstream_is_json_not_sse(engine, monkeypatch, request_body):
    payload = b'{"id":"resp_ok","object":"response","status":"completed","output":[]}'
    monkeypatch.setattr(
        engine,
        "_upstream",
        lambda *_args, **_kwargs: ScriptedResponse(chunks=[payload], content_type="application/json"),
    )
    monkeypatch.setattr(
        engine,
        "s2_conf",
        lambda *_args, **_kwargs: {
            "base_url": "http://127.0.0.1:9/v1",
            "api_key": _runtime_key(),
            "model": "senseaudio-s2",
            "verify_ssl": False,
            "wire": "responses",
        },
    )
    token = engine.relay_token()

    with TestClient(engine.app) as client:
        result = client.post(
            "/v1/relay/responses",
            headers={"Authorization": "Bearer " + token},
            json=request_body,
        )

    assert result.status_code == 200
    assert result.headers["content-type"].startswith("application/json")
    assert result.json()["status"] == "completed"
    assert "response.failed" not in result.text


def test_responses_passthrough_nonstream_network_error_is_json_502(engine, monkeypatch):
    monkeypatch.setattr(
        engine,
        "_upstream",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(ConnectionResetError("synthetic reset")),
    )
    monkeypatch.setattr(
        engine,
        "s2_conf",
        lambda *_args, **_kwargs: {
            "base_url": "http://127.0.0.1:9/v1",
            "api_key": _runtime_key(),
            "model": "senseaudio-s2",
            "verify_ssl": False,
            "wire": "responses",
        },
    )
    token = engine.relay_token()

    with TestClient(engine.app) as client:
        result = client.post(
            "/v1/relay/responses",
            headers={"Authorization": "Bearer " + token},
            json={"model": "senseaudio-s2"},
        )

    assert result.status_code == 502
    assert result.headers["content-type"].startswith("application/json")
