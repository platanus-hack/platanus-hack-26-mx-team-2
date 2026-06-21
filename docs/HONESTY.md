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
   deterministic mock**, even in `--live` — it is not wired to the model. On LM Studio
   failure or invalid JSON, the planner falls back to a canonical plan, flagged on
   screen. The taint guarantee holds regardless of mode, because the interpreter is
   deterministic and Q-LLM output is born UNTRUSTED either way.
5. **Sinks are mocked.** No real email is ever sent.

## What we DO claim

- The P-LLM never receives untrusted data (architectural guarantee).
- The Q-LLM's output is born UNTRUSTED regardless of content (taint origin).
- The interpreter blocks any sink whose sensitive argument is UNTRUSTED — it is
  deterministic and cannot be talked out of it (containment, not detection).
