from dataclasses import dataclass
from enum import Enum

class ToolKind(Enum):
    SOURCE = "SOURCE"
    SINK = "SINK"

@dataclass(frozen=True)
class ToolSpec:
    name: str
    kind: ToolKind
    sensitive_args: tuple[str, ...] = ()

class ToolRegistry:
    def __init__(self) -> None:
        self._specs: dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec) -> "ToolRegistry":
        self._specs[spec.name] = spec
        return self

    def get(self, name: str) -> ToolSpec:
        if name not in self._specs:
            raise KeyError(f"unknown tool: {name}")
        return self._specs[name]

    def is_sink(self, name: str) -> bool:
        return self.get(name).kind == ToolKind.SINK

    def all_specs(self) -> tuple[ToolSpec, ...]:
        return tuple(self._specs.values())

def default_registry() -> ToolRegistry:
    reg = ToolRegistry()
    reg.register(ToolSpec("read_inbox", ToolKind.SOURCE))
    reg.register(ToolSpec("read_pdf", ToolKind.SOURCE))
    reg.register(ToolSpec("send_email", ToolKind.SINK, sensitive_args=("to",)))
    reg.register(ToolSpec("share_doc", ToolKind.SINK, sensitive_args=("recipient",)))
    return reg
