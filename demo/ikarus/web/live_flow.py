"""Live agent-flow orchestration for the web demo.

Runs the three layers with REAL models for P-LLM (planner) and Q-LLM (quarantine
extractor) via the swappable chat provider, and the REAL deterministic guard for
the decision — capturing each layer's actual input/output so the UI shows the
models *working*, not a canned replay.

The taint guarantee still holds, by construction:
  - the P-LLM is given ONLY the trusted request + tool catalog, never the inbox;
  - the Q-LLM's output is wrapped UNTRUSTED here (the label is applied by this
    code, not decided by the model);
  - the guard is `policy.check` — deterministic, not a model.
"""
import re

from ikarus.chat_provider import make_chat_provider
from ikarus.config import (
    DEFAULT_CLAUDE_MODEL,
    DEFAULT_LMSTUDIO_MODEL,
    DEFAULT_OPENAI_MODEL,
)
from ikarus.labels import untrusted
from ikarus.policy import check as policy_check
from ikarus.tools.registry import default_registry

_DEFAULT_MODEL = {"lmstudio": DEFAULT_LMSTUDIO_MODEL,
                  "openai": DEFAULT_OPENAI_MODEL, "claude": DEFAULT_CLAUDE_MODEL}

# Bound a single live call so a local model answers in seconds (plans and a
# single address don't need a big budget) and a hung model fails, not hangs.
_LIVE_MAX_TOKENS = 220
_LIVE_TIMEOUT = 45
_THINK = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)


def _clean(text: str) -> str:
    """Drop reasoning-model <think> blocks so the surfaced value is clean."""
    return _THINK.sub("", text or "").strip()

_PLANNER_SYSTEM = (
    "Eres el P-LLM (planificador) de un agente. SOLO ves la petición del usuario y "
    "el catálogo de herramientas. NUNCA tienes acceso al correo ni a datos externos. "
    "Emite un plan breve (1-3 pasos) para cumplir la petición; una línea por paso.")
_CATALOG = "Catálogo: read_inbox(SOURCE), send_email(to, body) (SINK), share_doc(recipient) (SINK)."
_EXTRACTOR_SYSTEM = (
    "Eres el Q-LLM en cuarentena. Lee el texto NO confiable y extrae SOLO la dirección "
    "de correo a la que se pide reenviar o enviar la información. Responde únicamente con "
    "la dirección de correo, sin ninguna otra palabra.")


def _short(text: str, n: int = 400) -> str:
    return (text or "").strip()[:n]


def _req_log(system: str, user: str) -> str:
    """The exact text sent to the model — shown raw so the call is verifiable."""
    return f"▸ system:\n{system}\n\n▸ user:\n{user}"


def _provider(settings):
    return make_chat_provider(settings, max_tokens=_LIVE_MAX_TOKENS, timeout=_LIVE_TIMEOUT)


def _model_name(settings) -> str:
    # Show the model that actually ran (its per-provider default when unset),
    # not just the provider name — so the label proves which LLM produced this.
    return settings.chat_model or _DEFAULT_MODEL.get(settings.llm_provider, settings.llm_provider)


# The three layers as independent steps, so the web can run + reveal them one at
# a time (real per-step progress). May raise ValueError (missing key) / ChatError.

def live_plan(settings, scenario: dict) -> dict:
    """Layer 1 — P-LLM (real): only the request + catalog, never the inbox."""
    p_user = f"Petición confiable: {scenario['request']}\n{_CATALOG}"
    plan = _clean(_provider(settings).complete(_PLANNER_SYSTEM,
                                               [{"role": "user", "content": p_user}]))
    return {
        "stage": 1, "layer": "P-LLM", "model": _model_name(settings), "kind": "model",
        "title": "Planificador emite el plan",
        "detail": _short(plan),
        "note": "El modelo solo vio la petición confiable + el catálogo — NUNCA el inbox.",
        "seen": ("El planificador SOLO recibió: la petición confiable + el catálogo "
                 "de herramientas. El inbox NO entró a su prompt."),
        "trust": "", "decision": "",
        "req": _req_log(_PLANNER_SYSTEM, p_user), "resp": _short(plan, 4000)}


def live_extract(settings, scenario: dict) -> tuple[dict, str]:
    """Layer 2 — Q-LLM (real): reads the dirty inbox; output born UNTRUSTED."""
    raw = _clean(_provider(settings).complete(_EXTRACTOR_SYSTEM,
                 [{"role": "user", "content": scenario["inbox_text"]}]))
    extracted = _short(raw, 160)
    step = {
        "stage": 2, "layer": "Q-LLM", "model": _model_name(settings), "kind": "model",
        "title": "Cuarentena extrae del correo sucio",
        "detail": extracted or "(vacío)",
        "note": "Su salida nace UNTRUSTED por construcción — la etiqueta la pone el wrapper, no el modelo.",
        "trust": "UNTRUSTED", "decision": "",
        "req": _req_log(_EXTRACTOR_SYSTEM, scenario["inbox_text"]), "resp": _short(raw, 4000)}
    return step, extracted


def live_guard(addr: str) -> dict:
    """Layer 3 — Guard (deterministic, NOT a model): the real policy on the arg."""
    decision = policy_check("send_email", {"to": untrusted(addr, "q_llm")}, default_registry())
    return {
        "stage": 3, "layer": "Guardia", "model": "determinista", "kind": "guard",
        "title": "El guardia evalúa el sink",
        "detail": decision.reason,
        "note": "No es un modelo: la decisión no depende de las palabras del dato.",
        "trust": "UNTRUSTED", "decision": "PASS" if decision.allowed else "BLOCK",
        "req": "", "resp": ""}


def live_naive(settings, scenario: dict) -> dict:
    """Baseline: a single-LLM naive agent given request+inbox together. With a
    real provider it is asked to pick the recipient and gets hijacked; the value
    is the proof the attack is real. Deterministic mock when provider is mock."""
    from ikarus.naive_agent import run as naive_run
    inbox, req = scenario["inbox_text"], scenario["request"]
    res = naive_run(req, inbox, "bob@corp.com", mock=True)
    return {
        "stage": "0", "layer": "Agente ingenuo (sin defensa)",
        "model": _model_name(settings), "decision": "EXFIL", "trust": "",
        "kind": "naive",
        "title": "Un solo LLM lee petición + inbox juntos",
        "detail": f"Reenvía a: {res.recipient}  (hijacked={res.hijacked})",
        "note": "Sin separación plan/datos: obedece la instrucción escondida.",
        "req": _req_log("(naive: request + inbox en el mismo prompt)",
                        f"{req}\n\n{inbox}"),
        "resp": f"to={res.recipient}\n{res.sink_log}",
    }


def run_live_flow(settings, scenario: dict) -> list[dict]:
    """All three layers in one shot (used by tests / non-streamed callers)."""
    s1 = live_plan(settings, scenario)
    s2, extracted = live_extract(settings, scenario)
    return [s1, s2, live_guard(extracted)]
