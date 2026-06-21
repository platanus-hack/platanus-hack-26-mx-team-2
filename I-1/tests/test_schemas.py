import pytest
from pydantic import ValidationError
from ikarus.schemas import ArgRef, PlanStep, Plan, Extraction

def test_argref_alias_from():
    a = ArgRef(**{"from": "literal", "value": "bob@corp.com"})
    assert a.from_ == "literal"
    assert a.value == "bob@corp.com"

def test_plan_roundtrip():
    plan = Plan(steps=[
        PlanStep(id="s1", kind="source", tool="read_inbox", args={}),
        PlanStep(id="s2", kind="sink", tool="send_email",
                 args={"to": ArgRef(**{"from": "request", "value": "bob@corp.com"})}),
    ])
    assert plan.steps[1].tool == "send_email"

def test_invalid_kind_rejected():
    with pytest.raises(ValidationError):
        PlanStep(id="s1", kind="explode", args={})

def test_extraction_schema_has_fields():
    schema = Extraction.model_json_schema()
    assert "found" in schema["properties"]
    assert "value" in schema["properties"]
