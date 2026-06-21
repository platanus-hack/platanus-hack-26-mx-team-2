import pytest


@pytest.fixture(autouse=True)
def _hermetic_env(monkeypatch):
    """Tests must be hermetic: never read a developer's local `.env`, and never
    pick up real-send / provider vars an interactive shell may have exported.

    Points the .env loader at a path that does not exist (so it yields nothing)
    and clears the secret/transport vars. Tests that need a specific .env override
    IKARUS_ENV_FILE themselves; their later monkeypatch wins over this one.
    """
    monkeypatch.setenv("IKARUS_ENV_FILE", "/nonexistent/.ikarus-test-env")
    for key in ("IKARUS_SINK", "RESEND_API_KEY", "IKARUS_EMAIL_FROM",
                "IKARUS_ALLOWED_RECIPIENTS", "IKARUS_LLM_PROVIDER",
                "IKARUS_OPENAI_API_KEY", "ANTHROPIC_API_KEY"):
        monkeypatch.delenv(key, raising=False)
