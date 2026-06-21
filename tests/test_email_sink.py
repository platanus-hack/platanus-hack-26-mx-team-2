import pytest
from ikarus.config import Settings
from ikarus.tools.email_sink import (
    MockEmailSink, ResendEmailSink, SinkBlocked, SinkError, make_email_sink,
)

def _settings(**kw):
    base = dict(base_url="x", model="m", api_key="k")
    base.update(kw)
    return Settings(**base)

def test_make_email_sink_defaults_to_mock():
    assert isinstance(make_email_sink(_settings()), MockEmailSink)

def test_make_email_sink_returns_resend_when_configured():
    s = _settings(sink="resend", resend_api_key="re_x", email_from="a@b.com",
                  allowed_recipients=("me@corp.com",))
    assert isinstance(make_email_sink(s), ResendEmailSink)

def test_mock_sink_never_sends():
    out = MockEmailSink().send("anyone@evil.com", "body")
    assert "MOCK" in out and "anyone@evil.com" in out

def test_resend_blocks_recipient_not_in_allowlist():
    calls = []
    sink = ResendEmailSink("re_x", "from@b.com", ("me@corp.com",),
                           _post=lambda *a, **k: calls.append(a))
    with pytest.raises(SinkBlocked):
        sink.send("attacker@evil.com", "body")
    assert calls == []  # nothing was sent

def test_resend_refuses_empty_allowlist():
    # Safe-by-default: a real sink with no allowlist must not send anywhere.
    sink = ResendEmailSink("re_x", "from@b.com", (), _post=lambda *a, **k: None)
    with pytest.raises(SinkBlocked):
        sink.send("me@corp.com", "body")

def test_resend_sends_to_allowlisted_recipient():
    sent = {}
    def fake_post(url, headers, payload):
        sent["url"], sent["headers"], sent["payload"] = url, headers, payload
        return {"id": "email_123"}
    sink = ResendEmailSink("re_x", "from@b.com", ("me@corp.com",), _post=fake_post)
    out = sink.send("me@corp.com", "hello")
    assert "me@corp.com" in out
    assert sent["payload"]["to"] == ["me@corp.com"]
    assert sent["payload"]["from"] == "from@b.com"
    assert sent["headers"]["Authorization"] == "Bearer re_x"

def test_resend_wraps_transport_error_as_sinkerror():
    def boom(*a, **k): raise RuntimeError("bad api key / network down")
    sink = ResendEmailSink("re_x", "from@b.com", ("me@corp.com",), _post=boom)
    with pytest.raises(SinkError):
        sink.send("me@corp.com", "hello")

def test_sinkblocked_is_a_sinkerror():
    assert issubclass(SinkBlocked, SinkError)
