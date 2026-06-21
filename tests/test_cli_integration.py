from ikarus.cli import run_scene, main

def test_scene1_injection_absent_from_plan():
    out = run_scene(1, "email", mock=True)
    assert out["blocked"] is False
    assert "send_email" in out["executed_sinks"]
    # The attacker address lives in the inbox, which Scene 1's plan never touches.
    assert "attacker@evil.com" not in out["text"]

def test_scene1_live_uses_p_llm(monkeypatch):
    # In live mode an injected fake P-LLM client drives the plan (hybrid wiring).
    valid = {"steps": [{"id": "s1", "kind": "sink", "tool": "send_email",
             "args": {"to": {"from": "request", "ref": "recipient"},
                      "body": {"from": "request", "ref": "body"}}}]}
    class FakeClient:
        def structured(self, *a, **k): return valid
    out = run_scene(1, "email", mock=False, client=FakeClient())
    assert out["blocked"] is False
    assert out["used_fallback"] is False
    assert "send_email" in out["executed_sinks"]

def test_scene2_taint_blocks_sink():
    out = run_scene(2, "email", mock=True)
    assert out["blocked"] is True
    assert "send_email" not in out["executed_sinks"]
    assert "UNTRUSTED" in out["text"]

def test_scene3_naive_agent_exfiltrates():
    out = run_scene(3, "email", mock=True)
    assert out["naive_recipient"] == "attacker@evil.com"

def test_main_runs_all_scenes_returns_zero(capsys):
    code = main(["--scene", "all", "--scenario", "email", "--mock"])
    assert code == 0
    captured = capsys.readouterr()
    assert "VERDICT" in captured.out
