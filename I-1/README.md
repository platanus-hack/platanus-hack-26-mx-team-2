# Ikarus

Local demo that contains indirect prompt injection **by design** — approximating
DeepMind's CaMeL. Three layers: a planner that sees only the trusted request, a
quarantine extractor whose output is born untrusted, and a deterministic interpreter
that propagates taint and gates dangerous actions.

## Run (no model required)

```bash
pip install -e .
python -m ikarus --scene all --scenario email --mock
```

- Scene 1: injection hidden in the inbox never enters the plan.
- Scene 2: an untrusted recipient is BLOCKED at the sink.
- Scene 3: a naive single-LLM agent gets hijacked and exfiltrates.

## Run against LM Studio (hybrid live mode)

Start LM Studio (OpenAI-compatible server at `http://localhost:1234/v1`), then:

```bash
python -m ikarus --scene all --scenario email --live
```

In `--live`, the **P-LLM planner** runs on your local model (Scene 1 shows it emitting
the plan), falling back to a canonical plan with an on-screen note if the model is
unreachable or returns invalid JSON. The **Q-LLM extractor stays a deterministic mock**
in every mode — see [docs/HONESTY.md](docs/HONESTY.md). Config via env:
`IKARUS_BASE_URL`, `IKARUS_MODEL`, `IKARUS_API_KEY`.

## Honesty

See [docs/HONESTY.md](docs/HONESTY.md) for exactly what is simplified vs. real CaMeL.
See [docs/CAMEL-VS-IKARUS.md](docs/CAMEL-VS-IKARUS.md) for a file-by-file comparison
against the real CaMeL reference implementation.
