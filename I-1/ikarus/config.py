import os
from dataclasses import dataclass, field

DEFAULT_BASE_URL = "http://localhost:1234/v1"
DEFAULT_MODEL = "qwen3.5-35b-a3b"
DEFAULT_API_KEY = "lm-studio"  # LM Studio ignores the key; not a secret.
DEFAULT_MAX_TOKENS = 1024
# Reasoning models spend their turn in the "thinking" channel and emit the JSON
# there, so they need a larger budget than non-reasoning models to finish.
DEFAULT_REASONING_MAX_TOKENS = 8192

# Substrings (matched case-insensitively against the model id) that mark a model
# as a reasoner. Override the budget via IKARUS_REASONING_MAX_TOKENS if needed.
REASONING_MODEL_MARKERS = (
    "qwen3", "deepseek-r1", "-r1", "qwq", "magistral", "hermes-4",
    "reasoner", "thinking",
)

DEFAULT_SINK = "mock"  # "mock" | "resend"; mock never sends a real email.

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

def is_reasoning_model(model: str) -> bool:
    """Heuristic: does this model id belong to a reasoning ('thinking') family?"""
    m = model.lower()
    if "-vl" in m:  # vision-language variants (e.g. qwen3-vl) are not reasoners
        return False
    return any(marker in m for marker in REASONING_MODEL_MARKERS)

def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ValueError(f"env var {name}={raw!r} must be an integer") from exc

def load_settings() -> Settings:
    return Settings(
        base_url=os.environ.get("IKARUS_BASE_URL", DEFAULT_BASE_URL),
        model=os.environ.get("IKARUS_MODEL", DEFAULT_MODEL),
        api_key=os.environ.get("IKARUS_API_KEY", DEFAULT_API_KEY),
        max_tokens=_int_env("IKARUS_MAX_TOKENS", DEFAULT_MAX_TOKENS),
        reasoning_max_tokens=_int_env("IKARUS_REASONING_MAX_TOKENS", DEFAULT_REASONING_MAX_TOKENS),
        sink=os.environ.get("IKARUS_SINK", DEFAULT_SINK),
        resend_api_key=os.environ.get("RESEND_API_KEY", ""),
        email_from=os.environ.get("IKARUS_EMAIL_FROM", ""),
        allowed_recipients=_parse_recipients(os.environ.get("IKARUS_ALLOWED_RECIPIENTS", "")),
    )

def _parse_recipients(raw: str) -> tuple[str, ...]:
    # Normalize (trim + lowercase) so the allowlist match is case/space-insensitive.
    return tuple(addr.strip().lower() for addr in raw.split(",") if addr.strip())
