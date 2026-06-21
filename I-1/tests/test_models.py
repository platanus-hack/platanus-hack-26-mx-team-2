from ikarus.models import is_reasoning_model, REASONING_MODEL_MARKERS


def test_reasoning_families_detected():
    assert is_reasoning_model("qwen/qwen3.5-9b")
    assert is_reasoning_model("deepseek/deepseek-r1-0528-qwen3-8b")


def test_non_reasoning_families_not_detected():
    assert not is_reasoning_model("google/gemma-3-12b")
    assert not is_reasoning_model("openai/gpt-oss-20b")


def test_vision_variant_is_not_a_reasoner():
    assert not is_reasoning_model("qwen/qwen3-vl-4b")


def test_markers_are_lowercase_substrings():
    assert all(m == m.lower() for m in REASONING_MODEL_MARKERS)
