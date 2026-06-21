import os
from dataclasses import dataclass

DEFAULT_BASE_URL = "http://localhost:1234/v1"
DEFAULT_MODEL = "qwen3.5-35b-a3b"
DEFAULT_API_KEY = "lm-studio"  # LM Studio ignores the key; not a secret.

@dataclass(frozen=True)
class Settings:
    base_url: str
    model: str
    api_key: str

def load_settings() -> Settings:
    return Settings(
        base_url=os.environ.get("IKARUS_BASE_URL", DEFAULT_BASE_URL),
        model=os.environ.get("IKARUS_MODEL", DEFAULT_MODEL),
        api_key=os.environ.get("IKARUS_API_KEY", DEFAULT_API_KEY),
    )
