from ikarus.tui import render_trace, verdict_line
from ikarus.interpreter import ExecutionResult, TraceEvent
from ikarus.policy import Decision
from ikarus.labels import untrusted, trusted

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

def _allowed_result():
    return ExecutionResult(
        events=[
            TraceEvent("s1", "source", "read read_inbox", tainted=trusted("Q3 figures")),
            TraceEvent("s2", "sink", "policy on send_email",
                       decision=Decision(True, "allowed: send_email sensitive args are TRUSTED")),
        ],
        blocked=False, executed_sinks=["send_email"])

def test_render_allowed_shows_trusted_and_allowed_verdict():
    text = render_trace(_allowed_result())
    assert "ALLOWED" in text
    assert "TRUSTED" in text

def test_verdict_line_allowed():
    assert verdict_line(_allowed_result()) == "ALLOWED"
