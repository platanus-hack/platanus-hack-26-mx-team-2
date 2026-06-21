from ikarus.web.views import ledger_rows, scene_view, SCENE_TITLES
from ikarus.interpreter import ExecutionResult, TraceEvent
from ikarus.policy import Decision
from ikarus.labels import trusted, untrusted


def _blocked_result():
    return ExecutionResult(
        events=(
            TraceEvent("s1", "source", "read read_inbox",
                       tainted=untrusted("dirty", "inbox")),
            TraceEvent("s3", "sink", "policy on send_email",
                       decision=Decision(False, "BLOCKED: 'to' is UNTRUSTED")),
        ),
        blocked=True, executed_sinks=())


def test_ledger_rows_marks_untrusted_and_block():
    rows = ledger_rows(_blocked_result())
    assert rows[0]["trust"] == "UNTRUSTED"
    assert rows[0]["trust_class"] == "untrusted"
    assert rows[1]["policy_class"] == "block"
    assert "BLOCKED" in rows[1]["policy"]


def test_ledger_rows_marks_trusted_and_pass():
    res = ExecutionResult(
        events=(TraceEvent("s1", "source", "read", tainted=trusted("ok")),
                TraceEvent("s2", "sink", "policy", decision=Decision(True, "ok"))),
        blocked=False, executed_sinks=("send_email",))
    rows = ledger_rows(res)
    assert rows[0]["trust_class"] == "trusted"
    assert rows[1]["policy"] == "PASS"
    assert rows[1]["policy_class"] == "pass"


def test_scene_view_for_ledger_scene():
    out = {"text": "", "blocked": True, "executed_sinks": (), "used_fallback": False,
           "naive_recipient": None, "result": _blocked_result(), "hijacked": False}
    view = scene_view(out, 2)
    assert view["title"] == SCENE_TITLES[2]
    assert view["is_naive"] is False
    assert view["verdict"] == "BLOCKED"
    assert view["blocked"] is True
    assert len(view["rows"]) == 2


def test_scene_view_for_naive_scene():
    out = {"text": "NAIVE...", "blocked": False, "executed_sinks": [],
           "used_fallback": False, "naive_recipient": "mallory@evil.test",
           "result": None, "hijacked": True}
    view = scene_view(out, 3)
    assert view["is_naive"] is True
    assert view["naive_recipient"] == "mallory@evil.test"
    assert view["hijacked"] is True
    assert view["rows"] == []
