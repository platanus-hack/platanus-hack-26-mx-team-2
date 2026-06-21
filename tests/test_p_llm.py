from ikarus.p_llm import plan, build_catalog, PlanResult
from ikarus.schemas import Plan, PlanStep, ArgRef
from ikarus.tools.registry import default_registry


def _canonical():
    return Plan(
        steps=[
            PlanStep(
                id="s1",
                kind="sink",
                tool="send_email",
                args={"to": ArgRef(**{"from": "request", "value": "bob@corp.com"})},
            )
        ]
    )


def test_mock_uses_canonical_with_fallback_flag():
    res = plan("Reply to Bob", catalog=[], canonical=_canonical(), mock=True)
    assert isinstance(res, PlanResult)
    assert res.used_fallback is True
    assert res.plan.steps[0].tool == "send_email"


def test_live_valid_plan_used(monkeypatch):
    valid = {
        "steps": [
            {
                "id": "s1",
                "kind": "sink",
                "tool": "send_email",
                "args": {"to": {"from": "request", "value": "bob@corp.com"}},
            }
        ]
    }

    class FakeClient:
        def structured(self, *a, **k):
            return valid

    res = plan("Reply to Bob", catalog=[], canonical=_canonical(), client=FakeClient())
    assert res.used_fallback is False


def test_invalid_plan_falls_back():
    class FakeClient:
        def structured(self, *a, **k):
            return {"steps": [{"id": "s1", "kind": "explode"}]}

    res = plan("x", catalog=[], canonical=_canonical(), client=FakeClient())
    assert res.used_fallback is True


def test_build_catalog_excludes_data():
    cat = build_catalog(default_registry())
    names = {c["name"] for c in cat}
    assert "send_email" in names and "read_inbox" in names
    assert all("value" not in c for c in cat)
