import os
from ikarus.config import load_settings, Settings

def test_defaults_when_no_env(monkeypatch):
    for k in ("IKARUS_BASE_URL", "IKARUS_MODEL", "IKARUS_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    s = load_settings()
    assert isinstance(s, Settings)
    assert s.base_url == "http://localhost:1234/v1"
    assert s.model == "qwen3.5-35b-a3b"
    assert s.api_key == "lm-studio"

def test_env_overrides(monkeypatch):
    monkeypatch.setenv("IKARUS_BASE_URL", "http://x:9/v1")
    monkeypatch.setenv("IKARUS_MODEL", "qwen3.5-9b")
    s = load_settings()
    assert s.base_url == "http://x:9/v1"
    assert s.model == "qwen3.5-9b"
