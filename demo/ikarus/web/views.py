"""Pure serialization of engine results into template-friendly view models.

No FastAPI here — easy to unit-test. The web routes call run_scenario() and pass
the resulting dict through scene_view().

UI copy is Spanish (PH26 MEX); engine tokens (TRUSTED/UNTRUSTED/PASS/BLOCK and
the ALLOWED/BLOCKED verdict) stay in English on purpose — they are the labels the
deterministic interpreter emits, not prose.
"""
from ikarus.interpreter import ExecutionResult
from ikarus.labels import Trust

SCENE_TITLES = {
    1: "Escena 1 — garantía arquitectónica",
    2: "Escena 2 — garantía de taint",
    3: "Escena 3 — agente ingenuo (un solo LLM)",
}

# One-line Spanish summary shown under each scene title.
SCENE_SUBTITLES = {
    1: "La inyección escondida en el inbox nunca llega al plan: el P-LLM jamás lee el correo.",
    2: "El destinatario sale de datos en cuarentena → nace UNTRUSTED → el guardia lo bloquea en el sink.",
    3: "Sin separación de capas, el mismo LLM lee el dato sucio y se deja secuestrar.",
}

# Which of the three layers each scene puts under the spotlight (for the diagram).
SCENE_LAYERS = {1: "p_llm", 2: "interpreter", 3: "naive"}


def ledger_rows(result: ExecutionResult) -> list[dict]:
    rows: list[dict] = []
    for e in result.events:
        trust = trust_class = ""
        if e.tainted is not None:
            t = e.tainted.provenance.trust
            trust = t.value
            trust_class = "trusted" if t == Trust.TRUSTED else "untrusted"
        policy = policy_class = ""
        if e.decision is not None:
            if e.decision.allowed:
                policy, policy_class = "PASS", "pass"
            else:
                policy, policy_class = f"BLOCK — {e.decision.reason}", "block"
        rows.append({
            "step": e.step_id, "kind": e.kind, "detail": e.detail,
            "trust": trust, "trust_class": trust_class,
            "policy": policy, "policy_class": policy_class,
        })
    return rows


def scene_status(out: dict, scene: int) -> tuple[str, str]:
    """Headline status token + CSS class for the scene badge.

    Scenes 1-2 are Ikarus (ALLOWED / BLOCKED). Scene 3 is the naive contrast
    (HIJACKED / SAFE). The class drives the semantic color (green/red).
    """
    if scene == 3:
        return ("HIJACKED", "danger") if out.get("hijacked") else ("SAFE", "ok")
    return ("BLOCKED", "danger") if out["blocked"] else ("ALLOWED", "ok")


def scene_view(out: dict, scene: int) -> dict:
    result = out.get("result")
    status, status_class = scene_status(out, scene)
    return {
        "scene": scene,
        "title": SCENE_TITLES[scene],
        "subtitle": SCENE_SUBTITLES[scene],
        "layer": SCENE_LAYERS[scene],
        "is_naive": scene == 3,
        "status": status,
        "status_class": status_class,
        "verdict": "BLOCKED" if out["blocked"] else "ALLOWED",
        "blocked": out["blocked"],
        "rows": ledger_rows(result) if result is not None else [],
        "naive_recipient": out.get("naive_recipient"),
        "hijacked": out.get("hijacked", False),
        "naive_text": out.get("text") if scene == 3 else None,
        "used_fallback": out.get("used_fallback", False),
    }
