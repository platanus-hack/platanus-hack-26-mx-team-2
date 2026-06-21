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
from ikarus.chat_provider import make_chat_provider
from ikarus.labels import untrusted
from ikarus.policy import check as policy_check
from ikarus.tools.registry import default_registry

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


def run_live_flow(settings, scenario: dict) -> list[dict]:
    """Run P-LLM + Q-LLM (real) and the deterministic guard; return step dicts.

    `scenario` needs `request` and `inbox_text`. May raise ValueError (missing
    provider key) or ChatError (transport) — the caller surfaces those.
    """
    provider = make_chat_provider(settings)
    model = settings.chat_model or settings.llm_provider
    steps: list[dict] = []

    # Layer 1 — P-LLM (real): only the request + catalog, never the inbox.
    plan = provider.complete(_PLANNER_SYSTEM, [{"role": "user",
        "content": f"Petición confiable: {scenario['request']}\n{_CATALOG}"}])
    steps.append({
        "stage": 1, "layer": "P-LLM", "model": model, "kind": "model",
        "title": "Planificador emite el plan",
        "detail": _short(plan),
        "note": "El modelo solo vio la petición confiable + el catálogo — NUNCA el inbox.",
        "trust": "", "decision": ""})

    # Layer 2 — Q-LLM (real): reads the dirty inbox; output born UNTRUSTED here.
    extracted = _short(provider.complete(_EXTRACTOR_SYSTEM,
        [{"role": "user", "content": scenario["inbox_text"]}]), 160)
    tainted = untrusted(extracted, "q_llm")
    steps.append({
        "stage": 2, "layer": "Q-LLM", "model": model, "kind": "model",
        "title": "Cuarentena extrae del correo sucio",
        "detail": extracted or "(vacío)",
        "note": "Su salida nace UNTRUSTED por construcción — la etiqueta la pone el wrapper, no el modelo.",
        "trust": "UNTRUSTED", "decision": ""})

    # Layer 3 — Guard (deterministic, NOT a model): the real policy on the arg.
    decision = policy_check("send_email", {"to": tainted}, default_registry())
    steps.append({
        "stage": 3, "layer": "Guardia", "model": "determinista", "kind": "guard",
        "title": "El guardia evalúa el sink",
        "detail": decision.reason,
        "note": "No es un modelo: la decisión no depende de las palabras del dato.",
        "trust": "UNTRUSTED", "decision": "PASS" if decision.allowed else "BLOCK"})

    return steps
