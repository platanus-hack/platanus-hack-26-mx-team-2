# Estado de Ikarus — contexto para retomar

> Documento de traspaso. Léelo antes de tocar nada. Última actualización: 2026-06-20.

## Qué es

**Ikarus** es un demo local en Python que **contiene inyección indirecta de prompts por diseño
(contención), no por detección**. Es para el hackathon de seguridad de IA **PH26 MEX** (la IA
debe *causar* el daño / contenerlo, no solo detectarlo).

Ikarus **se inspira en CaMeL** (DeepMind, "Defeating Prompt Injections by Design", 2025) pero
**NO es CaMeL** ni lo reimplementa. La palabra "CaMeL" aparece solo como **cita académica**.

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
  Si el modelo no responde o devuelve JSON inválido, cae a un plan canónico con aviso en pantalla.
- **El Q-LLM (extracción) SIEMPRE es mock determinista**, incluso en `--live` — no está cableado
  al modelo. La garantía de taint se sostiene igual (la salida nace UNTRUSTED).
- Los **sinks están mockeados**: nunca se envía un correo real.

## Estado del código

- **Rama:** `ikarus-impl` (NO fusionada a `master`). ~36 commits.
- **Tests:** `50 passed` (pytest). Cobertura de las tres garantías + las tres escenas.
- **Instalable:** `pip install -e .` funciona (verificado).
- Hay un warning de `pytest-asyncio` que es **del entorno** (plugin global, no es dependencia del
  proyecto, no hay código async). No es culpa del código.

### Mapa de archivos (`ikarus/`)
- `config.py` — settings de LM Studio (env: `IKARUS_BASE_URL`, `IKARUS_MODEL`, `IKARUS_API_KEY`).
- `labels.py` — `Trust`, `Provenance`, `Tainted` (inmutable) + ley de taint (UNTRUSTED domina).
- `schemas.py` — modelos pydantic: `Plan`, `PlanStep`, `ArgRef`, `Extraction`.
- `tools/` — `registry.py` (SOURCE/SINK + sensitive_args), `sources.py` (UNTRUSTED), `sinks.py` (mock).
- `policy.py` — guardia: bloquea si un arg sensible es UNTRUSTED; + stub control-flow (B3).
- `llm_client.py` — wrapper OpenAI-compatible para LM Studio (import perezoso, testeable por DI).
- `q_llm.py` — cuarentena: extract() siempre UNTRUSTED.
- `p_llm.py` — planificador: solo request+catálogo, fallback a plan canónico.
- `interpreter.py` — guardia determinista: corre el plan, propaga taint, bloquea sinks.
- `naive_agent.py` — agente ingenuo que se deja secuestrar (el contraste).
- `scenarios.py` — escenarios `email` y `pdf` con fixtures de inyección.
- `tui.py` — render `rich` (Taint Ledger + veredicto). **Ojo:** usa `Console(file=io.StringIO())`
  para grabar sin imprimir; el CLI imprime el texto devuelto (si rompes esto, cada escena se
  imprime doble — ya pasó y se arregló).
- `cli.py` / `__main__.py` — runner de las 3 escenas + wiring híbrido `--live`.

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

1. **Probar `--live` contra LM Studio real** (ahora mismo solo se validó `--mock`). Ver
   `docs/COMO-PROBAR.md`.
2. **Stretch B2** (taint por flujo de control real) — solo si el dueño lo aprueba. Requiere
   extender `schemas.py` (condicionales), `interpreter.py` y `policy.py:propagate_control_flow_taint`.
3. **Stretch C2** (vista web) o **escenario 3** (web/pago) — fuera de alcance core.
4. **Decisión de cierre de rama:** `ikarus-impl` no está fusionada. Opciones: merge a `master`,
   PR, o dejarla. (Pendiente que decida el dueño.)
