import argparse
from ikarus.scenarios import SCENARIOS
from ikarus.tools.registry import default_registry
from ikarus.interpreter import run as run_plan
from ikarus.naive_agent import run as run_naive
from ikarus.tui import render_trace
from ikarus.p_llm import plan as plan_request, build_catalog
from ikarus.llm_client import LLMClient
from ikarus.config import load_settings

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
                       canonical=scenario.canonical_plan, client=client)
    return res.plan, res.used_fallback

def run_scene(scene: int, scenario_name: str, mock: bool = True, client=None) -> dict:
    scenario = SCENARIOS[scenario_name]()
    registry = default_registry()
    if scene == 3:
        res = run_naive(scenario.request, scenario.inbox_text,
                        scenario.trusted_recipient, mock=mock)
        text = (f"NAIVE AGENT sent to: {res.recipient}  "
                f"(hijacked={res.hijacked})\n{res.sink_log}")
        return {"text": text, "blocked": False, "executed_sinks": [],
                "used_fallback": False, "naive_recipient": res.recipient}
    plan, used_fallback = _select_plan(scene, scenario, registry, mock, client)
    result = run_plan(plan, scenario.request_values, scenario.inbox_text,
                      registry, mock=mock, q_mock_value=scenario.q_mock_value)
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
