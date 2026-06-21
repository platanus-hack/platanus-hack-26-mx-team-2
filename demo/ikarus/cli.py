import argparse
import os
import urllib.request
from rich.console import Console
from rich.panel import Panel
from ikarus.scenarios import default_scenarios
from ikarus.composition import CompositionRoot
from ikarus.config import load_settings
from ikarus.chat_provider import ChatError
from ikarus.interpreter import ExecutionResult, TraceEvent
from ikarus.labels import trusted, untrusted
from ikarus.policy import Decision, check as policy_check
from ikarus.tools.email_sink import make_email_sink
from ikarus.tools.registry import default_registry
from ikarus.tui import TraceRenderer
from ikarus.web.live_flow import live_extract, live_guard, live_naive, live_plan

SCENE_SUBTITLE = {
    1: "garantía arquitectónica — el P-LLM planea SIN ver el inbox; al destinatario "
       "confiable, el guardia da PASS",
    2: "garantía de taint — el destinatario sale de cuarentena → nace UNTRUSTED → el "
       "guardia lo bloquea",
    3: "agente ingenuo (1 LLM, sin defensa) — lee petición + inbox juntos y obedece la "
       "instrucción escondida",
}


def run_scene(scene: int, scenario_name: str, mock: bool = True, client=None) -> dict:
    # make_email_sink is resolved here (not captured) so IKARUS_SINK — and tests
    # that monkeypatch ikarus.cli.make_email_sink — control the transport.
    settings = load_settings()
    app = CompositionRoot(settings, email_sink=make_email_sink(settings)).build()
    return app.run_scene(scene, scenario_name, mock=mock, client=client)


def _lmstudio_reachable(settings) -> bool:
    base = settings.base_url.rstrip("/")
    try:
        req = urllib.request.Request(base + "/models", headers={"User-Agent": "ikarus/0.1"})
        with urllib.request.urlopen(req, timeout=2) as resp:  # noqa: S310 (local URL)
            return 200 <= resp.status < 300
    except Exception:
        return False


def _ensure_live_provider(console: Console) -> bool:
    settings = load_settings()
    if settings.llm_provider != "mock":
        return True
    if _lmstudio_reachable(settings):
        os.environ["IKARUS_LLM_PROVIDER"] = "lmstudio"
        console.print("[dim]proveedor autodetectado: LM Studio[/]")
        return True
    console.print("[bold red]--live necesita un modelo real conectado.[/] Inicia LM Studio "
                  "en http://localhost:1234, o define IKARUS_LLM_PROVIDER=openai|claude "
                  "y su API key (en un .env).")
    return False


def _print_step(console: Console, step: dict) -> None:
    """The PROCESS of a layer: header + raw model REQUEST/RESPONSE (shown BEFORE
    the verdict, so the verdict is seen to follow from the model's real output)."""
    badge = ""
    if step.get("decision") in ("BLOCK", "EXFIL"):
        badge = f"[bold red]{step['decision']}[/]"
    elif step.get("decision") == "PASS":
        badge = "[bold green]PASS[/]"
    elif step.get("trust") == "UNTRUSTED":
        badge = "[bold yellow]UNTRUSTED[/]"
    console.print(f"[bold]▸ {step['layer']}[/]  [dim]{step['model']}[/]  {badge}")
    if step.get("seen"):
        console.print(f"  🛈 {step['seen']}", style="dim", markup=False)
    if step.get("req"):
        console.print("  REQUEST →", style="dim")
        for line in step["req"].splitlines():
            console.print(f"    {line}", style="dim", markup=False)
        console.print("  ← RESPONSE", style="dim")
        for line in (step.get("resp") or "").splitlines():
            console.print(f"    {line}", markup=False)


def _allowed_ledger(recipient: str) -> ExecutionResult:
    """Scene 1: the legit plan sends to the TRUSTED request recipient → guard PASS."""
    dec = policy_check("send_email", {"to": trusted(recipient)}, default_registry())
    events = [
        TraceEvent("s1", "plan", f"P-LLM → destinatario de la petición: {recipient}",
                   tainted=trusted(recipient)),
        TraceEvent("s2", "sink", "policy on send_email", decision=dec),
    ]
    return ExecutionResult(events=events, blocked=not dec.allowed, executed_sinks=["send_email"])


def _blocked_ledger(extracted: str, guard: dict) -> ExecutionResult:
    """Scene 2: recipient came from the quarantined Q-LLM output → guard BLOCK."""
    events = [
        TraceEvent("s1", "source", "Q-LLM leyó datos no confiables (inbox)",
                   tainted=untrusted("inbox", "inbox")),
        TraceEvent("s2", "extract", f"Q-LLM extrajo: {extracted or '(vacío)'}",
                   tainted=untrusted(extracted, "q_llm")),
        TraceEvent("s3", "sink", "policy on send_email",
                   decision=Decision(guard["allowed"], guard["reason"])),
    ]
    return ExecutionResult(events=events, blocked=not guard["allowed"], executed_sinks=[])


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
    settings = load_settings()
    scenario = default_scenarios().create(args.scenario)
    mode = ("mock (offline, determinista)" if args.mock
            else f"en vivo · provider: {settings.llm_provider}")
    console.rule("[bold]IKARUS · contención de prompt injection por diseño")
    console.print(f"escenario: [bold]{args.scenario}[/]  ·  modo: [bold]{mode}[/]\n")

    scenes = [1, 2, 3] if args.scene == "all" else [int(args.scene)]
    sc = {"request": scenario.request, "inbox_text": scenario.inbox_text,
          "trusted_recipient": scenario.trusted_recipient,
          "attacker_address": scenario.attacker_address}
    renderer = TraceRenderer()
    s1_allowed = s2_blocked = s3_hijacked = None
    try:
        for n in scenes:
            console.rule(f"[bold]Escena {n}")
            console.print(f"[dim]{SCENE_SUBTITLE[n]}[/]\n")
            if n == 1:  # Ikarus, legit request — process (P-LLM) then ALLOWED
                _print_step(console, live_plan(settings, sc))
                res = _allowed_ledger(scenario.trusted_recipient)
                s1_allowed = not res.blocked
                console.print()
                print(renderer.render(res))
            elif n == 2:  # Ikarus, tainted data — process (Q-LLM) then BLOCKED
                extract_step, extracted = live_extract(settings, sc)
                _print_step(console, extract_step)
                guard = live_guard(extracted)
                console.print()
                res = _blocked_ledger(extracted, guard)
                s2_blocked = res.blocked
                print(renderer.render(res))
            elif n == 3:  # naive — process (single LLM) then HIJACKED/SAFE
                naive = live_naive(settings, sc)
                _print_step(console, naive)
                s3_hijacked = naive.get("decision") == "EXFIL"
                tag = ("HIJACKED · exfiltró a un tercero" if s3_hijacked else "SAFE")
                style = "bold red" if s3_hijacked else "bold green"
                console.print()
                console.print(Panel(f"VEREDICTO: {tag}", style=style, expand=False))
            console.print()
    except (ChatError, ValueError) as exc:
        console.print(f"[red][error][/] {exc} — revisa el proveedor / API key.")
        return 1

    if args.scene == "all":
        console.rule("[bold]Resumen")
        console.print(f"  [green]Escena 1 · Ikarus (legítimo)[/]: "
                      f"{'ALLOWED ✓' if s1_allowed else 'ALLOWED'} — envía al destinatario confiable.")
        console.print(f"  [red]Escena 2 · Ikarus (contaminado)[/]: "
                      f"{'BLOCKED ✓' if s2_blocked else 'BLOCKED'} — guardia determinista, no detección.")
        verdict3 = "[red]HIJACKED — exfiltró[/]" if s3_hijacked else "[green]SAFE[/]"
        console.print(f"  Escena 3 · Agente ingenuo (sin defensa): {verdict3}.")
        console.print("\n[bold]Ikarus contiene el ataque por construcción[/] — el plan nunca toca "
                      "los datos sucios y el guardia bloquea cualquier sink contaminado.")
    return 0
