import pytest
from ikarus.policy import check, Decision, propagate_control_flow_taint
from ikarus.tools.registry import default_registry
from ikarus.labels import trusted, untrusted

def test_trusted_recipient_allowed():
    reg = default_registry()
    d = check("send_email", {"to": trusted("bob@corp.com"), "body": trusted("hi")}, reg)
    assert isinstance(d, Decision)
    assert d.allowed is True

def test_untrusted_recipient_blocked():
    reg = default_registry()
    d = check("send_email", {"to": untrusted("attacker@evil.com", "inbox"),
                             "body": trusted("hi")}, reg)
    assert d.allowed is False
    assert "untrusted" in d.reason.lower()
    assert "to" in d.reason

def test_untrusted_body_does_not_block_send():
    # Only sensitive args (the recipient) gate send_email.
    reg = default_registry()
    d = check("send_email", {"to": trusted("bob@corp.com"),
                             "body": untrusted("leaked", "inbox")}, reg)
    assert d.allowed is True

def test_control_flow_taint_is_stub():
    with pytest.raises(NotImplementedError):
        propagate_control_flow_taint()
