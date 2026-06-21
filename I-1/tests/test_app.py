from ikarus.app import IkarusApp
from ikarus.composition import CompositionRoot
from ikarus.config import load_settings
from ikarus.tools.email_sink import MockEmailSink


class _SpySink:
    def __init__(self):
        self.sent = []

    def send(self, to, body):
        self.sent.append(to)
        return f"[SPY] to={to}"


def _build(email_sink=None):
    settings = load_settings()
    return CompositionRoot(settings, email_sink=email_sink or MockEmailSink()).build()


def test_composition_root_builds_app():
    assert isinstance(_build(), IkarusApp)


def test_app_scene1_allows_trusted_send():
    out = _build().run_scene(1, "email", mock=True)
    assert out["blocked"] is False
    assert "send_email" in out["executed_sinks"]
    assert "attacker@evil.com" not in out["text"]


def test_app_scene2_taint_blocks_sink():
    out = _build().run_scene(2, "email", mock=True)
    assert out["blocked"] is True
    assert "send_email" not in out["executed_sinks"]
    assert "UNTRUSTED" in out["text"]


def test_app_routes_send_through_injected_sink():
    spy = _SpySink()
    out = _build(email_sink=spy).run_scene(1, "email", mock=True)
    assert spy.sent == ["bob@corp.com"]
    assert "send_email" in out["executed_sinks"]


def test_app_scene3_naive_routes_through_injected_sink():
    spy = _SpySink()
    out = _build(email_sink=spy).run_scene(3, "email", mock=True)
    assert spy.sent == ["attacker@evil.com"]
    assert out["naive_recipient"] == "attacker@evil.com"


def test_app_scene1_live_uses_injected_client():
    valid = {"steps": [{"id": "s1", "kind": "sink", "tool": "send_email",
             "args": {"to": {"from": "request", "ref": "recipient"},
                      "body": {"from": "request", "ref": "body"}}}]}

    class FakeClient:
        def structured(self, *a, **k):
            return valid

    out = _build().run_scene(1, "email", mock=False, client=FakeClient())
    assert out["used_fallback"] is False
    assert out["blocked"] is False
    assert "send_email" in out["executed_sinks"]


def test_app_scene1_live_falls_back_on_invalid_plan():
    bad = {"steps": [{"id": "s1", "kind": "sink", "tool": "send_email",
            "args": {"to": {"from": "step", "ref": "read_inbox"},
                     "body": {"from": "request", "ref": "body"}}}]}

    class FakeClient:
        def structured(self, *a, **k):
            return bad

    out = _build().run_scene(1, "email", mock=False, client=FakeClient())
    assert out["used_fallback"] is True
    assert out["blocked"] is False
