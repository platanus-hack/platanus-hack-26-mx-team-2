import json
from typing import Any, Optional
from ikarus.config import Settings

class LLMError(Exception):
    pass

class LLMClient:
    def __init__(self, settings: Settings, _client: Optional[Any] = None) -> None:
        self._settings = settings
        if _client is not None:
            self._client = _client
        else:
            from openai import OpenAI  # imported lazily so tests need no network/dep
            self._client = OpenAI(base_url=settings.base_url, api_key=settings.api_key)

    def structured(self, system: str, user: str, json_schema: dict, schema_name: str) -> dict:
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
            )
        except Exception as exc:  # transport / API failure
            raise LLMError(f"LLM call failed: {exc}") from exc
        content = resp.choices[0].message.content
        try:
            return json.loads(content)
        except (json.JSONDecodeError, TypeError) as exc:
            raise LLMError(f"LLM returned non-JSON: {content!r}") from exc
