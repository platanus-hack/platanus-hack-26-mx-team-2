import json
from typing import Any, Optional
from ikarus.config import Settings, is_reasoning_model

class LLMError(Exception):
    pass

def _parse_json(text: Optional[str]) -> dict:
    """Parse JSON, tolerating a JSON object embedded in surrounding prose.

    Scans each '{' with a streaming decoder and returns the first object that
    decodes cleanly — robust when the model wraps the JSON in reasoning text or
    emits more than one object (vs. the fragile first-'{'/last-'}' span).
    """
    text = (text or "").strip()
    if not text:
        raise LLMError("LLM returned empty content")
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        pass
    decoder = json.JSONDecoder()
    idx = text.find("{")
    while idx != -1:
        try:
            obj, _ = decoder.raw_decode(text, idx)
            if isinstance(obj, dict):
                return obj
        except json.JSONDecodeError:
            pass
        idx = text.find("{", idx + 1)
    raise LLMError(f"LLM returned non-JSON: {text!r}")

def _reasoning_content(message: Any) -> Optional[str]:
    rc = getattr(message, "reasoning_content", None)
    if rc is None:
        rc = (getattr(message, "model_extra", None) or {}).get("reasoning_content")
    return rc

class LLMClient:
    def __init__(self, settings: Settings, _client: Optional[Any] = None) -> None:
        self._settings = settings
        if _client is not None:
            self._client = _client
        else:
            from openai import OpenAI  # imported lazily so tests need no network/dep
            self._client = OpenAI(base_url=settings.base_url, api_key=settings.api_key)

    def structured(self, system: str, user: str, json_schema: dict, schema_name: str) -> dict:
        # Reasoning models burn their turn in the thinking channel and emit the
        # JSON there, so give them a larger budget than non-reasoning models.
        max_tokens = (
            self._settings.reasoning_max_tokens
            if is_reasoning_model(self._settings.model)
            else self._settings.max_tokens
        )
        try:
            resp = self._client.chat.completions.create(
                model=self._settings.model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                response_format={
                    "type": "json_schema",
                    "json_schema": {"name": schema_name, "schema": json_schema},
                },
                temperature=0,
                max_tokens=max_tokens,
            )
        except Exception as exc:  # transport / API failure
            raise LLMError(f"LLM call failed: {exc}") from exc
        try:
            message = resp.choices[0].message
        except (IndexError, AttributeError) as exc:
            raise LLMError(f"LLM returned no choices: {resp!r}") from exc
        # Some reasoning models leave `content` empty and put the JSON in the
        # reasoning channel; fall back to it before giving up.
        return _parse_json(message.content or _reasoning_content(message))
