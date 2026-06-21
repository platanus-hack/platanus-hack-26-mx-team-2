import json
import pytest
from ikarus.config import Settings
from ikarus.llm_client import LLMClient, LLMError

class _FakeMessage:
    def __init__(self, content): self.content = content
class _FakeChoice:
    def __init__(self, content): self.message = _FakeMessage(content)
class _FakeResp:
    def __init__(self, content): self.choices = [_FakeChoice(content)]
class _FakeCompletions:
    def __init__(self, content, exc=None): self._content, self._exc = content, exc
    def create(self, **kwargs):
        if self._exc: raise self._exc
        return _FakeResp(self._content)
class _FakeChat:
    def __init__(self, completions): self.completions = completions
class _FakeOpenAI:
    def __init__(self, content=None, exc=None):
        self.chat = _FakeChat(_FakeCompletions(content, exc))

def _settings():
    return Settings(base_url="http://x/v1", model="m", api_key="k")

def test_structured_returns_parsed_json():
    client = LLMClient(_settings(), _client=_FakeOpenAI(content=json.dumps({"ok": True})))
    out = client.structured("sys", "usr", {"type": "object"}, "S")
    assert out == {"ok": True}

def test_structured_raises_llmerror_on_transport_failure():
    client = LLMClient(_settings(), _client=_FakeOpenAI(exc=RuntimeError("down")))
    with pytest.raises(LLMError):
        client.structured("sys", "usr", {"type": "object"}, "S")

def test_structured_raises_llmerror_on_bad_json():
    client = LLMClient(_settings(), _client=_FakeOpenAI(content="not json"))
    with pytest.raises(LLMError):
        client.structured("sys", "usr", {"type": "object"}, "S")
