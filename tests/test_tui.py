from ikarus.tui import render_trace, verdict_line
from ikarus.interpreter import ExecutionResult, TraceEvent
from ikarus.policy import Decision
from ikarus.labels import untrusted

def _blocked_result():
    return ExecutionResult(
        events=[TraceEvent("s3", "sink", "policy on send_email",
                           decision=Decision(False, "BLOCKED: 'to' is UNTRUSTED"),
                           tainted=None)],
        blocked=True, executed_sinks=[])

def test_render_contains_verdict_and_reason():
    text = render_trace(_blocked_result())
    assert "BLOCKED" in text
    assert "UNTRUSTED" in text

def test_verdict_line():
    assert verdict_line(_blocked_result()) == "BLOCKED"
