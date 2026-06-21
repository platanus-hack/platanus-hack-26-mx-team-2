import os
import pytest
from ikarus.config import load_settings, Settings

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

def test_invalid_int_env_raises_clear_error(monkeypatch):
    monkeypatch.setenv("IKARUS_MAX_TOKENS", "not-a-number")
    with pytest.raises(ValueError, match="IKARUS_MAX_TOKENS"):
        load_settings()

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


def test_read_dotenv_parses_keys_comments_and_quotes(tmp_path):
    from ikarus.config import _read_dotenv
    p = tmp_path / ".env"
    p.write_text('# a comment\nIKARUS_SINK=resend\nRESEND_API_KEY="re_secret"\n\n'
                 "no_equals_line\nIKARUS_EMAIL_FROM='demo@x.com'\n")
    d = _read_dotenv(str(p))
    assert d["IKARUS_SINK"] == "resend"
    assert d["RESEND_API_KEY"] == "re_secret"      # quotes stripped
    assert d["IKARUS_EMAIL_FROM"] == "demo@x.com"
    assert "no_equals_line" not in d


def test_read_dotenv_missing_file_is_empty():
    from ikarus.config import _read_dotenv
    assert _read_dotenv("/no/such/.env") == {}


def test_load_settings_reads_dotenv_file(tmp_path, monkeypatch):
    env = tmp_path / "demo.env"
    env.write_text("IKARUS_SINK=resend\nIKARUS_EMAIL_FROM=demo@x.com\n"
                   "IKARUS_ALLOWED_RECIPIENTS=me@x.com\n")
    monkeypatch.setenv("IKARUS_ENV_FILE", str(env))
    monkeypatch.delenv("IKARUS_SINK", raising=False)
    monkeypatch.delenv("IKARUS_EMAIL_FROM", raising=False)
    s = load_settings()
    assert s.sink == "resend"                       # picked up from the .env file
    assert s.email_from == "demo@x.com"
    assert s.allowed_recipients == ("me@x.com",)


def test_explicit_env_wins_over_dotenv(tmp_path, monkeypatch):
    env = tmp_path / "demo.env"
    env.write_text("IKARUS_SINK=resend\n")
    monkeypatch.setenv("IKARUS_ENV_FILE", str(env))
    monkeypatch.setenv("IKARUS_SINK", "mock")        # explicit shell env must win
    assert load_settings().sink == "mock"
