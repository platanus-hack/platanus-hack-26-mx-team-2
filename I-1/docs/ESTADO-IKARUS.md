# Estado de Ikarus — contexto para retomar

> Documento de traspaso. Léelo antes de tocar nada. Última actualización: 2026-06-20.

## Qué es

**Ikarus** es un demo local en Python que **contiene inyección indirecta de prompts por diseño
(contención), no por detección**. Es para el hackathon de seguridad de IA **PH26 MEX** (la IA
debe *causar* el daño / contenerlo, no solo detectarlo).

Ikarus **se inspira en CaMeL** (DeepMind, "Defeating Prompt Injections by Design", 2025) pero
**NO es CaMeL** ni lo reimplementa. La palabra "CaMeL" aparece solo como **cita académica**.

## Estructura del repo (Agile)

Todo el prototipo vive ahora bajo **`I-1/`** (Agile, iteración 1). **Todos los comandos se
corren desde dentro de `I-1/`:**

```
cd I-1
pip install -e .
python3 -m ikarus ...
python3 -m pytest
```

La meta a nivel de repo (`.gitignore`, `.superpowers`) se queda en la **raíz del repo**, fuera
de `I-1/`.

## Las tres capas (la garantía que demuestra)

1. **P-LLM (planificador)** — `ikarus/p_llm.py`. Ve SOLO la petición confiable del usuario + el
   catálogo de herramientas. **Nunca ve datos externos.** Por eso una inyección en un correo no
   entra al plan.
2. **Q-LLM (cuarentena)** — `ikarus/q_llm.py`. Procesa datos sucios y solo extrae. Su salida
   **nace etiquetada UNTRUSTED pase lo que pase** (incluso si extrae la dirección del atacante).
3. **Intérprete (guardia determinista)** — `ikarus/interpreter.py`. Ejecuta el plan, propaga
   etiquetas de procedencia (taint) por los valores y aplica políticas (`ikarus/policy.py`)
   antes de cada acción peligrosa (sink). No es un LLM: no se le convence con palabras.

## Las tres escenas del demo

- **Escena 1 (garantía arquitectónica):** la inyección escondida en el inbox NO entra al plan
  → `ALLOWED`. El P-LLM nunca leyó el correo.
- **Escena 2 (garantía de taint):** el destinatario sale de datos en cuarentena → `UNTRUSTED`
  → **BLOQUEADO en el sink** por el guardia (`BLOCKED: sensitive arg 'to' ... is UNTRUSTED`).
- **Escena 3 (contraste):** agente ingenuo de un solo LLM → secuestrado → exfiltra a
  `attacker@evil.com (hijacked=True)`.

## Decisiones de alcance (cerradas)

- **(a) Intérprete = A1:** ejecutor de plan lineal con **taint por flujo de datos**. NO es un
  intérprete de Python restringido. Sin condicionales/bucles.
- **(b) Taint por flujo de control = B3:** **documentado pero NO implementado**. Hay un stub
  `ikarus/policy.py:propagate_control_flow_taint` que marca exactamente dónde iría.
  **B2 (implementarlo de verdad) está EN COLA como stretch — NO lo hagas sin que el dueño lo
  apruebe.**
- **(c) Presentación = C1:** TUI con `rich` (tabla "Taint Ledger" + veredicto PASS/BLOCK).

## Modo híbrido `--live` (importante)

- Con `--live`, **solo el P-LLM corre contra LM Studio** (Escena 1 muestra al modelo planeando).
  Ahora funciona de forma robusta contra LM Studio:
  - **Modelos de razonamiento (Qwen3, DeepSeek-R1…) soportados:** el cliente les da un
    presupuesto de tokens mayor **y rescata el plan JSON de `reasoning_content`** (estos modelos
    emiten el plan ahí y dejan `content` vacío). Env: `IKARUS_MAX_TOKENS` (default 1024),
    `IKARUS_REASONING_MAX_TOKENS` (default 8192).
  - **El plan del P-LLM se valida antes de ejecutarse** (`interpreter.validate_plan`): un plan
    válido por esquema pero **inejecutable** (referencia de paso mala, arg de sink faltante/extra,
    sink desconocido) **cae al plan canónico** con el aviso `[note]` en pantalla, sin crashear.
  - **El system prompt del P-LLM se reforzó** (forma exacta del plan + ejemplo + campos de la
    petición disponibles) para que los modelos locales emitan planes válidos de forma confiable.
  - **Modelos planificadores recomendados:** `google/gemma-3-12b`, `openai/gpt-oss-20b`,
    `google/gemma-3-27b`. Los de razonamiento también funcionan pero pueden caer al fallback si
    emiten un plan inválido. Se elige modelo con `IKARUS_MODEL` (los ids pueden ir con prefijo,
    p. ej. `google/gemma-3-12b`).
- **El Q-LLM (extracción) SIEMPRE es mock determinista**, incluso en `--live` — no está cableado
  al modelo (nace UNTRUSTED por diseño). La garantía de taint se sostiene igual. El bloqueo de la
  Escena 2 también es determinista (lo decide el intérprete, no el modelo).
- **Correo real ahora es OPCIONAL** vía un sink intercambiable (ver abajo). `--mock`/`--live`
  controla **solo el planificador P-LLM**; el sink se controla aparte con `IKARUS_SINK`.

## Sink de correo (envío real opcional)

- `IKARUS_SINK=mock` (default) — **nunca envía**. `IKARUS_SINK=resend` — envío real vía Resend.
- Secreto **solo por env** `RESEND_API_KEY`; remitente vía `IKARUS_EMAIL_FROM`.
- **Backstop duro:** el sink real solo envía a direcciones en `IKARUS_ALLOWED_RECIPIENTS`
  (separadas por coma). Allowlist vacía o destinatario fuera de la lista → **rechazado y
  registrado** (nunca crashea; los errores de transporte/API también se capturan).
- El intérprete y el agente ingenuo enrutan `send_email` por este sink. El agente ingenuo, cuando
  es secuestrado, **sí envía** pero solo a una dirección de la allowlist.
- Las direcciones del escenario son sobre-escribibles por env para que un demo en vivo llegue a tu
  propia bandeja: `IKARUS_TRUSTED_RECIPIENT` y `IKARUS_ATTACKER_ADDR`.
- `share_doc` sigue mock.

## Estado del código

- **Rama:** `ikarus-impl` (NO fusionada a `master`). ~36 commits.
- **Tests:** `82 passed` (pytest). Cobertura de las tres garantías + las tres escenas.
- **Instalable:** `pip install -e .` funciona (verificado).
- Hay un warning de `pytest-asyncio` que es **del entorno** (plugin global, no es dependencia del
  proyecto, no hay código async). No es culpa del código.

### Mapa de archivos (`ikarus/`)
- `config.py` — settings de LM Studio (env: `IKARUS_BASE_URL`, `IKARUS_MODEL`, `IKARUS_API_KEY`).
  **Creció:** presupuestos de tokens (`IKARUS_MAX_TOKENS`, `IKARUS_REASONING_MAX_TOKENS`),
  `is_reasoning_model`, y settings del sink (`IKARUS_SINK`, `RESEND_API_KEY`, `IKARUS_EMAIL_FROM`,
  `IKARUS_ALLOWED_RECIPIENTS`, `IKARUS_TRUSTED_RECIPIENT`, `IKARUS_ATTACKER_ADDR`).
- `labels.py` — `Trust`, `Provenance`, `Tainted` (inmutable) + ley de taint (UNTRUSTED domina).
- `schemas.py` — modelos pydantic: `Plan`, `PlanStep`, `ArgRef`, `Extraction`.
- `tools/` — `registry.py` (SOURCE/SINK + sensitive_args), `sources.py` (UNTRUSTED), `sinks.py` (mock).
- `tools/email_sink.py` — **NUEVO:** providers Mock/Resend + allowlist + `SinkError`/`SinkBlocked`
  + factory + CLI de smoke.
- `policy.py` — guardia: bloquea si un arg sensible es UNTRUSTED; + stub control-flow (B3).
- `llm_client.py` — wrapper OpenAI-compatible para LM Studio (import perezoso, testeable por DI).
  **Creció:** presupuesto de tokens para razonamiento + rescate de `reasoning_content` + parseo
  JSON tolerante.
- `q_llm.py` — cuarentena: extract() siempre UNTRUSTED.
- `p_llm.py` — planificador: solo request+catálogo, fallback a plan canónico. **Creció:** prompt
  reforzado + `request_fields`.
- `interpreter.py` — guardia determinista: corre el plan, propaga taint, bloquea sinks (ahora 138
  líneas). **Creció:** `validate_plan` + sinks inyectables + manejo de `SinkError`.
- `naive_agent.py` — agente ingenuo que se deja secuestrar (el contraste). **Creció:** sink inyectable.
- `scenarios.py` — escenarios `email` y `pdf` con fixtures de inyección. **Creció:** direcciones
  sobre-escribibles por env.
- `tui.py` — render `rich` (Taint Ledger + veredicto). **Ojo:** usa `Console(file=io.StringIO())`
  para grabar sin imprimir; el CLI imprime el texto devuelto (si rompes esto, cada escena se
  imprime doble — ya pasó y se arregló).
- `cli.py` / `__main__.py` — runner de las 3 escenas + wiring híbrido `--live`. **Creció:** cablea
  el sink.

### Documentación
- `README.md` — quickstart (inglés).
- `docs/COMO-PROBAR.md` — **cómo probar el demo paso a paso (español)**.
- `docs/HONESTY.md` — qué se simplifica vs CaMeL real (con citas de líneas reales).
- `docs/CAMEL-VS-IKARUS.md` — tabla de mapeo real CaMeL → Ikarus.
- `docs/superpowers/specs/2026-06-20-ikarus-design.md` — spec de diseño.
- `docs/superpowers/plans/2026-06-20-ikarus.md` — plan de implementación (14 tareas).
- `.superpowers/sdd/progress.md` — bitácora de ejecución tarea por tarea.

### Repo de referencia (CaMeL real)
Clonado en `../camel-reference/` (hermano de este proyecto), Apache-2.0. Núcleo:
`src/camel/interpreter/interpreter.py` (2716 líneas), `interpreter/value.py` (1460),
`quarantined_llm.py` (103), `pipeline_elements/privileged_llm.py` (483),
`security_policy.py` (110). Leer para entender/robustecer, NO para correr (es AgentDojo).

## Pendientes / próximos pasos posibles

1. **Q-LLM real:** la extracción sigue siendo un mock determinista en todos los modos (nace
   UNTRUSTED por diseño). Cablearla a un modelo es trabajo pendiente.
2. **Stretch B2** (taint por flujo de control real) — **EN COLA**, solo si el dueño lo aprueba.
   Requiere extender `schemas.py` (condicionales), `interpreter.py` y
   `policy.py:propagate_control_flow_taint`.
3. **Stretch C2 (vista web):** **diseñada pero NO construida** — pendiente.
4. **Decisión de cierre de rama:** `ikarus-impl` no está fusionada. Opciones: merge a `master`,
   PR, o dejarla. (Pendiente que decida el dueño.)
