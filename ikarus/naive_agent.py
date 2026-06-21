import re
from dataclasses import dataclass
from ikarus.tools.sinks import send_email
from ikarus.llm_client import LLMClient, LLMError

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
        client: LLMClient | None = None, mock: bool = True) -> NaiveResult:
    """Single LLM over request+inbox together: no separation, so it gets hijacked.

    In mock mode we deterministically reproduce the documented hijack.
    """
    injected = extract_injected_address(inbox_text)
    recipient = injected if injected else trusted_recipient
    log = send_email(recipient, body=f"(naive agent acting on: {request})")
    return NaiveResult(recipient=recipient, sink_log=log,
                       hijacked=recipient != trusted_recipient)
