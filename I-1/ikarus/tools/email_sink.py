"""Email sinks (SOLID).

`EmailSink` is the abstraction every caller depends on. `MockEmailSink` never
sends; `ResendEmailSink` is a thin Resend transport. `AllowlistEmailSink` is a
DECORATOR that gates ANY sink by a recipient allowlist (single responsibility),
so even the deliberately-vulnerable naive agent can never reach an address the
operator did not pre-approve. `make_email_sink` is the factory/composition point.
"""
import json
from typing import Any, Callable, Optional, Protocol, runtime_checkable
from ikarus.config import Settings

RESEND_ENDPOINT = "https://api.resend.com/emails"
_SUBJECT = "Ikarus demo"


class SinkError(Exception):
    """A real send could not complete (refused by allowlist, or transport failure)."""


class SinkBlocked(SinkError):
    """Raised when a real send is refused (empty allowlist or recipient off it)."""


@runtime_checkable
class EmailSink(Protocol):
    """Anything that can send (or pretend to send) an email."""

    def send(self, to: str, body: str) -> str: ...


def _normalize(addr: str) -> str:
    return addr.strip().lower()


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
    """Thin Resend transport. No allowlist here — that is the decorator's job."""

    def __init__(self, api_key: str, sender: str,
                 _post: Optional[Callable[..., Any]] = None) -> None:
        self._api_key = api_key
        self._sender = sender
        self._post = _post or _http_post

    def send(self, to: str, body: str) -> str:
        try:
            self._post(
                RESEND_ENDPOINT,
                {"Authorization": f"Bearer {self._api_key}",
                 "Content-Type": "application/json"},
                {"from": self._sender, "to": [to], "subject": _SUBJECT, "text": body},
            )
        except Exception as exc:  # network / API failure — don't crash the demo
            raise SinkError(f"send failed: {exc}") from exc
        return f"[RESEND send_email] to={to} body={body!r}"


class AllowlistEmailSink:
    """Decorator: only lets `inner` send to an allowlisted (normalized) recipient."""

    def __init__(self, inner: EmailSink, allowed: tuple[str, ...]) -> None:
        self._inner = inner
        self._allowed = frozenset(_normalize(a) for a in allowed)

    def send(self, to: str, body: str) -> str:
        if not self._allowed:
            raise SinkBlocked("refusing to send: no IKARUS_ALLOWED_RECIPIENTS set")
        if _normalize(to) not in self._allowed:
            raise SinkBlocked(f"refusing to send: {to!r} is not in the allowlist")
        return self._inner.send(to, body)


def make_email_sink(settings: Settings) -> EmailSink:
    """Build the sink from settings (mock by default).

    For `resend`, require a key + sender (fail fast, not at first send) and wrap
    the transport in the allowlist decorator.
    """
    if settings.sink != "resend":
        return MockEmailSink()
    if not settings.resend_api_key:
        raise ValueError("IKARUS_SINK=resend requires RESEND_API_KEY to be set")
    if not settings.email_from:
        raise ValueError("IKARUS_SINK=resend requires IKARUS_EMAIL_FROM to be set")
    transport = ResendEmailSink(settings.resend_api_key, settings.email_from)
    return AllowlistEmailSink(transport, settings.allowed_recipients)


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
