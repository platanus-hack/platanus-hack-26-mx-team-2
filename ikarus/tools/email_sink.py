"""Email sink providers.

The mock provider never sends. The Resend provider sends a real email but ONLY
to addresses on an explicit allowlist — a hard backstop so that, even though
this is a prompt-injection demo where the naive agent can be hijacked, a real
send can never reach an address the operator did not pre-approve.
"""
import json
from typing import Any, Callable, Optional
from ikarus.config import Settings

RESEND_ENDPOINT = "https://api.resend.com/emails"
_SUBJECT = "Ikarus demo"


class SinkBlocked(Exception):
    """Raised when a real send is refused (empty allowlist or recipient off it)."""


class MockEmailSink:
    """Default sink: never sends; returns a log line."""

    def send(self, to: str, body: str) -> str:
        return f"[MOCK send_email] to={to} body={body!r}"


def _http_post(url: str, headers: dict, payload: dict) -> dict:
    import urllib.request  # stdlib only; no extra dependency

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310 (trusted URL)
        return json.loads(resp.read().decode("utf-8") or "{}")


class ResendEmailSink:
    """Sends via Resend, gated by an allowlist."""

    def __init__(self, api_key: str, sender: str, allowed_recipients: tuple[str, ...],
                 _post: Optional[Callable[..., Any]] = None) -> None:
        self._api_key = api_key
        self._sender = sender
        self._allowed = tuple(allowed_recipients)
        self._post = _post or _http_post

    def send(self, to: str, body: str) -> str:
        if not self._allowed:
            raise SinkBlocked("refusing to send: no IKARUS_ALLOWED_RECIPIENTS set")
        if to not in self._allowed:
            raise SinkBlocked(f"refusing to send: {to!r} is not in the allowlist")
        self._post(
            RESEND_ENDPOINT,
            {"Authorization": f"Bearer {self._api_key}",
             "Content-Type": "application/json"},
            {"from": self._sender, "to": [to], "subject": _SUBJECT, "text": body},
        )
        return f"[RESEND send_email] to={to} body={body!r}"


def make_email_sink(settings: Settings):
    """Pick the sink provider from settings (mock by default)."""
    if settings.sink == "resend":
        return ResendEmailSink(settings.resend_api_key, settings.email_from,
                               settings.allowed_recipients)
    return MockEmailSink()


def _main(argv: Optional[list] = None) -> int:
    """Smoke test: python3 -m ikarus.tools.email_sink --to you@x.com --body hi"""
    import argparse
    from ikarus.config import load_settings

    parser = argparse.ArgumentParser(prog="ikarus.tools.email_sink")
    parser.add_argument("--to", required=True)
    parser.add_argument("--body", default="Ikarus real-sink smoke test.")
    args = parser.parse_args(argv)
    sink = make_email_sink(load_settings())
    try:
        print(sink.send(args.to, args.body))
    except SinkBlocked as exc:
        print(f"BLOCKED: {exc}")
        return 1
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(_main(sys.argv[1:]))
