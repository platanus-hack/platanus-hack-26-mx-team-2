# Ikarus

Local demo that contains indirect prompt injection **by design** — approximating
DeepMind's CaMeL. Three layers: a planner that sees only the trusted request, a
quarantine extractor whose output is born untrusted, and a deterministic interpreter
that propagates taint and gates dangerous actions.

## Run (no model required)

The project lives under `I-1/` (Agile iteration 1). Run from inside it:

```bash
cd I-1
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
the plan). The **Q-LLM extractor stays a deterministic mock** in every mode — see
[docs/HONESTY.md](docs/HONESTY.md). Config via env: `IKARUS_BASE_URL`, `IKARUS_MODEL`,
`IKARUS_API_KEY`.

Planner models that work well (set via `IKARUS_MODEL`; LM Studio ids can be prefixed):
`google/gemma-3-12b`, `openai/gpt-oss-20b`, `google/gemma-3-27b`.

Reasoning models (Qwen3, DeepSeek-R1) also work: the client gives them more tokens and
rescues the JSON plan from `reasoning_content` when needed. Tune with `IKARUS_MAX_TOKENS`
and `IKARUS_REASONING_MAX_TOKENS`.

The planner's plan is validated and falls back to a canonical plan (with an on-screen
note) if it is invalid — it never crashes.

## Real email (optional)

Sends are mock by default. Set `IKARUS_SINK=resend` to send real mail via
[Resend](https://resend.com) — secret via `RESEND_API_KEY`, sender via `IKARUS_EMAIL_FROM`.

Hard safety backstop: the real sink only sends to addresses listed in
`IKARUS_ALLOWED_RECIPIENTS` (comma-separated). An empty list or an off-list address is
refused (recorded, never crashes). `share_doc` stays mock.

Scenario addresses are env-overridable so a live demo reaches your own inbox:
`IKARUS_TRUSTED_RECIPIENT`, `IKARUS_ATTACKER_ADDR`.

`--mock`/`--live` controls only the P-LLM planner; the sink is controlled independently by
`IKARUS_SINK`, so you can combine `--mock` with `IKARUS_SINK=resend`.

Smoke test the sink directly:

```bash
python -m ikarus.tools.email_sink --to you@x.com --body hi
```

## Honesty

See [docs/HONESTY.md](docs/HONESTY.md) for exactly what is simplified vs. real CaMeL.
See [docs/CAMEL-VS-IKARUS.md](docs/CAMEL-VS-IKARUS.md) for a file-by-file comparison
against the real CaMeL reference implementation.
