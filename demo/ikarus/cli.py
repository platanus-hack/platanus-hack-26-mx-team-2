import argparse
import os
import urllib.request
from rich.console import Console
from ikarus.scenarios import default_scenarios
from ikarus.composition import CompositionRoot
from ikarus.config import load_settings
from ikarus.chat_provider import ChatError
from ikarus.tools.email_sink import make_email_sink
from ikarus.web.live_flow import live_extract, live_guard, live_naive, live_plan


def _lmstudio_reachable(settings) -> bool:
    base = settings.base_url.rstrip("/")
    try:
        req = urllib.request.Request(base + "/models", headers={"User-Agent": "ikarus/0.1"})
        with urllib.request.urlopen(req, timeout=2) as resp:  # noqa: S310 (local URL)
            return 200 <= resp.status < 300
    except Exception:
        return False


def _ensure_live_provider(console: Console) -> bool:
    """--live must use a REAL model. Honor an explicit provider (env/.env); else
    autodetect a running LM Studio. If none is available, abort with a clear
    message instead of silently falling back to the mock. Returns False to abort."""
    settings = load_settings()
    if settings.llm_provider != "mock":
        return True  # user configured openai/claude/lmstudio explicitly
    if _lmstudio_reachable(settings):
        os.environ["IKARUS_LLM_PROVIDER"] = "lmstudio"  # picked up by load_settings()
        console.print("[dim]proveedor autodetectado: LM Studio[/]")
        return True
    console.print("[bold red]--live necesita un modelo real conectado.[/] Inicia LM Studio "
                  "en http://localhost:1234, o define IKARUS_LLM_PROVIDER=openai|claude "
                  "y su API key (en un .env).")
    return False

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


def _print_live_flow(console: Console, settings, scenario):
    """Run the real pipeline (naive + P-LLM + Q-LLM + guard) and show model logs.

    Returns the naive agent's hijack outcome (True/False), or None on error — used
    for the summary. The naive agent is shown HERE (one real source) so it never
    contradicts a separate heuristic panel."""
    console.rule(f"[bold]Flujo en vivo · logs de modelo · provider: {settings.llm_provider}")
    sc = {"request": scenario.request, "inbox_text": scenario.inbox_text,
          "trusted_recipient": scenario.trusted_recipient,
          "attacker_address": scenario.attacker_address}
    tool, arg = (("share_doc", "recipient") if scenario.name == "pdf"
                 else ("send_email", "to"))
    try:
        naive = live_naive(settings, sc)
        steps = [naive, live_plan(settings, sc)]
        ext_step, extracted = live_extract(settings, sc)
        steps += [ext_step, live_guard(extracted, tool=tool, arg=arg)]
    except (ChatError, ValueError) as exc:
        console.print(f"[red][error][/] {exc} — revisa el proveedor / API key.")
        return None
    for step in steps:
        _print_logs(console, step)
    return naive.get("decision") == "EXFIL"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ikarus")
    parser.add_argument("--scene", choices=["1", "2", "3", "all"], default="all")
    parser.add_argument("--scenario", choices=default_scenarios().names(), default="email")
    parser.add_argument("--mock", action="store_true", default=True)
    parser.add_argument("--live", dest="mock", action="store_false")
    args = parser.parse_args(argv)

    console = Console()
    if not args.mock and not _ensure_live_provider(console):
        return 1
    mode = ("mock (offline, determinista)" if args.mock
            else f"en vivo · provider: {load_settings().llm_provider}")
    console.rule("[bold]IKARUS · contención de prompt injection por diseño")
    console.print(f"escenario: [bold]{args.scenario}[/]  ·  modo: [bold]{mode}[/]\n")

    # Scenes 1-2 are the Ikarus structured proof (taint ledger). Scene 3 (the naive
    # agent) is shown once, with real model logs, in the live-flow section below — so
    # there is a single source of truth and no heuristic-vs-model contradiction.
    scenes = [1, 2, 3] if args.scene == "all" else [int(args.scene)]
    for sc in scenes:
        if sc == 3:
            continue
        out = run_scene(sc, args.scenario, mock=args.mock)
        console.print(f"[bold]━━ Escena {sc} ·[/] [dim]{SCENE_SUBTITLE[sc]}[/]")
        print(out["text"])  # rich-rendered Taint Ledger + verdict (already styled)
        if not args.mock and out["used_fallback"]:
            console.print("[dim][note] P-LLM no disponible/inválido — plan canónico de respaldo.[/]")
        console.print()

    scenario = default_scenarios().create(args.scenario)
    hijacked = _print_live_flow(console, load_settings(), scenario)

    if args.scene == "all":
        console.rule("[bold]Resumen")
        console.print("[green]Ikarus contuvo el ataque[/]: Escena 1 ALLOWED, Escena 2 BLOCKED "
                      "(guardia determinista, no detección).")
        if hijacked is True:
            console.print("Agente ingenuo (1 LLM, sin defensa): [red]HIJACKED — exfiltró al atacante[/].")
        elif hijacked is False:
            console.print("Agente ingenuo (1 LLM): el modelo no exfiltró esta vez — "
                          "[dim]no confíes en eso; Ikarus bloquea por construcción[/].")
    return 0
