from ikarus.labels import Tainted, untrusted

def read_inbox(inbox_text: str) -> Tainted:
    """External data is always UNTRUSTED."""
    return untrusted(inbox_text, source="inbox")

def read_pdf(pdf_text: str) -> Tainted:
    return untrusted(pdf_text, source="pdf")
