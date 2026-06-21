import pytest
from ikarus.config import Settings
from ikarus.tools.email_sink import (
    EmailSink, MockEmailSink, ResendEmailSink, AllowlistEmailSink,
    SinkBlocked, SinkError, make_email_sink,
)

def _settings(**kw):
    base = dict(base_url="x", model="m", api_key="k")
    base.update(kw)
    return Settings(**base)

class _SpySink:
    def __init__(self): self.calls = []
    def send(self, to, body): self.calls.append((to, body)); return f"[SPY] to={to}"

def test_sinks_satisfy_the_emailsink_protocol():
    assert isinstance(MockEmailSink(), EmailSink)
    assert isinstance(AllowlistEmailSink(MockEmailSink(), ()), EmailSink)

def test_make_email_sink_defaults_to_mock():
    assert isinstance(make_email_sink(_settings()), MockEmailSink)

def test_make_email_sink_wraps_resend_in_allowlist():
    s = _settings(sink="resend", resend_api_key="re_x", email_from="a@b.com",
                  allowed_recipients=("me@corp.com",))
    assert isinstance(make_email_sink(s), AllowlistEmailSink)

def test_make_email_sink_requires_resend_key():
    s = _settings(sink="resend", resend_api_key="", email_from="a@b.com")
    with pytest.raises(ValueError, match="RESEND_API_KEY"):
        make_email_sink(s)

def test_make_email_sink_requires_sender():
    s = _settings(sink="resend", resend_api_key="re_x", email_from="")
    with pytest.raises(ValueError, match="IKARUS_EMAIL_FROM"):
        make_email_sink(s)

def test_mock_sink_never_sends():
    out = MockEmailSink().send("anyone@evil.com", "body")
    assert "MOCK" in out and "anyone@evil.com" in out

def test_allowlist_blocks_recipient_not_in_allowlist():
    spy = _SpySink()
    sink = AllowlistEmailSink(spy, ("me@corp.com",))
    with pytest.raises(SinkBlocked):
        sink.send("attacker@evil.com", "body")
    assert spy.calls == []  # inner sink never invoked

def test_allowlist_refuses_empty_allowlist():
    sink = AllowlistEmailSink(_SpySink(), ())
    with pytest.raises(SinkBlocked):
        sink.send("me@corp.com", "body")

def test_allowlist_is_case_and_space_insensitive():
    spy = _SpySink()
    sink = AllowlistEmailSink(spy, ("me@corp.com",))
    sink.send("  ME@Corp.com ", "hi")
    assert spy.calls and spy.calls[0][0] == "  ME@Corp.com "  # passes through to inner

def test_allowlist_delegates_to_inner_when_allowed():
    spy = _SpySink()
    out = AllowlistEmailSink(spy, ("me@corp.com",)).send("me@corp.com", "hi")
    assert "SPY" in out and spy.calls == [("me@corp.com", "hi")]

def test_resend_transport_posts_expected_payload():
    sent = {}
    def fake_post(url, headers, payload):
        sent["url"], sent["headers"], sent["payload"] = url, headers, payload
        return {"id": "email_123"}
    out = ResendEmailSink("re_x", "from@b.com", _post=fake_post).send("me@corp.com", "hello")
    assert "me@corp.com" in out
    assert sent["payload"]["to"] == ["me@corp.com"]
    assert sent["payload"]["from"] == "from@b.com"
    assert sent["headers"]["Authorization"] == "Bearer re_x"

def test_resend_wraps_transport_error_as_sinkerror():
    def boom(*a, **k): raise RuntimeError("bad api key / network down")
    with pytest.raises(SinkError):
        ResendEmailSink("re_x", "from@b.com", _post=boom).send("me@corp.com", "hello")

def test_sinkblocked_is_a_sinkerror():
    assert issubclass(SinkBlocked, SinkError)
