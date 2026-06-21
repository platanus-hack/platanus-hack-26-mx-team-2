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
from ikarus.tools.email_sink import MockEmailSink, make_email_sink, SinkError
from ikarus.web.live_flow import live_extract, live_guard, live_naive, live_plan
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


def autodetect_provider() -> str:
    """If the user didn't pick a provider and LM Studio is reachable, default the
    chat/live flow to it — so real model output 'just works'. Returns the resolved
    provider (for the startup log). Only called from `python -m ikarus.web`, never
    from tests (which import create_app directly), so test mode stays mock.
    """
    import os
    import urllib.request
    if os.environ.get("IKARUS_LLM_PROVIDER") or _RUNTIME.get("llm_provider"):
        return _effective_settings().llm_provider  # explicit choice wins
    base = load_settings().base_url.rstrip("/")
    try:
        req = urllib.request.Request(base + "/models", headers={"User-Agent": "ikarus/0.1"})
        with urllib.request.urlopen(req, timeout=1.5) as resp:  # noqa: S310
            if 200 <= resp.status < 300:
                _RUNTIME["llm_provider"] = "lmstudio"
                return "lmstudio"
    except Exception:
        pass  # LM Studio not up → stay mock (offline)
    return "mock"


def _provider_ctx(status: str = "", status_class: str = "", oob: bool = False) -> dict:
    """Template context for the provider picker. The key value is NEVER sent —
    only whether one is configured for the selected provider. `oob` adds an
    out-of-band swap so the chat's provider chip updates on Conectar."""
    s = _effective_settings()
    p = s.llm_provider if s.llm_provider in _PROVIDERS else "mock"
    key_set = (bool(s.openai_api_key) if p == "openai"
               else bool(s.anthropic_api_key) if p == "claude" else False)
    return {"provider": p, "providers": _PROVIDERS, "model": s.chat_model,
            "needs_key": p in ("openai", "claude"), "key_set": key_set,
            "status": status, "status_class": status_class, "oob": oob}

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
    # The web demo is mock-only: force the mock email sink regardless of env
    # (e.g. a local .env with IKARUS_SINK=resend), so the guided demo never
    # attempts a real send. Real delivery is a CLI-only feature.
    return CompositionRoot(load_settings(), email_sink=MockEmailSink()).build()


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
                                          _provider_ctx(status, cls, oob=True))

    @api.post("/chat", response_class=HTMLResponse)
    def chat(request: Request, message: str = Form(""), history: str = Form("[]")):
        settings = _effective_settings()
        messages = _parse_history(history)
        text = (message or "").strip()[:_MAX_MSG]
        log_req = log_resp = ""
        if text:
            messages.append({"role": "user", "content": text})
            sent = list(messages)  # exactly what goes to the model (proof, not facade)
            try:
                reply = make_chat_provider(settings).complete(_CHAT_SYSTEM, sent)
            except (ChatError, ValueError) as exc:  # transport/config — surface, don't crash
                reply = f"[error] {exc}"
            messages.append({"role": "assistant", "content": reply})
            log_req = "▸ system:\n" + _CHAT_SYSTEM + "\n\n" + "\n".join(
                f"▸ {m['role']}:\n{m['content']}" for m in sent)
            log_resp = reply
        messages = messages[-_MAX_HISTORY:]
        return templates.TemplateResponse(request, "_chat.html", {
            "messages": messages,
            "history_json": json.dumps(messages, ensure_ascii=False),
            "provider": settings.llm_provider,
            "log_req": log_req, "log_resp": log_resp,
        })

    def _live_scenario(name: str = "email") -> dict:
        n = name if name in default_scenarios() else "email"
        s = default_scenarios().create(n)
        return {"request": s.request, "inbox_text": s.inbox_text}

    def _live_error(request: Request, exc) -> HTMLResponse:
        return templates.TemplateResponse(request, "_flow_error.html", {"error": str(exc)})

    @api.post("/flow/live", response_class=HTMLResponse)  # full walk: naive + P + Q + guard
    def flow_live(request: Request, scenario: str = Form("email")):
        # Run the whole flow in one request and return ALL steps, so the client can
        # present a navigable pipeline (strip + step/replay/reset) instead of a
        # one-shot wall of logs. The per-step endpoints below remain for direct use.
        settings = _effective_settings()
        sc = _live_scenario(scenario)
        try:
            steps = [live_naive(settings, sc), live_plan(settings, sc)]
            ext_step, extracted = live_extract(settings, sc)
            steps += [ext_step, live_guard(extracted)]
        except (ChatError, ValueError) as exc:
            return _live_error(request, exc)
        return templates.TemplateResponse(request, "_flow_live.html", {
            "steps": steps, "provider": settings.llm_provider, "scenario": scenario})

    @api.post("/flow/live/extract", response_class=HTMLResponse)  # step 2 — Q-LLM
    def flow_live_extract(request: Request, scenario: str = Form("email")):
        settings = _effective_settings()
        try:
            step, extracted = live_extract(settings, _live_scenario(scenario))
        except (ChatError, ValueError) as exc:
            return _live_error(request, exc)
        return templates.TemplateResponse(request, "_flow_extract.html", {
            "step": step, "extracted": extracted, "scenario": scenario})

    @api.post("/flow/live/guard", response_class=HTMLResponse)  # step 3 — guard (deterministic)
    def flow_live_guard(request: Request, addr: str = Form("")):
        step = live_guard((addr or "").strip()[:200])
        return templates.TemplateResponse(request, "_flow_step.html", {"s": step})

    @api.post("/send-test", response_class=HTMLResponse)
    def send_test(request: Request):
        # Real delivery is OPT-IN and one email per click. Independent of the
        # mock 3-scene display. Only sends when IKARUS_SINK=resend is configured.
        s = load_settings()
        if s.sink != "resend":
            return templates.TemplateResponse(request, "_send_result.html", {
                "status": ("Modo mock: no se envió nada. Para un envío real define "
                           "IKARUS_SINK=resend + RESEND_API_KEY + allowlist."),
                "cls": "warn"})
        to = s.allowed_recipients[0] if s.allowed_recipients else (s.email_from or "")
        try:
            log = make_email_sink(s).send(to, body="Ikarus: correo de prueba (1).")
            status, cls = f"Enviado a {to}: {log}", "ok"
        except SinkError as exc:
            status, cls = f"Rechazado: {exc}", "err"
        except Exception as exc:  # transport/config — never crash the page
            status, cls = f"Error: {exc}", "err"
        return templates.TemplateResponse(request, "_send_result.html",
                                          {"status": status, "cls": cls})

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
