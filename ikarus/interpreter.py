import inspect
from dataclasses import dataclass
from typing import Optional
from ikarus.labels import Tainted, trusted
from ikarus.schemas import Plan, ArgRef
from ikarus.policy import check, Decision
from ikarus.tools.registry import ToolRegistry
from ikarus.tools.sources import read_inbox
from ikarus.tools.sinks import send_email, share_doc
from ikarus.q_llm import extract

_SINK_FUNCS = {"send_email": send_email, "share_doc": share_doc}

@dataclass(frozen=True)
class TraceEvent:
    step_id: str
    kind: str
    detail: str
    decision: Optional[Decision] = None
    tainted: Optional[Tainted] = None

@dataclass(frozen=True)
class ExecutionResult:
    events: list[TraceEvent]
    blocked: bool
    executed_sinks: list[str]

def validate_plan(plan: Plan, registry: ToolRegistry,
                  request_values: dict[str, Tainted]) -> list[str]:
    """Statically check a plan against the interpreter's execution invariants.

    Real LLMs can emit structurally-valid (schema-passing) plans that are not
    executable — referencing a step that doesn't exist, a missing request value,
    or an unregistered sink. Returns a list of human-readable errors (empty when
    the plan is safe to run), so callers can fall back before executing — and
    before any sink fires.
    """
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
            if step.tool not in _SINK_FUNCS:
                errors.append(f"step '{step.id}' uses unknown sink tool '{step.tool}'")
            else:
                # The sink is called as fn(**args); flag missing-required or
                # unexpected args that would raise TypeError at execution.
                params = inspect.signature(_SINK_FUNCS[step.tool]).parameters
                required = {n for n, p in params.items()
                            if p.default is inspect.Parameter.empty}
                provided = set(step.args)
                for missing in sorted(required - provided):
                    errors.append(f"step '{step.id}' sink '{step.tool}' "
                                  f"missing required arg '{missing}'")
                for extra in sorted(provided - set(params)):
                    errors.append(f"step '{step.id}' sink '{step.tool}' "
                                  f"has unexpected arg '{extra}'")
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
        seen.add(step.id)
    return errors

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

def run(plan: Plan, request_values: dict[str, Tainted], inbox_text: str,
        registry: ToolRegistry, mock: bool = True, q_mock_value: str = "") -> ExecutionResult:
    env: dict[str, Tainted] = {}
    events: list[TraceEvent] = []
    executed: list[str] = []
    blocked = False
    for step in plan.steps:
        if step.kind == "source":
            t = read_inbox(inbox_text)
            env[step.id] = t
            events.append(TraceEvent(step.id, "source", f"read {step.tool}", tainted=t))
        elif step.kind == "extract":
            # Hybrid decision: Q-LLM extraction is always deterministic mock,
            # even in --live. Only the P-LLM planner runs live (see Task 13 / HONESTY.md).
            # The taint guarantee holds either way: q_llm.extract returns UNTRUSTED.
            t = extract(env[step.input_ref].value, step.query or "",
                        mock=True, mock_value=q_mock_value)
            env[step.id] = t
            events.append(TraceEvent(step.id, "extract", f"Q-LLM: {step.query}", tainted=t))
        elif step.kind == "sink":
            args = {k: _resolve(v, env, request_values) for k, v in step.args.items()}
            decision = check(step.tool, args, registry)
            events.append(TraceEvent(step.id, "sink", f"policy on {step.tool}",
                                     decision=decision))
            if decision.allowed:
                if step.tool not in _SINK_FUNCS:
                    raise ValueError(f"no sink function registered for tool '{step.tool}'")
                _SINK_FUNCS[step.tool](**{k: v.value for k, v in args.items()})
                executed.append(step.tool)
            else:
                blocked = True
    return ExecutionResult(events, blocked, executed)
