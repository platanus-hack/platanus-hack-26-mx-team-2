def send_email(to: str, body: str) -> str:
    """MOCK sink — never sends. Returns a log line."""
    return f"[MOCK send_email] to={to} body={body!r}"

def share_doc(recipient: str, doc: str) -> str:
    """MOCK sink — never shares. Returns a log line."""
    return f"[MOCK share_doc] recipient={recipient} doc={doc!r}"
