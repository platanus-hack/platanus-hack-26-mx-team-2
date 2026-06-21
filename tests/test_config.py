import os
from ikarus.config import load_settings, Settings, is_reasoning_model

def test_defaults_when_no_env(monkeypatch):
    for k in ("IKARUS_BASE_URL", "IKARUS_MODEL", "IKARUS_API_KEY",
              "IKARUS_MAX_TOKENS", "IKARUS_REASONING_MAX_TOKENS"):
        monkeypatch.delenv(k, raising=False)
    s = load_settings()
    assert isinstance(s, Settings)
    assert s.base_url == "http://localhost:1234/v1"
    assert s.model == "qwen3.5-35b-a3b"
    assert s.api_key == "lm-studio"
    # reasoning models get a larger budget so their turn doesn't end before
    # the JSON is emitted (it lives in the reasoning channel).
    assert s.reasoning_max_tokens > s.max_tokens

def test_env_overrides(monkeypatch):
    monkeypatch.setenv("IKARUS_BASE_URL", "http://x:9/v1")
    monkeypatch.setenv("IKARUS_MODEL", "qwen3.5-9b")
    s = load_settings()
    assert s.base_url == "http://x:9/v1"
    assert s.model == "qwen3.5-9b"

def test_token_budget_env_overrides(monkeypatch):
    monkeypatch.setenv("IKARUS_MAX_TOKENS", "512")
    monkeypatch.setenv("IKARUS_REASONING_MAX_TOKENS", "9000")
    s = load_settings()
    assert s.max_tokens == 512
    assert s.reasoning_max_tokens == 9000

def test_is_reasoning_model():
    assert is_reasoning_model("qwen/qwen3.5-9b")
    assert is_reasoning_model("deepseek/deepseek-r1-0528-qwen3-8b")
    assert not is_reasoning_model("google/gemma-3-12b")
    assert not is_reasoning_model("openai/gpt-oss-20b")

def test_sink_defaults_to_mock(monkeypatch):
    for k in ("IKARUS_SINK", "IKARUS_ALLOWED_RECIPIENTS", "RESEND_API_KEY",
              "IKARUS_EMAIL_FROM"):
        monkeypatch.delenv(k, raising=False)
    s = load_settings()
    assert s.sink == "mock"
    assert s.allowed_recipients == ()

def test_allowed_recipients_parsed_from_env(monkeypatch):
    monkeypatch.setenv("IKARUS_SINK", "resend")
    monkeypatch.setenv("RESEND_API_KEY", "re_x")
    monkeypatch.setenv("IKARUS_EMAIL_FROM", "onboarding@resend.dev")
    monkeypatch.setenv("IKARUS_ALLOWED_RECIPIENTS", "me@corp.com, me+spam@corp.com ,")
    s = load_settings()
    assert s.sink == "resend"
    assert s.resend_api_key == "re_x"
    assert s.email_from == "onboarding@resend.dev"
    assert s.allowed_recipients == ("me@corp.com", "me+spam@corp.com")
