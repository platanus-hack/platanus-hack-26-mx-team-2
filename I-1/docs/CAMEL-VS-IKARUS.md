# CaMeL vs Ikarus: a one-page mapping

Ikarus is **inspired by** CaMeL (DeepMind, "Defeating Prompt Injections by Design",
2025). It is **not** CaMeL. The numbers below come from the official DeepMind CaMeL
reference implementation, cloned locally to `camel-reference/` for comparison during
development. That repository is licensed **Apache-2.0**; any code reused from it must
keep its license notice and attribution. Ikarus's own code is original and does not
copy from the reference repo — the comparison below is read-only research, not a port.

## Mapping table

| Real CaMeL component | File | Lines | Ikarus equivalent | What's simplified |
|---|---|---|---|---|
| AST-walking interpreter for a restricted Python subset | `src/camel/interpreter/interpreter.py` | 2716 | `ikarus/interpreter.py` (~70 lines) | Linear executor over an ordered plan (A1); no sandboxed Python, no conditionals/loops |
| Value / capability system (control-flow taint lives here) | `src/camel/interpreter/value.py` | 1460 | `ikarus/labels.py` (~30 lines) | Data-flow taint only — no control-flow taint; gap named explicitly by the stub `ikarus/policy.py:propagate_control_flow_taint` |
| Quarantined (extractor) LLM | `src/camel/quarantined_llm.py` | 103 | `ikarus/q_llm.py` | Faithful in spirit: narrow extractor, output born UNTRUSTED by construction |
| Privileged (planner) LLM | `src/camel/pipeline_elements/privileged_llm.py` | 483 | `ikarus/p_llm.py` (~50 lines) | Plan emission only, plus hybrid live/mock/fallback path; no general tool-call retry machinery |
| General policy engine | `src/camel/security_policy.py` | 110 | `ikarus/policy.py` (~37 lines) | Single hard-wired rule (TRUSTED recipient required for `send_email`/`share_doc`); no policy DSL |
| Per-domain policies — banking | `src/camel/pipeline_elements/security_policies/banking.py` | 122 | *(none)* | Not modeled; Ikarus has one domain (email/pdf), not banking |
| Per-domain policies — slack | `src/camel/pipeline_elements/security_policies/slack.py` | 99 | *(none)* | Not modeled |
| Per-domain policies — travel | `src/camel/pipeline_elements/security_policies/travel.py` | 150 | *(none)* | Not modeled |
| Per-domain policies — workspace | `src/camel/pipeline_elements/security_policies/workspace.py` | 270 | *(none)* | Not modeled |
| Top-level orchestration | `main.py` + `run_code.py` (repo root) | 114 + 161 | `ikarus/cli.py` | Three fixed scenes/scenarios instead of a general runnable pipeline |

## Best honest talking points for judges

- **The interpreter gap is the whole story in two numbers.** Real CaMeL's interpreter
  is 2716 lines of AST-node handling for a restricted Python subset; Ikarus's is a
  ~70-line loop over an ordered plan. We didn't shrink the architecture — we picked a
  much smaller execution model (structured plan, not sandboxed code) and that choice is
  what makes the rest of the simplification possible.
- **`value.py` (1460 lines) is exactly where our stub admits the gap.** Real CaMeL's
  control-flow taint propagation lives inside its value/capability system. Ikarus names
  that exact gap in code — `ikarus/policy.py:propagate_control_flow_taint` — rather than
  silently doing data-flow taint and calling it complete.
- **`quarantined_llm.py` (103 lines) is the one place we're faithful, not just
  inspired.** Its shape — extract-only, output born untrusted regardless of content —
  is the same shape as Ikarus's `ikarus/q_llm.py`. That's the part of the design we
  ported in spirit, and it's the part doing the real security work in our demo.
