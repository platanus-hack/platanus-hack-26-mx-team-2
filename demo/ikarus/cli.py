import argparse
from ikarus.scenarios import default_scenarios
from ikarus.composition import CompositionRoot
from ikarus.config import load_settings
from ikarus.tools.email_sink import make_email_sink


def run_scene(scene: int, scenario_name: str, mock: bool = True, client=None) -> dict:
    # make_email_sink is resolved here (not captured) so IKARUS_SINK — and tests
    # that monkeypatch ikarus.cli.make_email_sink — control the transport.
    settings = load_settings()
    app = CompositionRoot(settings, email_sink=make_email_sink(settings)).build()
    return app.run_scene(scene, scenario_name, mock=mock, client=client)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ikarus")
    parser.add_argument("--scene", choices=["1", "2", "3", "all"], default="all")
    parser.add_argument("--scenario", choices=default_scenarios().names(), default="email")
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
