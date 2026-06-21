from ikarus.tools.sources import Source, InboxSource, PdfSource, default_sources
from ikarus.labels import Trust

def test_sources_satisfy_protocol():
    assert isinstance(InboxSource(), Source)
    assert isinstance(PdfSource(), Source)

def test_inbox_source_reads_untrusted():
    t = InboxSource().read("hello")
    assert t.value == "hello"
    assert t.provenance.trust == Trust.UNTRUSTED
    assert t.provenance.source == "inbox"

def test_pdf_source_labels_provenance():
    assert PdfSource().read("doc").provenance.source == "pdf"

def test_default_sources_keyed_by_tool_name():
    srcs = default_sources()
    assert set(srcs) == {"read_inbox", "read_pdf"}
    assert srcs["read_pdf"].read("x").provenance.source == "pdf"
