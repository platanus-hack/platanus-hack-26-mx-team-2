from ikarus.app import IkarusApp
from ikarus.composition import CompositionRoot
from ikarus.config import load_settings
from ikarus.tools.email_sink import MockEmailSink
from ikarus.scenarios import default_scenarios


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


def test_run_scenario_accepts_instance_and_returns_structured_result():
    scenario = default_scenarios().create("email")
    out = _build().run_scenario(2, scenario, mock=True)
    assert out["blocked"] is True
    assert out["result"] is not None
    assert any(e.decision is not None and not e.decision.allowed
               for e in out["result"].events)

def test_run_scenario_scene1_allows_and_exposes_result():
    scenario = default_scenarios().create("email")
    out = _build().run_scenario(1, scenario, mock=True)
    assert out["blocked"] is False
    assert out["result"].blocked is False
    assert "send_email" in out["executed_sinks"]

def test_run_scenario_scene3_has_no_result_but_hijacked_flag():
    scenario = default_scenarios().create("email")
    out = _build().run_scenario(3, scenario, mock=True)
    assert out["result"] is None
    assert out["hijacked"] is True
    assert out["naive_recipient"] == "attacker@evil.com"

def test_run_scene_still_delegates():
    out = _build().run_scene(2, "email", mock=True)
    assert out["blocked"] is True
    assert out["result"] is not None
