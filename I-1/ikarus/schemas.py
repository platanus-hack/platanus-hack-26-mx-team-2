from typing import Literal, Optional
from pydantic import BaseModel, Field

class ArgRef(BaseModel):
    from_: Literal["literal", "step", "request"] = Field(alias="from")
    value: Optional[str] = None
    ref: Optional[str] = None
    model_config = {"populate_by_name": True}

class PlanStep(BaseModel):
    id: str
    kind: Literal["source", "extract", "sink"]
    tool: Optional[str] = None
    query: Optional[str] = None
    input_ref: Optional[str] = None
    args: dict[str, ArgRef] = {}

class Plan(BaseModel):
    steps: list[PlanStep]

class Extraction(BaseModel):
    found: bool
    value: str
