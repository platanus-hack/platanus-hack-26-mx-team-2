from dataclasses import dataclass
from ikarus.labels import Tainted, Trust
from ikarus.tools.registry import ToolRegistry


@dataclass(frozen=True)
class Decision:
    allowed: bool
    reason: str


def check(tool: str, args: dict[str, Tainted], registry: ToolRegistry) -> Decision:
    """Wired policy: a sink's sensitive args must be TRUSTED, else BLOCK.

    This is a hard-wired policy, not a general capability language (see HONESTY.md).
    """
    spec = registry.get(tool)
    for arg_name in spec.sensitive_args:
        tainted = args.get(arg_name)
        if tainted is None:
            return Decision(False, f"missing sensitive arg '{arg_name}' for {tool}")
        if tainted.provenance.trust == Trust.UNTRUSTED:
            return Decision(
                False,
                f"BLOCKED: sensitive arg '{arg_name}' of {tool} is UNTRUSTED "
                f"(provenance: {tainted.provenance.source})",
            )
    return Decision(True, f"allowed: {tool} sensitive args are TRUSTED")


def propagate_control_flow_taint(*_args, **_kwargs):
    """STUB (B3): real CaMeL taints values that branch on untrusted data.

    Ikarus does data-flow taint only. This is exactly where control-flow taint
    propagation would hook in. Documented as a known simplification in HONESTY.md.
    """
    raise NotImplementedError("control-flow taint not implemented (see HONESTY.md)")
