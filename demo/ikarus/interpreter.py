import inspect
from dataclasses import dataclass
from typing import Callable, Optional
from ikarus.labels import Tainted, trusted
from ikarus.schemas import Plan, ArgRef
from ikarus.policy import Decision, SecurityPolicy, DenyUntrustedArgsPolicy
from ikarus.tools.registry import ToolRegistry
from ikarus.tools.sources import Source, default_sources
from ikarus.tools.sinks import send_email, share_doc
from ikarus.tools.email_sink import SinkError
from ikarus.q_llm import extract

_SINK_FUNCS = {"send_email": send_email, "share_doc": share_doc}

# Default extractor (hybrid): Q-LLM extraction is always deterministic mock, even
# in --live (see HONESTY.md). The taint guarantee holds: output is born UNTRUSTED.
Extractor = Callable[[str, str, str], Tainted]

def _default_extractor(value: str, query: str, mock_value: str) -> Tainted:
    return extract(value, query, mock=True, mock_value=mock_value)

@dataclass(frozen=True)
class TraceEvent:
    step_id: str
    kind: str
    detail: str
    decision: Optional[Decision] = None
    tainted: Optional[Tainted] = None

@dataclass(frozen=True)
class ExecutionResult:
    events: tuple[TraceEvent, ...]
    blocked: bool
    executed_sinks: tuple[str, ...]

def _resolve(arg: ArgRef, env: dict[str, Tainted], request_values: dict[str, Tainted]) -> Tainted:
    if arg.from_ == "literal":
        return trusted(arg.value, source="user_request")
    if arg.from_ == "request":
        if arg.ref is not None:
            if arg.ref not in request_values:
                raise ValueError(f"plan references unknown request value '{arg.ref}'")
            return request_values[arg.ref]
        return trusted(arg.value, source="user_request")
    if arg.from_ == "step":
        if arg.ref not in env:
            raise ValueError(f"plan references unknown/not-yet-run step '{arg.ref}'")
        return env[arg.ref]
    raise ValueError(f"bad ArgRef source: {arg.from_}")


class Interpreter:
    """Deterministic guard: runs a linear plan, propagates provenance (taint)
    across values, and consults an injected SecurityPolicy before every sink.

    Collaborators are injected so the guard's behavior is composed, not hardwired:
    the policy (strategy), the sink transports, the sources, and the quarantine
    extractor are all swappable. It is NOT an LLM — words don't change its mind.
    """

    def __init__(self, registry: ToolRegistry, *,
                 policy: Optional[SecurityPolicy] = None,
                 sinks: Optional[dict] = None,
                 sources: Optional[dict[str, Source]] = None,
                 extractor: Optional[Extractor] = None):
        self.registry = registry
        self.policy = policy or DenyUntrustedArgsPolicy()
        self._sinks = sinks or _SINK_FUNCS
        self._sources = sources or default_sources()
        self._extractor = extractor or _default_extractor

    def validate_plan(self, plan: Plan, request_values: dict[str, Tainted]) -> list[str]:
        """Statically check a plan against the interpreter's execution invariants.

        Real LLMs can emit structurally-valid (schema-passing) plans that are not
        executable — referencing a step that doesn't exist, a missing request
        value, or an unregistered sink. Returns a list of human-readable errors
        (empty when the plan is safe to run), so callers can fall back before
        executing — and before any sink fires.
        """
        funcs = self._sinks
        errors: list[str] = []
        seen: set[str] = set()
        for step in plan.steps:
            if not step.id:
                errors.append("step has empty id")
            elif step.id in seen:
                errors.append(f"duplicate step id '{step.id}'")
            if step.kind in ("source", "sink") and not step.tool:
                errors.append(f"step '{step.id}' ({step.kind}) is missing a tool")
            if step.kind == "extract" and step.input_ref not in seen:
                errors.append(f"extract step '{step.id}' input_ref '{step.input_ref}' "
                              "is not an earlier step")
            if step.kind == "sink" and step.tool:
                if step.tool not in funcs:
                    errors.append(f"step '{step.id}' uses unknown sink tool '{step.tool}'")
                else:
                    # The sink is called as fn(**args); flag missing-required or
                    # unexpected args that would raise TypeError at execution.
                    params = inspect.signature(funcs[step.tool]).parameters
                    required = {n for n, p in params.items()
                                if p.default is inspect.Parameter.empty}
                    provided = set(step.args)
                    for missing in sorted(required - provided):
                        errors.append(f"step '{step.id}' sink '{step.tool}' "
                                      f"missing required arg '{missing}'")
                    for extra in sorted(provided - set(params)):
                        errors.append(f"step '{step.id}' sink '{step.tool}' "
                                      f"has unexpected arg '{extra}'")
                    # Recipient args must come from the request (by ref) or an
                    # extraction step — never a hardcoded literal/inline value,
                    # which would be born TRUSTED and bypass the taint gate.
                    # from="step" is allowed so the runtime policy can still block
                    # an untrusted one.
                    try:
                        recipient_args = self.registry.get(step.tool).sensitive_args
                    except KeyError:
                        recipient_args = ()
                    for rname in recipient_args:
                        rarg = step.args.get(rname)
                        if rarg is None:
                            continue
                        if rarg.from_ == "literal":
                            errors.append(f"step '{step.id}' recipient arg '{rname}' uses a "
                                          "literal value (must come from the request)")
                        elif rarg.from_ == "request" and rarg.ref is None:
                            errors.append(f"step '{step.id}' recipient arg '{rname}' uses an "
                                          "inline request value (must use a ref)")
            for name, arg in step.args.items():
                if arg.from_ == "step" and arg.ref not in seen:
                    errors.append(f"step '{step.id}' arg '{name}' references "
                                  f"unknown/forward step '{arg.ref}'")
                elif arg.from_ == "request" and arg.ref is not None \
                        and arg.ref not in request_values:
                    errors.append(f"step '{step.id}' arg '{name}' references "
                                  f"unknown request value '{arg.ref}'")
                elif arg.from_ == "literal" and arg.value is None:
                    errors.append(f"step '{step.id}' arg '{name}' is a literal with no value")
            # Only record real ids, so an empty id can't satisfy a later ref.
            if step.id:
                seen.add(step.id)
        return errors

    def run(self, plan: Plan, request_values: dict[str, Tainted], inbox_text: str,
            q_mock_value: str = "") -> ExecutionResult:
        env: dict[str, Tainted] = {}
        events: list[TraceEvent] = []
        executed: list[str] = []
        blocked = False
        for step in plan.steps:
            if step.kind == "source":
                source = self._sources.get(step.tool)
                if source is None:
                    raise ValueError(f"source step '{step.id}' uses unknown source "
                                     f"'{step.tool}'")
                t = source.read(inbox_text)
                env[step.id] = t
                events.append(TraceEvent(step.id, "source", f"read {step.tool}", tainted=t))
            elif step.kind == "extract":
                # Hybrid decision: Q-LLM extraction is always deterministic mock,
                # even in --live (see Task 13 / HONESTY.md). The taint guarantee
                # holds either way: the extractor returns UNTRUSTED.
                if step.input_ref not in env:
                    raise ValueError(f"extract step '{step.id}' references "
                                     f"unknown/not-yet-run step '{step.input_ref}'")
                t = self._extractor(env[step.input_ref].value, step.query or "", q_mock_value)
                env[step.id] = t
                events.append(TraceEvent(step.id, "extract", f"Q-LLM: {step.query}", tainted=t))
            elif step.kind == "sink":
                args = {k: _resolve(v, env, request_values) for k, v in step.args.items()}
                try:
                    decision = self.policy.evaluate(step.tool, args, self.registry)
                except KeyError as exc:
                    raise ValueError(f"sink step '{step.id}' uses unknown tool "
                                     f"'{step.tool}'") from exc
                events.append(TraceEvent(step.id, "sink", f"policy on {step.tool}",
                                         decision=decision))
                if decision.allowed:
                    if step.tool not in self._sinks:
                        raise ValueError(f"no sink function registered for tool '{step.tool}'")
                    try:
                        self._sinks[step.tool](**{k: v.value for k, v in args.items()})
                        executed.append(step.tool)
                    except SinkError as exc:
                        # Real sink refused (allowlist) or failed (network/API) —
                        # record it as a block instead of crashing the run.
                        blocked = True
                        events.append(TraceEvent(
                            step.id, "sink", f"real sink refused: {exc}",
                            decision=Decision(False, str(exc))))
                else:
                    blocked = True
        return ExecutionResult(tuple(events), blocked, tuple(executed))


def validate_plan(plan: Plan, registry: ToolRegistry,
                  request_values: dict[str, Tainted],
                  sinks: Optional[dict] = None) -> list[str]:
    """Backward-compatible wrapper around Interpreter.validate_plan."""
    return Interpreter(registry, sinks=sinks).validate_plan(plan, request_values)


def run(plan: Plan, request_values: dict[str, Tainted], inbox_text: str,
        registry: ToolRegistry, mock: bool = True, q_mock_value: str = "",
        sinks: Optional[dict] = None, sources: Optional[dict] = None) -> ExecutionResult:
    """Backward-compatible wrapper around Interpreter.run.

    `mock` is retained for call-site compatibility; the extractor is always the
    deterministic mock by design (see HONESTY.md), so it does not change behavior.
    """
    return Interpreter(registry, sinks=sinks, sources=sources).run(
        plan, request_values, inbox_text, q_mock_value=q_mock_value)
