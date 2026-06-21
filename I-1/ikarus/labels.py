from dataclasses import dataclass
from enum import Enum
from typing import Any

class Trust(Enum):
    TRUSTED = "TRUSTED"
    UNTRUSTED = "UNTRUSTED"

def combine_trust(labels: list[Trust]) -> Trust:
    """Taint law: UNTRUSTED dominates. Empty => TRUSTED."""
    return Trust.UNTRUSTED if any(l == Trust.UNTRUSTED for l in labels) else Trust.TRUSTED

@dataclass(frozen=True)
class Provenance:
    source: str
    trust: Trust

@dataclass(frozen=True)
class Tainted:
    value: Any
    provenance: Provenance

    def derive(self, new_value: Any, sources: list["Tainted"]) -> "Tainted":
        trust = combine_trust([s.provenance.trust for s in sources])
        srcs = "+".join(sorted({s.provenance.source for s in sources}))
        return Tainted(value=new_value, provenance=Provenance(source=srcs, trust=trust))

def trusted(value: Any, source: str = "user_request") -> Tainted:
    return Tainted(value=value, provenance=Provenance(source=source, trust=Trust.TRUSTED))

def untrusted(value: Any, source: str) -> Tainted:
    return Tainted(value=value, provenance=Provenance(source=source, trust=Trust.UNTRUSTED))
