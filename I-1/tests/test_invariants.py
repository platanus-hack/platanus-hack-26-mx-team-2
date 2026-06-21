import pytest
from ikarus.labels import trusted, untrusted
from ikarus.policy import check
from ikarus.tools.registry import default_registry
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
