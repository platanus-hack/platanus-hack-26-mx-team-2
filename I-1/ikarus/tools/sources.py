"""Untrusted-data sources.

A `Source` reads external content and labels it UNTRUSTED by construction, so no
source can ever hand the interpreter trusted data. Concrete sources are selected
by the plan's `step.tool`, so adding a source needs no interpreter change (OCP).
"""
from typing import Protocol, runtime_checkable
from ikarus.labels import Tainted, untrusted


@runtime_checkable
class Source(Protocol):
    name: str

    def read(self, raw: str) -> Tainted: ...


class InboxSource:
    name = "read_inbox"

    def read(self, raw: str) -> Tainted:
        return untrusted(raw, source="inbox")


class PdfSource:
    name = "read_pdf"

    def read(self, raw: str) -> Tainted:
        return untrusted(raw, source="pdf")


def default_sources() -> dict[str, Source]:
    return {s.name: s for s in (InboxSource(), PdfSource())}
