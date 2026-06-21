# Ikarus — Honest Simplifications vs. real CaMeL

Ikarus approximates the CaMeL architecture (DeepMind, "Defeating Prompt Injections by
Design", 2025). It does NOT reimplement it. What we simplified, explicitly:

1. **Structured plan, not a restricted Python interpreter.** The P-LLM emits an ordered
   list of steps (A1), not sandboxed Python. No conditionals/loops.
2. **Data-flow taint only — no control-flow taint.** Real CaMeL taints values that
   *branch on* untrusted data. We do not. See the stub
   `ikarus/policy.py:propagate_control_flow_taint` for exactly where it would hook in.
3. **Hard-wired policies, not a capability language.** `send_email`/`share_doc` require a
   TRUSTED recipient. There is no general policy DSL.
4. **Hybrid live mode.** With `--live`, the **P-LLM planner runs against LM Studio**
   (Scene 1 shows the local model emitting the plan). The **Q-LLM extractor is always a
   deterministic mock**, even in `--live` — it is not wired to the model. The P-LLM
   planner live path also (a) supports reasoning models by rescuing the JSON plan from
   `reasoning_content` and granting them a larger token budget, and (b) validates the
   model's plan and falls back to the canonical plan if it is schema-valid but
   unexecutable. On LM Studio failure or invalid JSON, the planner likewise falls back to
   a canonical plan, flagged on screen. The taint guarantee holds regardless of mode,
   because the interpreter is deterministic and Q-LLM output is born UNTRUSTED either way.
5. **Sinks are mock by default.** With `IKARUS_SINK=mock` (the default) no real email is
   ever sent. A real email sink is available via Resend (`IKARUS_SINK=resend`), gated by a
   hard recipient allowlist (`IKARUS_ALLOWED_RECIPIENTS`): it refuses to send with an empty
   allowlist or to any off-allowlist recipient, and transport/API failures are caught
   (recorded, never crash). With the real sink the naive (hijacked) agent really does send
   — but ONLY to an operator-approved, allowlisted address. `share_doc` stays mock.

## What we DO claim

- The P-LLM never receives untrusted data (architectural guarantee).
- The Q-LLM's output is born UNTRUSTED regardless of content (taint origin).
- The interpreter blocks any sink whose sensitive argument is UNTRUSTED — it is
  deterministic and cannot be talked out of it (containment, not detection).
- The real email sink, when enabled, can only reach operator-approved addresses (the
  allowlist), so the demo never exfiltrates to an uncontrolled third party.

## Evidence: real CaMeL vs Ikarus (file/line counts)

These counts come from the official DeepMind CaMeL reference implementation
(Apache-2.0), cloned locally for comparison during development. They are cited here to
make the simplifications above concrete rather than rhetorical.

- **Interpreter.** Real CaMeL's interpreter is an AST-walking interpreter for a
  restricted Python subset: `src/camel/interpreter/interpreter.py`, **2716 lines**.
  Ikarus's `ikarus/interpreter.py` is a linear structured-plan executor, ~138 lines (it
  gained `validate_plan` and an injectable sink) — still NOT an AST-walking interpreter.
  This is simplification (1) above, made literal: roughly 2700 lines of AST-node handling
  collapse to a loop over an ordered list of steps, orders of magnitude smaller than real
  CaMeL's 2716-line AST interpreter.
- **Value / capability system.** Real CaMeL's `src/camel/interpreter/value.py`
  (**1460 lines**) is where capabilities attach to runtime values and where
  control-flow taint propagation actually lives — the gap named by Ikarus's stub
  `ikarus/policy.py:propagate_control_flow_taint`. Ikarus's equivalent is
  `ikarus/labels.py`, ~30 lines of data-flow-only taint labels. This is simplification
  (2) above: one file in real CaMeL is doing work that Ikarus explicitly does not do.
- **Quarantined LLM.** Real CaMeL's `src/camel/quarantined_llm.py` is **103 lines**.
  Its shape — a narrow extractor whose return value is never trusted by construction —
  matches Ikarus's `ikarus/q_llm.py` design closely. This is the one place where Ikarus
  is faithful in spirit, not just inspired: extract-only, output born untrusted.
- **Privileged (planner) LLM.** Real CaMeL's
  `src/camel/pipeline_elements/privileged_llm.py` is **483 lines**, handling planning,
  retries, and tool-call formatting. Ikarus's `ikarus/p_llm.py` is ~50 lines and covers
  only plan emission plus the live/mock/fallback path described in simplification (4).
- **Policies.** Real CaMeL has a general policy engine,
  `src/camel/security_policy.py` (110 lines), plus per-domain policy modules under
  `src/camel/pipeline_elements/security_policies/`: banking (122 lines), slack
  (99 lines), travel (150 lines), workspace (270 lines). Ikarus has no policy engine —
  `ikarus/policy.py` hard-wires the TRUSTED-recipient rule directly, simplification (3)
  above.
- **Orchestration.** Real CaMeL's top-level orchestration lives in `main.py` (114 lines)
  and `run_code.py` (161 lines) at the repo root, wiring the planner, interpreter, and
  policies into a runnable pipeline. Ikarus's equivalent is `ikarus/cli.py`.

**Framing.** Ikarus approximates the CaMeL architecture's *shape* (privileged planner /
quarantined extractor / deterministic interpreter with taint-gated sinks). It does not
reimplement CaMeL's restricted-Python execution model, its capability/value system, or
its general policy engine. Where Ikarus is thin, it is thin because that surface was out
of scope, not because it was discovered to be unnecessary.
