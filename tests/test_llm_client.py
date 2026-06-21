import json
import pytest
from ikarus.config import Settings
from ikarus.llm_client import LLMClient, LLMError

class _FakeMessage:
    def __init__(self, content, reasoning_content=None):
        self.content = content
        if reasoning_content is not None:
            self.reasoning_content = reasoning_content
class _FakeChoice:
    def __init__(self, content, reasoning_content=None):
        self.message = _FakeMessage(content, reasoning_content)
class _FakeResp:
    def __init__(self, content, reasoning_content=None):
        self.choices = [_FakeChoice(content, reasoning_content)]
class _FakeCompletions:
    def __init__(self, content, exc=None, reasoning_content=None):
        self._content, self._exc, self._reasoning = content, exc, reasoning_content
        self.last_kwargs = None
    def create(self, **kwargs):
        self.last_kwargs = kwargs
        if self._exc: raise self._exc
        return _FakeResp(self._content, self._reasoning)
class _FakeChat:
    def __init__(self, completions): self.completions = completions
class _FakeOpenAI:
    def __init__(self, content=None, exc=None, reasoning_content=None):
        self.completions = _FakeCompletions(content, exc, reasoning_content)
        self.chat = _FakeChat(self.completions)

def _settings(model="m", max_tokens=1024, reasoning_max_tokens=8192):
    return Settings(base_url="http://x/v1", model=model, api_key="k",
                    max_tokens=max_tokens, reasoning_max_tokens=reasoning_max_tokens)

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

def test_structured_rescues_json_from_reasoning_content():
    # Reasoning models emit the JSON into reasoning_content, leaving content empty.
    fake = _FakeOpenAI(content="", reasoning_content=json.dumps({"steps": []}))
    out = LLMClient(_settings(), _client=fake).structured("s", "u", {"type": "object"}, "S")
    assert out == {"steps": []}

def test_structured_extracts_json_block_from_reasoning_prose():
    reasoning = "Thinking Process:\nLet me plan.\n{\"steps\": [1]}\nDone."
    fake = _FakeOpenAI(content="", reasoning_content=reasoning)
    out = LLMClient(_settings(), _client=fake).structured("s", "u", {"type": "object"}, "S")
    assert out == {"steps": [1]}

def test_reasoning_model_gets_larger_max_tokens():
    fake = _FakeOpenAI(content=json.dumps({"ok": True}))
    LLMClient(_settings(model="qwen/qwen3.5-9b", reasoning_max_tokens=8192),
              _client=fake).structured("s", "u", {"type": "object"}, "S")
    assert fake.completions.last_kwargs["max_tokens"] == 8192

def test_non_reasoning_model_uses_base_max_tokens():
    fake = _FakeOpenAI(content=json.dumps({"ok": True}))
    LLMClient(_settings(model="google/gemma-3-12b", max_tokens=1024),
              _client=fake).structured("s", "u", {"type": "object"}, "S")
    assert fake.completions.last_kwargs["max_tokens"] == 1024
