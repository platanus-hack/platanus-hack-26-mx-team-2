import os
from dataclasses import dataclass, field

DEFAULT_BASE_URL = "http://localhost:1234/v1"
DEFAULT_MODEL = "qwen3.5-35b-a3b"
DEFAULT_API_KEY = "lm-studio"  # LM Studio ignores the key; not a secret.
DEFAULT_MAX_TOKENS = 1024
# Reasoning models spend their turn in the "thinking" channel and emit the JSON
# there, so they need a larger budget than non-reasoning models to finish.
DEFAULT_REASONING_MAX_TOKENS = 8192

DEFAULT_SINK = "mock"  # "mock" | "resend"; mock never sends a real email.

# Chat LLM provider — selects the swappable backend for the interactive chat.
# "mock" (default, offline) | "lmstudio" | "openai" | "claude". This is the one
# knob to change to move the demo between local and cloud models in production.
DEFAULT_LLM_PROVIDER = "mock"
DEFAULT_CLAUDE_MODEL = "claude-opus-4-8"
DEFAULT_OPENAI_MODEL = "gpt-4o-mini"
# LM Studio chat default: a nimble MEDIUM, non-reasoning model — big/reasoning
# models make the live run feel stuck. Override via IKARUS_CHAT_MODEL or the UI.
DEFAULT_LMSTUDIO_MODEL = "google/gemma-3-12b"

@dataclass(frozen=True)
class Settings:
    base_url: str
    model: str
    api_key: str = field(repr=False)  # may carry a real provider key; keep out of repr/logs
    max_tokens: int = DEFAULT_MAX_TOKENS
    reasoning_max_tokens: int = DEFAULT_REASONING_MAX_TOKENS
    sink: str = DEFAULT_SINK
    resend_api_key: str = field(default="", repr=False)  # secret — never in repr/logs
    email_from: str = ""
    # Hard backstop: a real sink only sends to addresses on this allowlist.
    allowed_recipients: tuple[str, ...] = ()
    # Chat provider selection + per-provider secrets/model (all secrets repr=False).
    llm_provider: str = DEFAULT_LLM_PROVIDER
    chat_model: str = ""  # empty → factory picks a per-provider default
    openai_api_key: str = field(default="", repr=False)
    anthropic_api_key: str = field(default="", repr=False)

def _read_dotenv(path: str) -> dict[str, str]:
    """Parse a minimal KEY=VALUE .env file (comments, blanks, and quotes handled).

    Pure and side-effect-free; a missing/unreadable file yields {}. This is the
    stand-in for python-dotenv so a local `.env` (IKARUS_SINK=resend + key +
    allowlist) actually takes effect — no extra dependency."""
    values: dict[str, str] = {}
    try:
        with open(path, encoding="utf-8") as fh:
            lines = fh.readlines()
    except OSError:
        return values
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        if key:
            values[key] = val.strip().strip('"').strip("'")
    return values


def _env() -> dict[str, str]:
    """Effective config: a local `.env` as fallback, real environment wins.

    Never mutates os.environ, so an explicit `export` (or a test's monkeypatch)
    always takes precedence over the file. Path overridable via IKARUS_ENV_FILE."""
    path = os.environ.get("IKARUS_ENV_FILE", ".env")
    return {**_read_dotenv(path), **os.environ}

def _int_env(env: dict, name: str, default: int) -> int:
    raw = env.get(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ValueError(f"env var {name}={raw!r} must be an integer") from exc

def load_settings() -> Settings:
    env = _env()
    return Settings(
        base_url=env.get("IKARUS_BASE_URL", DEFAULT_BASE_URL),
        model=env.get("IKARUS_MODEL", DEFAULT_MODEL),
        api_key=env.get("IKARUS_API_KEY", DEFAULT_API_KEY),
        max_tokens=_int_env(env, "IKARUS_MAX_TOKENS", DEFAULT_MAX_TOKENS),
        reasoning_max_tokens=_int_env(env, "IKARUS_REASONING_MAX_TOKENS", DEFAULT_REASONING_MAX_TOKENS),
        sink=env.get("IKARUS_SINK", DEFAULT_SINK),
        resend_api_key=env.get("RESEND_API_KEY", ""),
        email_from=env.get("IKARUS_EMAIL_FROM", ""),
        allowed_recipients=_parse_recipients(env.get("IKARUS_ALLOWED_RECIPIENTS", "")),
        llm_provider=env.get("IKARUS_LLM_PROVIDER", DEFAULT_LLM_PROVIDER),
        chat_model=env.get("IKARUS_CHAT_MODEL", ""),
        openai_api_key=env.get("IKARUS_OPENAI_API_KEY", ""),
        anthropic_api_key=env.get("ANTHROPIC_API_KEY", ""),
    )

def _parse_recipients(raw: str) -> tuple[str, ...]:
    # Normalize (trim + lowercase) so the allowlist match is case/space-insensitive.
    return tuple(addr.strip().lower() for addr in raw.split(",") if addr.strip())
