from dataclasses import dataclass
from typing import Optional
from ikarus.labels import Tainted
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

def _resolve(arg: ArgRef, env: dict[str, Tainted], request_values: dict[str, Tainted]) -> Tainted:
    from ikarus.labels import trusted
    if arg.from_ == "literal":
        return trusted(arg.value, source="user_request")
    if arg.from_ == "request":
        if arg.ref is not None:
            return request_values[arg.ref]
        return trusted(arg.value, source="user_request")
    if arg.from_ == "step":
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
                _SINK_FUNCS[step.tool](**{k: v.value for k, v in args.items()})
                executed.append(step.tool)
            else:
                blocked = True
    return ExecutionResult(events, blocked, executed)
