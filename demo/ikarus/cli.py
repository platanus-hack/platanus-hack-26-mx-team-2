import argparse
from rich.console import Console
from rich.panel import Panel
from ikarus.scenarios import default_scenarios
from ikarus.composition import CompositionRoot
from ikarus.config import load_settings
from ikarus.chat_provider import ChatError
from ikarus.tools.email_sink import make_email_sink
from ikarus.web.live_flow import live_extract, live_guard, live_naive, live_plan

# One-line purpose shown under each scene title (the structured taint proof).
SCENE_SUBTITLE = {
    1: "garantía arquitectónica — la inyección del inbox nunca llega al plan",
    2: "garantía de taint — el destinatario sale de cuarentena → UNTRUSTED → bloqueado",
    3: "agente ingenuo (1 LLM) — sin separación, obedece la instrucción escondida",
}


def run_scene(scene: int, scenario_name: str, mock: bool = True, client=None) -> dict:
    # make_email_sink is resolved here (not captured) so IKARUS_SINK — and tests
    # that monkeypatch ikarus.cli.make_email_sink — control the transport.
    settings = load_settings()
    app = CompositionRoot(settings, email_sink=make_email_sink(settings)).build()
    return app.run_scene(scene, scenario_name, mock=mock, client=client)


def _print_logs(console: Console, step: dict) -> None:
    """Print one live-flow step: layer, model, decision badge, and raw model I/O."""
    badge = ""
    if step.get("decision") in ("BLOCK", "EXFIL"):
        badge = f"[bold red]{step['decision']}[/]"
    elif step.get("decision") == "PASS":
        badge = "[bold green]PASS[/]"
    elif step.get("trust") == "UNTRUSTED":
        badge = "[bold yellow]UNTRUSTED[/]"
    console.print(f"\n[bold]▸ Capa {step['stage']} · {step['layer']}[/]  "
                  f"[dim]{step['model']}[/]  {badge}")
    if step.get("detail"):
        console.print(f"  {step['detail']}", style="cyan", markup=False)
    if step.get("seen"):
        console.print(f"  🛈 {step['seen']}", style="dim", markup=False)
    if step.get("req"):
        console.print("  REQUEST →", style="dim")
        for line in step["req"].splitlines():
            console.print(f"    {line}", style="dim", markup=False)
        console.print("  ← RESPONSE", style="dim")
        for line in (step.get("resp") or "").splitlines():
            console.print(f"    {line}", markup=False)


def _print_live_flow(console: Console, settings, scenario) -> None:
    """Run the real pipeline (naive + P-LLM + Q-LLM + guard) and show model logs."""
    console.rule(f"[bold]Flujo en vivo · logs de modelo · provider: {settings.llm_provider}")
    sc = {"request": scenario.request, "inbox_text": scenario.inbox_text,
          "trusted_recipient": scenario.trusted_recipient}
    tool, arg = (("share_doc", "recipient") if scenario.name == "pdf"
                 else ("send_email", "to"))
    try:
        steps = [live_naive(settings, sc), live_plan(settings, sc)]
        ext_step, extracted = live_extract(settings, sc)
        steps += [ext_step, live_guard(extracted, tool=tool, arg=arg)]
    except (ChatError, ValueError) as exc:
        console.print(f"[red][error][/] {exc} — revisa el proveedor / API key.")
        return
    for step in steps:
        _print_logs(console, step)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ikarus")
    parser.add_argument("--scene", choices=["1", "2", "3", "all"], default="all")
    parser.add_argument("--scenario", choices=default_scenarios().names(), default="email")
    parser.add_argument("--mock", action="store_true", default=True)
    parser.add_argument("--live", dest="mock", action="store_false")
    args = parser.parse_args(argv)

    console = Console()
    mode = "mock (offline, determinista)" if args.mock else "en vivo (modelos reales)"
    console.rule("[bold]IKARUS · contención de prompt injection por diseño")
    console.print(f"escenario: [bold]{args.scenario}[/]  ·  modo: [bold]{mode}[/]\n")

    scenes = [1, 2, 3] if args.scene == "all" else [int(args.scene)]
    blocked_any = hijacked_any = False
    for sc in scenes:
        out = run_scene(sc, args.scenario, mock=args.mock)
        console.print(f"[bold]━━ Escena {sc} ·[/] [dim]{SCENE_SUBTITLE[sc]}[/]")
        if sc == 3:
            hijacked = out.get("hijacked", False)
            hijacked_any = hijacked_any or hijacked
            tag = ("HIJACKED · exfiltró a un tercero" if hijacked else "SAFE")
            style = "bold red" if hijacked else "bold green"
            console.print(Panel(f"Agente ingenuo → envía a {out.get('naive_recipient')}\n{tag}",
                                style=style, expand=False))
        else:
            print(out["text"])  # rich-rendered Taint Ledger + verdict (already styled)
            blocked_any = blocked_any or out["blocked"]
            if not args.mock and out["used_fallback"]:
                console.print("[dim][note] P-LLM no disponible/ inválido — plan canónico de respaldo.[/]")
        console.print()

    _print_live_flow(console, load_settings(), default_scenarios().create(args.scenario))

    if args.scene == "all":
        console.rule("[bold]Resumen")
        console.print("[green]Ikarus contuvo el ataque[/]: Escena 1 ALLOWED, Escena 2 BLOCKED "
                      "(guardia determinista, no detección).")
        verdict = "[red]HIJACKED — exfiltró[/]" if hijacked_any else "[green]SAFE[/]"
        console.print(f"Agente ingenuo (1 LLM, sin defensa): {verdict}.")
    return 0
