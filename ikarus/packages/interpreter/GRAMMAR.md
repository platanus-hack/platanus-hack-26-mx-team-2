# LPL — Ikarus Plan Language

A tiny, **total** language the Planner emits and the interpreter executes. It is
defined as a real language with three separated phases — **lexical**,
**syntactic**, and **semantic** — so the security-critical core is auditable
rather than ad-hoc.

> Design law: LPL has **no loops, no recursion, no user functions, and no
> arbitrary arithmetic** (§6.7). Every program is a finite, straight-line
> sequence → termination is guaranteed by construction. The only computation is
> data access (`.field`, `[index]`), tool dispatch, and quarantined parsing.

## Pipeline

```
source ──▶ Lexer ──▶ tokens ──▶ Parser ──▶ raw AST ──▶ Semantics ──▶ checked Program ──▶ Evaluator
           (1)                  (2)                     (3)                               (4)
```

1. **Lexer** (`lexer.ts`): source text → token stream. Knows nothing of grammar.
2. **Parser** (`parser.ts`): tokens → *raw* AST (generic calls/members/indexes).
   Pure syntax; accepts a superset of valid programs.
3. **Semantics** (`semantics.ts`): lowers + validates the raw AST into the
   **checked `Program`** (`@ikarus/shared`), rejecting everything outside the
   MVP subset. This is where `call` nodes become either `toolCall` or `queryAi`,
   variables are resolved, types are parsed, and the catalog is consulted.
4. **Evaluator** (`evaluator.ts`): walks the checked program, tracking a
   `Capability` per value and gating every tool call through the policy.

Errors from phases 1–3 are **trusted** (they come from our own code, not from
untrusted data), so they can safely be fed back to the Planner's repair loop
(§7.3) without opening an injection channel.

## 1. Lexical grammar (tokens)

```
WS         = (' ' | '\t')+                 ; ignored
COMMENT    = '#' { any-but-newline }        ; ignored
NEWLINE    = '\n' | '\r\n'                  ; statement separator (suppressed inside ( ) [ ] { })
IDENT      = (letter | '_') { letter | digit | '_' }
NUMBER     = '-'? digit+ ('.' digit+)?      ; '-' only ever precedes a digit (no binary minus exists)
STRING     = '"' { char | escape } '"' | "'" { char | escape } "'"
escape     = '\\' ('"' | "'" | '\\' | 'n' | 't' | 'r')
KEYWORD    = 'return' | 'true' | 'false' | 'null'
PUNCT      = '=' | '.' | ',' | ':' | '(' | ')' | '[' | ']' | '{' | '}'
```

Newlines are significant (they end statements) but are **suppressed while any
bracket/paren/brace is open**, so the Planner may wrap long calls across lines.

## 2. Syntactic grammar (EBNF → raw AST)

```ebnf
program     = { NEWLINE } [ statement { NEWLINE+ statement } ] { NEWLINE } EOF ;

statement   = assignment | return ;
assignment  = IDENT "=" expr ;
return      = "return" expr ;

expr        = postfix ;
postfix     = primary { member | index | call } ;
member      = "." IDENT ;
index       = "[" expr "]" ;
call        = "(" [ arg { "," arg } [ "," ] ] ")" ;
arg         = IDENT "=" expr            (* keyword arg *)
            | expr ;                    (* positional arg *)

primary     = STRING | NUMBER | "true" | "false" | "null"
            | list | dict | IDENT | "(" expr ")" ;
list        = "[" [ expr { "," expr } [ "," ] ] "]" ;
dict        = "{" [ pair { "," pair } [ "," ] ] "}" ;
pair        = ( STRING | IDENT ) ":" expr ;
```

The parser treats `.`, `[…]`, and `(…)` uniformly as postfix operators, so
`gmail.list_recent(n=10)` parses as `call(member(name "gmail", "list_recent"),
[n=10])` and `email.sender` as `member(name "email", "sender")`. Disambiguation
is the semantic phase's job, not the parser's.

## 3. Semantic rules (raw AST → checked Program)

- **Statements**: at most one `return`; if present it must be the last
  statement. Assignments bind a variable in scope (reassignment allowed).
- **Variable resolution**: a bare `IDENT` used as a value must be a previously
  bound variable. Bare MCP ids / `query_ai` used as values are errors (they are
  only legal as a call target).
- **Call lowering** — a `call(callee, args)` becomes exactly one of:
  - `callee = name "query_ai"` → **QueryAI**. Accepts `(source, instruction,
    output_type=T)` positionally or by keyword. `instruction` **must be a string
    literal**. `output_type` is parsed as a **TypeRef** (see below), not a value.
    Its result is ALWAYS untrusted.
  - `callee = member(name mcpId, tool)` → **ToolCall**. Arguments **must be
    keyword args**. When a catalog is supplied, the tool must exist, arg names
    must be valid params, and required params must be present.
  - anything else → semantic error ("invalid call target").
- **TypeRef parsing** (the `output_type` argument):
  `str|num|int|float|bool|null` → primitive; `list[T]` → list; `dict|opaque`
  or any unknown name → `opaque`. (Unknown/complex → opaque is safe by design.)
- **Field/index access** lowers structurally; **capability inheritance is at the
  object level** (§12): `email.sender` is exactly as untrusted as `email`.

## 4. Capability semantics (evaluation)

Every runtime value is a `TaggedValue = { value, cap }` where
`cap = { provenance: Set<Source>, trusted: boolean }`.

- **Literals** (from the trusted task) → `{ provenance: {user}, trusted: true }`.
- **`joinCaps`** (the single combination chokepoint): `trusted = AND` of inputs,
  `provenance = UNION` of inputs. Used by lists, dicts, indexing, and the
  `query_ai` source.
- **`member`** inherits the object's capability unchanged (object-level).
- **`toolCall`** result → `{ provenance: {mcp:<id>}, trusted: false }`.
- **`queryAi`** result → `{ provenance: source.provenance ∪ {quarantine},
  trusted: false }` — untrusted **regardless** of inputs.
- **Policy** is evaluated **before** each tool call, over the capabilities of its
  arguments. A `sink` whose sensitive args are untrusted is denied (§7.10).

## Example (valid MVP program)

```python
emails = gmail.list_recent(n=10)
resumen = query_ai(emails, "resume estos correos en 5 bullets", output_type=str)
return resumen
```
