"""Application service: orchestrates the three demo scenes.

`IkarusApp` holds the constructed collaborators (interpreter, planner factory,
email sink, scenarios) and turns a (scene, scenario) request into a result dict.
It contains no wiring — that is the CompositionRoot's job (see composition.py) —
and no argument parsing — that is the CLI's job (see cli.py).
"""
from typing import Callable, Optional
from ikarus.interpreter import Interpreter
from ikarus.naive_agent import run as run_naive
from ikarus.p_llm import PrivilegedPlanner
from ikarus.scenarios import ScenarioRegistry
from ikarus.tui import TraceRenderer
from ikarus.tools.email_sink import EmailSink
from ikarus.tools.registry import ToolRegistry


class IkarusApp:
    def __init__(self, *, registry: ToolRegistry, interpreter: Interpreter,
                 email_sink: EmailSink, scenarios: ScenarioRegistry,
                 client_factory: Callable[[], object],
                 renderer: Optional[TraceRenderer] = None):
        self._registry = registry
        self._interpreter = interpreter
        self._email_sink = email_sink
        self._scenarios = scenarios
        self._client_factory = client_factory
        self._renderer = renderer or TraceRenderer()

    def run_scene(self, scene: int, scenario_name: str, mock: bool = True,
                  client=None) -> dict:
        scenario = self._scenarios.create(scenario_name)
        if scene == 3:
            res = run_naive(scenario.request, scenario.inbox_text,
                            scenario.trusted_recipient, mock=mock,
                            email_send=self._email_sink.send)
            text = (f"NAIVE AGENT sent to: {res.recipient}  "
                    f"(hijacked={res.hijacked})\n{res.sink_log}")
            return {"text": text, "blocked": False, "executed_sinks": [],
                    "used_fallback": False, "naive_recipient": res.recipient}
        plan, used_fallback = self._select_plan(scene, scenario, mock, client)
        result = self._interpreter.run(plan, scenario.request_values,
                                       scenario.inbox_text,
                                       q_mock_value=scenario.q_mock_value)
        return {"text": self._renderer.render(result), "blocked": result.blocked,
                "executed_sinks": result.executed_sinks,
                "used_fallback": used_fallback, "naive_recipient": None}

    def _select_plan(self, scene: int, scenario, mock: bool, client):
        """Scene 1: hybrid live wiring — the real P-LLM emits the plan in live mode.
        Scene 2: always the deliberately-subverted tainted plan (defense-in-depth)."""
        if scene == 2:
            return scenario.tainted_plan, False
        if mock:
            return scenario.canonical_plan, False
        planner = PrivilegedPlanner(self._registry,
                                    client=client or self._client_factory(),
                                    mock=False)
        res = planner.plan(scenario.request, scenario.canonical_plan,
                           request_fields=list(scenario.request_values))
        # A real model can emit a schema-valid but unexecutable plan; fall back to
        # the canonical plan rather than crash the interpreter (or fire a sink with
        # a half-resolved plan).
        if not res.used_fallback and self._interpreter.validate_plan(
                res.plan, scenario.request_values):
            return scenario.canonical_plan, True
        return res.plan, res.used_fallback
