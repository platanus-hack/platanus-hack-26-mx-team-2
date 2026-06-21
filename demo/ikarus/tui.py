import io
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from ikarus.interpreter import ExecutionResult
from ikarus.labels import Trust


class TraceRenderer:
    """Renders an ExecutionResult into a rich 'Taint Ledger' + verdict panel.

    A class (not a bare function) so the app can inject it and presentation stays
    a swappable collaborator. Records to an in-memory console and returns the
    text — the CLI prints it (printing here would double-render each scene).
    """

    def __init__(self, width: int = 100):
        self._width = width

    def verdict_line(self, result: ExecutionResult) -> str:
        return "BLOCKED" if result.blocked else "ALLOWED"

    def render(self, result: ExecutionResult) -> str:
        console = Console(record=True, width=self._width, file=io.StringIO())
        table = Table(title="Ikarus — Taint Ledger")
        for col in ("Step", "Kind", "Detail", "Trust", "Policy"):
            table.add_column(col)
        for e in result.events:
            trust = ""
            if e.tainted is not None:
                t = e.tainted.provenance.trust
                color = "green" if t == Trust.TRUSTED else "red"
                trust = f"[{color}]{t.value}[/{color}]"
            policy = ""
            if e.decision is not None:
                policy = ("[green]PASS[/green]" if e.decision.allowed
                          else f"[red]BLOCK[/red] {e.decision.reason}")
            table.add_row(e.step_id, e.kind, e.detail, trust, policy)
        console.print(table)
        verdict = self.verdict_line(result)
        if result.blocked:
            mark, style = "✗", "bold red"
        else:
            mark, style = "✓", "bold green"
        # Fitted panel (expand=False) so the verdict reads as a tight badge, not a
        # full-width box that dwarfs the one line inside it.
        console.print(Panel(f"{mark} VERDICT: {verdict}", style=style, expand=False))
        return console.export_text()


_DEFAULT_RENDERER = TraceRenderer()


def verdict_line(result: ExecutionResult) -> str:
    """Backward-compatible wrapper around the default TraceRenderer."""
    return _DEFAULT_RENDERER.verdict_line(result)


def render_trace(result: ExecutionResult) -> str:
    """Backward-compatible wrapper around the default TraceRenderer."""
    return _DEFAULT_RENDERER.render(result)
