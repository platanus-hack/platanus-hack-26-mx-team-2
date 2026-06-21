import pytest
from ikarus.policy import (
    check, Decision, SecurityPolicy, DenyUntrustedArgsPolicy,
    propagate_control_flow_taint,
)
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

def test_untrusted_body_blocks_send():
    # Deny-by-default: ANY untrusted arg blocks the sink — content (body) is
    # protected too, not just the recipient. (Closes the content-exfil gap.)
    reg = default_registry()
    d = check("send_email", {"to": trusted("bob@corp.com"),
                             "body": untrusted("leaked", "inbox")}, reg)
    assert d.allowed is False
    assert "body" in d.reason

def test_deny_policy_is_a_security_policy():
    policy = DenyUntrustedArgsPolicy()
    assert isinstance(policy, SecurityPolicy)  # structural (Protocol) conformance
    reg = default_registry()
    assert policy.evaluate(
        "send_email", {"to": trusted("bob@corp.com"), "body": trusted("hi")}, reg).allowed
    assert not policy.evaluate(
        "share_doc", {"recipient": trusted("team@corp.com"),
                      "doc": untrusted("secret", "inbox")}, reg).allowed

def test_control_flow_taint_is_stub():
    with pytest.raises(NotImplementedError):
        propagate_control_flow_taint()
