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
| AST-walking interpreter for a restricted Python subset | `src/camel/interpreter/interpreter.py` | 2716 | `ikarus/interpreter.py` (~171 lines; also validates the model's plan via `validate_plan()` — including the rule that rejects a literal/inline recipient — and dispatches sources/sinks) | Linear executor over an ordered plan (A1); no sandboxed Python, no conditionals/loops |
| Value / capability system (control-flow taint lives here) | `src/camel/interpreter/value.py` | 1460 | `ikarus/labels.py` (~30 lines) | Data-flow taint only — no control-flow taint; gap named explicitly by the stub `ikarus/policy.py:propagate_control_flow_taint` |
| Quarantined (extractor) LLM | `src/camel/quarantined_llm.py` | 103 | `ikarus/q_llm.py` | Faithful in spirit: narrow extractor, output born UNTRUSTED by construction |
| Privileged (planner) LLM | `src/camel/pipeline_elements/privileged_llm.py` | 483 | `ikarus/p_llm.py` (~50 lines) | Plan emission only, plus hybrid live/mock/fallback path; no general tool-call retry machinery |
| General policy engine | `src/camel/security_policy.py` | 110 | `ikarus/policy.py` (~59 lines) | One fixed deny-by-default policy: `DenyUntrustedArgsPolicy` (a `SecurityPolicy` strategy) blocks a sink if ANY argument is UNTRUSTED, so content is gated like the recipient; no policy DSL |
| Per-domain policies — banking | `src/camel/pipeline_elements/security_policies/banking.py` | 122 | *(none)* | Not modeled; Ikarus has one domain (email/pdf), not banking |
| Per-domain policies — slack | `src/camel/pipeline_elements/security_policies/slack.py` | 99 | *(none)* | Not modeled |
| Per-domain policies — travel | `src/camel/pipeline_elements/security_policies/travel.py` | 150 | *(none)* | Not modeled |
| Per-domain policies — workspace | `src/camel/pipeline_elements/security_policies/workspace.py` | 270 | *(none)* | Not modeled |
| Top-level orchestration | `main.py` + `run_code.py` (repo root) | 114 + 161 | `ikarus/cli.py` | Three fixed scenes/scenarios instead of a general runnable pipeline |
| Side-effect tools (sinks) | mocked AgentDojo tools | — | `ikarus/tools/email_sink.py` (~95 lines) | Swappable `mock`\|`Resend` email sink, gated by a recipient allowlist via the `AllowlistEmailSink` decorator; mock by default. The real Resend path is an Ikarus-specific addition (not part of CaMeL), kept safe by the allowlist |

## Beyond the mapping: where Ikarus diverges by *intent* (not by simplification)

The table above lists where Ikarus is *smaller* than CaMeL. But Ikarus's design
(`docs/DOCUMENTO-MAESTRO.md`) also aims somewhere CaMeL does not — these are different
goals, not missing features:

| Dimension | Real CaMeL | Ikarus's design (vision) |
|---|---|---|
| What it is | A research defense, evaluated on the **AgentDojo** benchmark | **Plug-and-play infrastructure**: an MCP gateway you deploy in front of your own agent |
| Surface | A pipeline you run in a research harness | **One MCP, one function** `run_task(task)` — the user replaces all their loose MCPs with this one |
| Tools | AgentDojo's mocked tool suites | An **aggregator of the user's real MCPs** (Gmail/CRM/DB…), introspected to typed functions |
| Quarantine LLM | Fixed in the framework | **User-configurable** (model + API key entered in a UI) |
| Policies | A general policy engine + per-domain Python modules | **Declarative, UI-editable** rules with safe defaults (read/sink + provenance → allow/deny) |
| Operability | Research code | Managed MCP credentials + a **data-flow trace viewer** for non-experts |

**Status:** the gateway, the aggregator, the policy DSL and the UI above are **vision, not
built** in this repo. What exists is the Python PoC of the three-layer core. So the honest
line is: *inspired by CaMeL's guarantee, reframed as deployable infrastructure — and only
the core of that is implemented so far.*

## Best honest talking points for judges

- **The interpreter gap is the whole story in two numbers.** Real CaMeL's interpreter
  is 2716 lines of AST-node handling for a restricted Python subset; Ikarus's is a
  ~171-line linear executor over an ordered plan. We didn't shrink the architecture — we picked a
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
- **Deny-by-default gates content, not just the recipient.** `DenyUntrustedArgsPolicy`
  blocks a sink if ANY argument is UNTRUSTED, so the email body / shared-doc content is
  contained exactly like the recipient — untrusted data cannot slip out through an
  unguarded argument.
- **Containment is demonstrated against a real side effect, not just a mock.** Ikarus
  can now optionally send REAL email behind a deterministic recipient allowlist, while
  the security guarantee — a taint-gated sink — is still enforced by the deterministic
  interpreter. The injection is contained even when the sink is a genuine outbound
  action, not only when it's mocked.
