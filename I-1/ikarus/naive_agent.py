import re
from dataclasses import dataclass
from typing import Callable, Optional
from ikarus.tools.sinks import send_email
from ikarus.tools.email_sink import SinkError
from ikarus.llm_client import LLMClient

_ADDR = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")

@dataclass(frozen=True)
class NaiveResult:
    recipient: str
    sink_log: str
    hijacked: bool

def extract_injected_address(inbox_text: str) -> str | None:
    """Mock heuristic: an injected 'forward to X' address in the inbox."""
    lowered = inbox_text.lower()
    if "forward" not in lowered and "send to" not in lowered:
        return None
    m = _ADDR.search(inbox_text)
    return m.group(0) if m else None

def run(request: str, inbox_text: str, trusted_recipient: str,
        client: LLMClient | None = None, mock: bool = True,
        email_send: Optional[Callable[..., str]] = None) -> NaiveResult:
    """Single LLM over request+inbox together: no separation, so it gets hijacked.

    In mock mode we deterministically reproduce the documented hijack. The actual
    send goes through `email_send` (default: mock sink); with the real sink the
    hijacked send really goes out — to an allowlisted address only.
    """
    send = email_send or send_email
    injected = extract_injected_address(inbox_text)
    recipient = injected if injected else trusted_recipient
    try:
        log = send(recipient, body=f"(naive agent acting on: {request})")
    except SinkError as exc:
        log = f"BLOCKED: {exc}"
    return NaiveResult(recipient=recipient, sink_log=log,
                       hijacked=recipient != trusted_recipient)
