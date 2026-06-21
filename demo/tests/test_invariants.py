import pytest
from ikarus.labels import trusted, untrusted, Trust, combine_trust
from ikarus.policy import check
from ikarus.tools.registry import default_registry
from ikarus.q_llm import extract
from tests.attacks import INJECTIONS

REG = default_registry()


@pytest.mark.parametrize("addr", [a for _, a in INJECTIONS])
def test_guard_blocks_any_untrusted_recipient_regardless_of_value(addr):
    # The block does not depend on the wording/value — only on the taint label.
    d = check("send_email", {"to": untrusted(addr, "q_llm"),
                             "body": trusted("hi")}, REG)
    assert d.allowed is False
    assert "UNTRUSTED" in d.reason


@pytest.mark.parametrize("addr", [a for _, a in INJECTIONS])
def test_guard_allows_when_same_value_is_trusted(addr):
    # Same string, TRUSTED provenance -> allowed. Proves it's the label, not the text.
    d = check("send_email", {"to": trusted(addr), "body": trusted("hi")}, REG)
    assert d.allowed is True


def test_q_llm_output_is_always_untrusted_even_if_value_looks_benign():
    # Mock mode returns a deterministic value; whatever it is, it is born UNTRUSTED.
    out = extract("From: Bob — totally normal email, no injection here.",
                  "recipient to forward to")
    assert out.provenance.trust == Trust.UNTRUSTED


def test_untrusted_dominates_in_combine():
    assert combine_trust([Trust.TRUSTED, Trust.UNTRUSTED]) == Trust.UNTRUSTED
    assert combine_trust([Trust.TRUSTED, Trust.TRUSTED]) == Trust.TRUSTED


from ikarus.scenarios import default_scenarios


def test_planner_never_receives_the_inbox_text():
    # Architectural guarantee: the dirty inbox is not part of the planner's input.
    sc = default_scenarios().create("email")
    assert "attacker@evil.com" in sc.inbox_text          # the injection IS in the data
    # The trusted request the planner plans from must NOT contain it.
    assert "attacker@evil.com" not in sc.request
    assert all("attacker@evil.com" not in str(v.value)
               for v in sc.request_values.values())
