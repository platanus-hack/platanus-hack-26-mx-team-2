"""Composition root: the single place that wires the Ikarus object graph.

It depends on everything; nothing depends on it. The email sink is injected (the
CLI owns the IKARUS_SINK choice via make_email_sink) so the wiring here stays
free of policy decisions and easy to test with a spy sink.
"""
from typing import Callable, Optional
from ikarus.app import IkarusApp
from ikarus.config import Settings
from ikarus.interpreter import Interpreter
from ikarus.llm_client import LLMClient
from ikarus.scenarios import SCENARIOS
from ikarus.tools.email_sink import EmailSink
from ikarus.tools.registry import ToolRegistry, default_registry
from ikarus.tools.sinks import share_doc


class CompositionRoot:
    def __init__(self, settings: Settings, *, email_sink: EmailSink,
                 registry: Optional[ToolRegistry] = None,
                 scenarios: dict = SCENARIOS,
                 client_factory: Optional[Callable[[], object]] = None):
        self._settings = settings
        self._email_sink = email_sink
        self._registry = registry or default_registry()
        self._scenarios = scenarios
        self._client_factory = client_factory or (lambda: LLMClient(settings))

    def build(self) -> IkarusApp:
        # The email sink is mock by default; with IKARUS_SINK=resend it sends real
        # mail (allowlist-gated). share_doc stays mock — no real document sharing.
        sinks = {"send_email": self._email_sink.send, "share_doc": share_doc}
        interpreter = Interpreter(self._registry, sinks=sinks)
        return IkarusApp(registry=self._registry, interpreter=interpreter,
                         email_sink=self._email_sink, scenarios=self._scenarios,
                         client_factory=self._client_factory)
