"""Model-family heuristics.

Knowing which local model is a 'reasoner' (emits its answer in a thinking
channel and needs a larger token budget) is a concern separate from loading
environment config — so it lives here, not in config.py.
"""

# Substrings (matched case-insensitively against the model id) that mark a model
# as a reasoner. Override the budget via IKARUS_REASONING_MAX_TOKENS if needed.
REASONING_MODEL_MARKERS = (
    "qwen3", "deepseek-r1", "-r1", "qwq", "magistral", "hermes-4",
    "reasoner", "thinking",
)


def is_reasoning_model(model: str) -> bool:
    """Heuristic: does this model id belong to a reasoning ('thinking') family?"""
    m = model.lower()
    if "-vl" in m:  # vision-language variants (e.g. qwen3-vl) are not reasoners
        return False
    return any(marker in m for marker in REASONING_MODEL_MARKERS)
