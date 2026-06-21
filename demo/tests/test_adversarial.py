import pytest
from ikarus.naive_agent import run as naive_run
from tests.attacks import INJECTIONS


@pytest.mark.parametrize("inbox,addr", INJECTIONS)
def test_naive_agent_is_hijacked_by_every_variant(inbox, addr):
    # The baseline (single-LLM, no separation) follows the injected address.
    res = naive_run("Reply to Bob.", inbox, "bob@corp.com", mock=True)
    assert res.hijacked is True
    assert res.recipient == addr
