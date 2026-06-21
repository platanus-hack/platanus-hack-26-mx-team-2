from dataclasses import dataclass
from typing import Mapping, Protocol, runtime_checkable
from ikarus.labels import Tainted, Trust
from ikarus.tools.registry import ToolRegistry


@dataclass(frozen=True)
class Decision:
    allowed: bool
    reason: str


@runtime_checkable
class SecurityPolicy(Protocol):
    """A strategy that decides whether a sink call is allowed."""

    def evaluate(self, tool: str, args: Mapping[str, Tainted],
                 registry: ToolRegistry) -> Decision: ...


class DenyUntrustedArgsPolicy:
    """Deny-by-default: a sink is blocked if ANY of its arguments is UNTRUSTED.

    This protects content (e.g. an email body / shared doc) just like the
    recipient — not only a hand-picked 'sensitive' subset — so untrusted data
    cannot be exfiltrated through an unguarded argument. Containment, not
    detection: decided deterministically, regardless of the value.
    """

    def evaluate(self, tool: str, args: Mapping[str, Tainted],
                 registry: ToolRegistry) -> Decision:
        registry.get(tool)  # raises KeyError for unknown tools (caller guards)
        for name, tainted in args.items():
            if tainted is None:
                return Decision(False, f"missing arg '{name}' for {tool}")
            if tainted.provenance.trust == Trust.UNTRUSTED:
                return Decision(
                    False,
                    f"BLOCKED: sensitive arg '{name}' of {tool} is UNTRUSTED "
                    f"(provenance: {tainted.provenance.source})",
                )
        return Decision(True, f"allowed: all args of {tool} are TRUSTED")


_DEFAULT_POLICY = DenyUntrustedArgsPolicy()


def check(tool: str, args: Mapping[str, Tainted], registry: ToolRegistry) -> Decision:
    """Backward-compatible entry point using the default deny-by-default policy."""
    return _DEFAULT_POLICY.evaluate(tool, args, registry)


def propagate_control_flow_taint(*_args, **_kwargs):
    """STUB (B3): real CaMeL taints values that branch on untrusted data.

    Ikarus does data-flow taint only. This is exactly where control-flow taint
    propagation would hook in. Documented as a known simplification in HONESTY.md.
    """
    raise NotImplementedError("control-flow taint not implemented (see HONESTY.md)")
