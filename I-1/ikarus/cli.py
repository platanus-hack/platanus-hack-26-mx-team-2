import argparse
from ikarus.scenarios import SCENARIOS
from ikarus.tools.registry import default_registry
from ikarus.interpreter import run as run_plan, validate_plan
from ikarus.naive_agent import run as run_naive
from ikarus.tui import render_trace
from ikarus.p_llm import plan as plan_request, build_catalog
from ikarus.llm_client import LLMClient
from ikarus.config import load_settings
from ikarus.tools.email_sink import make_email_sink
from ikarus.tools.sinks import share_doc

def _select_plan(scene, scenario, registry, mock, client):
    """Scene 1: hybrid live wiring — real P-LLM emits the plan in live mode.
    Scene 2: always the deliberately-subverted tainted plan (defense-in-depth)."""
    if scene == 2:
        return scenario.tainted_plan, False
    if mock:
        return scenario.canonical_plan, False
    if client is None:
        client = LLMClient(load_settings())
    res = plan_request(scenario.request, build_catalog(registry),
                       canonical=scenario.canonical_plan,
                       request_fields=list(scenario.request_values),
                       client=client)
    # A real model can emit a schema-valid but unexecutable plan; fall back to
    # the canonical plan rather than crash the interpreter (or fire a sink with
    # a half-resolved plan).
    if not res.used_fallback and validate_plan(res.plan, registry, scenario.request_values):
        return scenario.canonical_plan, True
    return res.plan, res.used_fallback

def run_scene(scene: int, scenario_name: str, mock: bool = True, client=None) -> dict:
    scenario = SCENARIOS[scenario_name]()
    registry = default_registry()
    # The email sink is mock by default; with IKARUS_SINK=resend it sends real
    # mail (allowlist-gated). share_doc stays mock — no real document sharing.
    email_sink = make_email_sink(load_settings())
    sinks = {"send_email": email_sink.send, "share_doc": share_doc}
    if scene == 3:
        res = run_naive(scenario.request, scenario.inbox_text,
                        scenario.trusted_recipient, mock=mock,
                        email_send=email_sink.send)
        text = (f"NAIVE AGENT sent to: {res.recipient}  "
                f"(hijacked={res.hijacked})\n{res.sink_log}")
        return {"text": text, "blocked": False, "executed_sinks": [],
                "used_fallback": False, "naive_recipient": res.recipient}
    plan, used_fallback = _select_plan(scene, scenario, registry, mock, client)
    result = run_plan(plan, scenario.request_values, scenario.inbox_text,
                      registry, mock=mock, q_mock_value=scenario.q_mock_value,
                      sinks=sinks)
    return {"text": render_trace(result), "blocked": result.blocked,
            "executed_sinks": result.executed_sinks, "used_fallback": used_fallback,
            "naive_recipient": None}

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ikarus")
    parser.add_argument("--scene", choices=["1", "2", "3", "all"], default="all")
    parser.add_argument("--scenario", choices=list(SCENARIOS), default="email")
    parser.add_argument("--mock", action="store_true", default=True)
    parser.add_argument("--live", dest="mock", action="store_false")
    args = parser.parse_args(argv)
    scenes = [1, 2, 3] if args.scene == "all" else [int(args.scene)]
    for sc in scenes:
        out = run_scene(sc, args.scenario, mock=args.mock)
        print(f"\n===== SCENE {sc} ({args.scenario}) =====")
        print(out["text"])
        if not args.mock and out["used_fallback"]:
            print("[note] P-LLM unavailable/invalid — used canonical fallback plan.")
        if sc != 3:
            print(f"VERDICT: {'BLOCKED' if out['blocked'] else 'ALLOWED'}")
    return 0
