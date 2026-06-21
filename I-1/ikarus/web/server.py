"""FastAPI app for the Ikarus demo + sandbox + chat.

The 3-scene engine runs in mock mode only. The interactive chat is powered by a
SWAPPABLE provider (mock | lmstudio | openai | claude) selected by config, so the
same UI works offline by default and against a real model when configured.
"""
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
            "chat_provider": load_settings().llm_provider,
        })

    @api.post("/chat", response_class=HTMLResponse)
    def chat(request: Request, message: str = Form(""), history: str = Form("[]")):
        settings = load_settings()
        messages = _parse_history(history)
        text = (message or "").strip()[:_MAX_MSG]
        if text:
            messages.append({"role": "user", "content": text})
            try:
                reply = make_chat_provider(settings).complete(_CHAT_SYSTEM, messages)
            except ChatError as exc:  # transport/API failure — surface, don't crash
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
