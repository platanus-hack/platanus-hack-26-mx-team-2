from ikarus.tools.registry import ToolKind, default_registry
from ikarus.tools.sources import InboxSource, PdfSource
from ikarus.tools.sinks import send_email, share_doc
from ikarus.labels import Trust

def test_registry_classifies_sinks_and_sources():
    reg = default_registry()
    assert reg.is_sink("send_email") is True
    assert reg.is_sink("read_inbox") is False
    assert reg.get("send_email").sensitive_args == ("to",)
    assert reg.get("read_inbox").kind == ToolKind.SOURCE

def test_sources_are_untrusted():
    t = InboxSource().read("hello")
    assert t.value == "hello"
    assert t.provenance.trust == Trust.UNTRUSTED
    assert PdfSource().read("x").provenance.source == "pdf"

def test_sinks_are_mocked_and_return_log():
    out = send_email("bob@corp.com", "body")
    assert "bob@corp.com" in out
    assert "share" in share_doc("team@corp.com", "doc").lower()
