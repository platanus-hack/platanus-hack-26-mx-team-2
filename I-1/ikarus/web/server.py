"""FastAPI app for the Ikarus demo + sandbox. Engine runs in mock mode only."""
from pathlib import Path
from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from ikarus.composition import CompositionRoot
from ikarus.config import load_settings
from ikarus.naive_agent import extract_injected_address
from ikarus.scenarios import build_scenario, default_scenarios
from ikarus.tools.email_sink import make_email_sink
from ikarus.web.views import scene_view

_DIR = Path(__file__).parent
_SCENES = (1, 2, 3)
_FALLBACK_ATTACKER = "attacker@example.com"


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
        return templates.TemplateResponse("index.html", {
            "request": request,
            "scenes": _run_scenes_for(scenario),
            "default_request": scenario.request,
            "default_recipient": scenario.trusted_recipient,
            "default_body": "Q3 figures: revenue up 12%.",
            "default_inbox": scenario.inbox_text,
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
        return templates.TemplateResponse("_scenes.html", {
            "request": request, "scenes": _run_scenes_for(scenario)})

    return api


app = create_app()
