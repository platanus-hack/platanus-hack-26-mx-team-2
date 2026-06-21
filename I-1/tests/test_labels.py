import pytest
from dataclasses import FrozenInstanceError
from ikarus.labels import Trust, Provenance, Tainted, trusted, untrusted, combine_trust

def test_untrusted_dominates():
    assert combine_trust([Trust.TRUSTED, Trust.TRUSTED]) == Trust.TRUSTED
    assert combine_trust([Trust.TRUSTED, Trust.UNTRUSTED]) == Trust.UNTRUSTED
    assert combine_trust([]) == Trust.TRUSTED

def test_helpers_set_trust():
    assert trusted("bob@corp.com").provenance.trust == Trust.TRUSTED
    assert untrusted("x", "inbox").provenance.trust == Trust.UNTRUSTED

def test_derive_propagates_untrusted():
    a = trusted("hi", "user_request")
    b = untrusted("evil@bad.com", "inbox")
    out = a.derive("evil@bad.com", [a, b])
    assert out.value == "evil@bad.com"
    assert out.provenance.trust == Trust.UNTRUSTED

def test_derive_stays_trusted_when_all_trusted():
    a = trusted("hi")
    out = a.derive("HI", [a])
    assert out.provenance.trust == Trust.TRUSTED

def test_tainted_is_immutable():
    t = trusted("x")
    with pytest.raises(FrozenInstanceError):
        t.value = "y"
