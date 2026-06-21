"""Pure serialization of engine results into template-friendly view models.

No FastAPI here — easy to unit-test. The web routes call run_scenario() and pass
the resulting dict through scene_view().
"""
from ikarus.interpreter import ExecutionResult
from ikarus.labels import Trust

SCENE_TITLES = {
    1: "Scene 1 — architectural guarantee (the injection never reaches the plan)",
    2: "Scene 2 — taint guarantee (untrusted recipient blocked at the sink)",
    3: "Scene 3 — naive agent (single LLM) gets hijacked",
}


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


def scene_view(out: dict, scene: int) -> dict:
    result = out.get("result")
    return {
        "scene": scene,
        "title": SCENE_TITLES[scene],
        "is_naive": scene == 3,
        "verdict": "BLOCKED" if out["blocked"] else "ALLOWED",
        "blocked": out["blocked"],
        "rows": ledger_rows(result) if result is not None else [],
        "naive_recipient": out.get("naive_recipient"),
        "hijacked": out.get("hijacked", False),
        "naive_text": out.get("text") if scene == 3 else None,
        "used_fallback": out.get("used_fallback", False),
    }
