"""FastAPI app for the Ikarus demo + sandbox + chat.

The 3-scene engine runs in mock mode only. The interactive chat is powered by a
SWAPPABLE provider (mock | lmstudio | openai | claude) selected by config, so the
same UI works offline by default and against a real model when configured.
"""
import dataclasses
import json
from pathlib import Path
from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from ikarus.chat_provider import ChatError, make_chat_provider
from ikarus.composition import CompositionRoot
from ikarus.config import load_settings
from ikarus.naive_agent import extract_injected_address
from ikarus.scenarios import build_scenario, default_scenarios
from ikarus.tools.email_sink import make_email_sink
from ikarus.web.views import scene_view

_DIR = Path(__file__).parent
_SCENES = (1, 2, 3)
_FALLBACK_ATTACKER = "attacker@example.com"
_PROVIDERS = ("mock", "lmstudio", "openai", "claude")

# Runtime provider override set from the UI. In-memory only (never persisted to
# disk, never echoed back), so a key entered in the browser lives for the life
# of the process and nowhere else. Merged over env-based load_settings().
_RUNTIME: dict = {}


def _effective_settings():
    s = load_settings()
    return dataclasses.replace(s, **_RUNTIME) if _RUNTIME else s


def _provider_ctx(status: str = "", status_class: str = "") -> dict:
    """Template context for the provider picker. The key value is NEVER sent —
    only whether one is configured for the selected provider."""
    s = _effective_settings()
    p = s.llm_provider if s.llm_provider in _PROVIDERS else "mock"
    key_set = (bool(s.openai_api_key) if p == "openai"
               else bool(s.anthropic_api_key) if p == "claude" else False)
    return {"provider": p, "providers": _PROVIDERS, "model": s.chat_model,
            "needs_key": p in ("openai", "claude"), "key_set": key_set,
            "status": status, "status_class": status_class}

# Naive-agent persona for the chat: it has access to the user's inbox, which is
# exactly what makes hidden-instruction injection demonstrable.
_CHAT_SYSTEM = ("Eres el asistente de Ikarus. Ayudas al usuario con su petición y "
                "tienes acceso a su bandeja de entrada. Responde en español, breve.")
_MAX_HISTORY = 20        # cap turns kept (DoS / cost guard)
_MAX_MSG = 4000          # cap chars per message (validate at the boundary)
_ROLES = ("user", "assistant")


def _parse_history(raw: str) -> list[dict]:
    """Validate the client-supplied conversation. Never trust external data."""
    try:
        data = json.loads(raw or "[]")
    except (ValueError, TypeError):
        return []
    out: list[dict] = []
    if isinstance(data, list):
        for m in data[-_MAX_HISTORY:]:
            if (isinstance(m, dict) and m.get("role") in _ROLES
                    and isinstance(m.get("content"), str)):
                out.append({"role": m["role"], "content": m["content"][:_MAX_MSG]})
    return out


def _app_service():
    settings = load_settings()
    return CompositionRoot(settings, email_sink=make_email_sink(settings)).build()


def _run_scenes_for(scenario) -> list[dict]:
    svc = _app_service()
    return [scene_view(svc.run_scenario(s, scenario, mock=True), s) for s in _SCENES]


def create_app() -> FastAPI:
    api = FastAPI(title="Ikarus — containing prompt injection by design")
    api.mount("/static", StaticFiles(directory=str(_DIR / "static")), name="static")
    templates = Jinja2Templates(directory=str(_DIR / "templates"))

    @api.get("/", response_class=HTMLResponse)
    def index(request: Request):
        scenario = default_scenarios().create("email")
        return templates.TemplateResponse(request, "index.html", {
            "scenes": _run_scenes_for(scenario),
            "default_request": scenario.request,
            "default_recipient": scenario.trusted_recipient,
            "default_body": "Q3 figures: revenue up 12%.",
            "default_inbox": scenario.inbox_text,
            "chat_messages": [],
            "chat_history_json": "[]",
            "chat_provider": _effective_settings().llm_provider,
            "provider_ctx": _provider_ctx(),
        })

    @api.post("/provider", response_class=HTMLResponse)
    def set_provider(request: Request, provider: str = Form("mock"),
                     model: str = Form(""), api_key: str = Form("")):
        provider = provider if provider in _PROVIDERS else "mock"
        _RUNTIME["llm_provider"] = provider
        if model.strip():
            _RUNTIME["chat_model"] = model.strip()
        else:
            _RUNTIME.pop("chat_model", None)  # fall back to per-provider default
        key = api_key.strip()
        if provider == "openai" and key:
            _RUNTIME["openai_api_key"] = key
        if provider == "claude" and key:
            _RUNTIME["anthropic_api_key"] = key
        try:  # fail fast: a missing key surfaces here, not at first message
            make_chat_provider(_effective_settings())
            status, cls = f"Conectado a {provider}.", "ok"
        except ValueError as exc:
            status, cls = str(exc), "err"
        return templates.TemplateResponse(request, "_provider.html",
                                          _provider_ctx(status, cls))

    @api.post("/chat", response_class=HTMLResponse)
    def chat(request: Request, message: str = Form(""), history: str = Form("[]")):
        settings = _effective_settings()
        messages = _parse_history(history)
        text = (message or "").strip()[:_MAX_MSG]
        if text:
            messages.append({"role": "user", "content": text})
            try:
                reply = make_chat_provider(settings).complete(_CHAT_SYSTEM, messages)
            except (ChatError, ValueError) as exc:  # transport/config — surface, don't crash
                reply = f"[error] {exc}"
            messages.append({"role": "assistant", "content": reply})
        messages = messages[-_MAX_HISTORY:]
        return templates.TemplateResponse(request, "_chat.html", {
            "messages": messages,
            "history_json": json.dumps(messages, ensure_ascii=False),
            "provider": settings.llm_provider,
        })

    @api.post("/sandbox", response_class=HTMLResponse)
    def sandbox(request: Request,
                user_request: str = Form(...), body: str = Form(...),
                trusted_recipient: str = Form(...), inbox_text: str = Form(...)):
        attacker = extract_injected_address(inbox_text) or _FALLBACK_ATTACKER
        scenario = build_scenario(
            name="custom", request=user_request, body=body,
            trusted_recipient=trusted_recipient, attacker_address=attacker,
            inbox_text=inbox_text)
        return templates.TemplateResponse(request, "_scenes.html", {
            "scenes": _run_scenes_for(scenario)})

    return api


app = create_app()
