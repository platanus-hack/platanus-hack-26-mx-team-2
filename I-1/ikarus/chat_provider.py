"""Swappable chat LLM providers (production-ready).

A `ChatProvider` turns a (system, messages) pair into an assistant reply. The
provider is selected by config so the WHOLE demo can switch between LM Studio,
OpenAI, and Claude (Anthropic) without code changes — `make_chat_provider` is
the single composition point (mirrors the `make_email_sink` pattern).

Transport is stdlib `urllib` only (no SDK dependency); each provider speaks its
own wire format:
  - OpenAICompatProvider -> OpenAI `/chat/completions`   (LM Studio + OpenAI)
  - AnthropicProvider    -> Anthropic `POST /v1/messages` (Claude)
  - MockChatProvider     -> deterministic, offline (default — needs no network)

Secrets come only from env via `Settings` (kept out of repr). The interactive
chat is the deliberately-naive agent: with a real provider it can be hijacked by
an injection, which is exactly what the demo lets you probe.
"""
import json
from typing import Any, Callable, Optional, Protocol, runtime_checkable

from ikarus.config import (
    DEFAULT_CLAUDE_MODEL,
    DEFAULT_OPENAI_MODEL,
    Settings,
)

ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
OPENAI_ENDPOINT = "https://api.openai.com/v1"
DEFAULT_CHAT_MAX_TOKENS = 1024


class ChatError(Exception):
    """A chat completion could not be produced (transport or API failure)."""


@runtime_checkable
class ChatProvider(Protocol):
    """Anything that can turn (system, messages) into an assistant reply."""

    def complete(self, system: str, messages: list[dict]) -> str: ...


def _http_post_json(url: str, headers: dict, payload: dict, timeout: int = 60) -> dict:
    """POST JSON and return the decoded JSON body (stdlib only).

    Surfaces the API error body (not just the status) so failures are legible,
    and never lets a transport error escape as a raw exception.
    """
    import urllib.error  # stdlib only; no extra dependency
    import urllib.request

    data = json.dumps(payload).encode("utf-8")
    hdrs = {"User-Agent": "ikarus/0.1", "Content-Type": "application/json", **headers}
    req = urllib.request.Request(url, data=data, headers=hdrs, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (trusted URL)
            return json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:300]
        raise ChatError(f"HTTP {exc.code}: {detail}") from exc
    except Exception as exc:  # network failure — don't crash the caller
        raise ChatError(f"chat request failed: {exc}") from exc


class MockChatProvider:
    """Deterministic, offline default — no network, no model.

    Mimics a NAIVE assistant: it reads everything it is given and, if the input
    hides an instruction to exfiltrate to an address, it visibly complies — the
    point the demo makes. Otherwise it answers plainly. Keeps the chat usable
    with zero configuration and zero network.
    """

    def complete(self, system: str, messages: list[dict]) -> str:
        from ikarus.naive_agent import extract_injected_address

        last = messages[-1].get("content", "") if messages else ""
        haystack = "\n".join(str(m.get("content", "")) for m in messages)
        haystack = f"{haystack}\n{system or ''}"
        addr = extract_injected_address(haystack)
        if addr:
            return f"[mock] Claro, reenvío los datos a {addr} como se indica."
        return f"[mock] Dijiste: {last!r}. (mock determinista — sin modelo)"


class OpenAICompatProvider:
    """OpenAI-compatible `/chat/completions` transport (LM Studio + OpenAI)."""

    def __init__(self, base_url: str, api_key: str, model: str,
                 max_tokens: int = DEFAULT_CHAT_MAX_TOKENS,
                 _post: Optional[Callable[..., Any]] = None) -> None:
        self._url = base_url.rstrip("/") + "/chat/completions"
        self._api_key = api_key
        self._model = model
        self._max_tokens = max_tokens
        self._post = _post or _http_post_json

    def complete(self, system: str, messages: list[dict]) -> str:
        msgs = ([{"role": "system", "content": system}] if system else []) + list(messages)
        body = self._post(
            self._url,
            {"Authorization": f"Bearer {self._api_key}"},
            {"model": self._model, "messages": msgs,
             "max_tokens": self._max_tokens, "temperature": 0},
        )
        try:
            return body["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError) as exc:
            raise ChatError(f"unexpected OpenAI-compatible response: {body!r}") from exc


class AnthropicProvider:
    """Anthropic Messages API transport (Claude)."""

    def __init__(self, api_key: str, model: str,
                 max_tokens: int = DEFAULT_CHAT_MAX_TOKENS,
                 _post: Optional[Callable[..., Any]] = None) -> None:
        self._api_key = api_key
        self._model = model
        self._max_tokens = max_tokens
        self._post = _post or _http_post_json

    def complete(self, system: str, messages: list[dict]) -> str:
        body = self._post(
            ANTHROPIC_ENDPOINT,
            {"x-api-key": self._api_key, "anthropic-version": ANTHROPIC_VERSION},
            {"model": self._model, "max_tokens": self._max_tokens,
             "system": system or "", "messages": list(messages)},
        )
        try:
            blocks = body["content"]
            return "".join(b.get("text", "") for b in blocks if b.get("type") == "text")
        except (KeyError, TypeError) as exc:
            raise ChatError(f"unexpected Anthropic response: {body!r}") from exc


def _chat_model(settings: Settings, fallback: str) -> str:
    return settings.chat_model or fallback


def make_chat_provider(settings: Settings) -> ChatProvider:
    """Build the chat provider from settings (mock by default).

    Real providers fail fast (not at first message) when their key is missing,
    so a misconfiguration is caught at startup with a clear message.
    """
    provider = settings.llm_provider
    if provider == "mock":
        return MockChatProvider()
    if provider == "lmstudio":
        # LM Studio ignores the key and serves an OpenAI-compatible endpoint.
        return OpenAICompatProvider(settings.base_url, settings.api_key,
                                    _chat_model(settings, settings.model))
    if provider == "openai":
        if not settings.openai_api_key:
            raise ValueError("IKARUS_LLM_PROVIDER=openai requires IKARUS_OPENAI_API_KEY")
        return OpenAICompatProvider(OPENAI_ENDPOINT, settings.openai_api_key,
                                    _chat_model(settings, DEFAULT_OPENAI_MODEL))
    if provider == "claude":
        if not settings.anthropic_api_key:
            raise ValueError("IKARUS_LLM_PROVIDER=claude requires ANTHROPIC_API_KEY")
        return AnthropicProvider(settings.anthropic_api_key,
                                 _chat_model(settings, DEFAULT_CLAUDE_MODEL))
    raise ValueError(
        f"unknown IKARUS_LLM_PROVIDER={provider!r} (mock|lmstudio|openai|claude)")
