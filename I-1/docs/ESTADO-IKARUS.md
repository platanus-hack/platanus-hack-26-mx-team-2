# Estado de Ikarus — contexto para retomar

> Documento de traspaso. Léelo antes de tocar nada. Última actualización: 2026-06-21
> (refactor SOLID/OOP completado).

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
   La política ahora es **deny-by-default**: bloquea el sink si **CUALQUIERA** de sus args es
   UNTRUSTED (protege el cuerpo del correo / contenido del doc compartido, no solo el
   destinatario). Implementada como estrategia `SecurityPolicy` (typing.Protocol) +
   `DenyUntrustedArgsPolicy` en `ikarus/policy.py`.

## Las tres escenas del demo

- **Escena 1 (garantía arquitectónica):** la inyección escondida en el inbox NO entra al plan
  → `ALLOWED`. El P-LLM nunca leyó el correo.
- **Escena 2 (garantía de taint):** el destinatario sale de datos en cuarentena → `UNTRUSTED`
  → **BLOQUEADO en el sink** por el guardia (`BLOCKED: sensitive arg 'to' ... is UNTRUSTED`).
  Con la política deny-by-default, **cualquier** arg UNTRUSTED (no solo `to`) basta para bloquear.
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

## Postura de seguridad (deny-by-default, tras auditoría)

Una auditoría de seguridad reciente endureció el demo. Cambios clave:

- **Política deny-by-default:** el sink se bloquea si **CUALQUIER** arg es UNTRUSTED (no solo el
  destinatario). Estrategia `SecurityPolicy` (typing.Protocol) + `DenyUntrustedArgsPolicy` en
  `ikarus/policy.py`.
- **`validate_plan` rechaza destinatario desde literal:** un arg de destinatario originado en un
  valor `literal`/inline se rechaza (nacería TRUSTED y saltaría el taint), pero `from="step"`
  **sí** se permite para que el plan envenenado de la Escena 2 llegue a la política de runtime y
  se bloquee ahí.
- **Secretos fuera del `repr`:** `RESEND_API_KEY` y `api_key` usan `field(repr=False)`. La
  allowlist de destinatarios se normaliza (trim + minúsculas). La config de Resend se valida
  (fail fast si falta key o remitente).
- **Inmutabilidad reforzada:** `ExecutionResult` usa tuplas; `Scenario.request_values` es un
  `MappingProxyType`.
- **Robustez:** `_parse_json` endurecido (escaneo `raw_decode`); choices vacías → `LLMError`;
  `KeyError` envueltos como `ValueError`; `is_reasoning_model` excluye visión (`-vl`); errores
  amigables en envs int; `q_llm` loguea fallos; el catálogo del planificador se deriva del
  registry.

## Refactor SOLID/OOP (COMPLETADO)

Refactor hacia OOP/SOLID **terminado**. Cada capa se hizo con TDD (RED→GREEN), commits
atómicos, suite verde y demo intacto en cada paso. **Hecho:**

- `EmailSink` (Protocol) + `MockEmailSink`/`ResendEmailSink` (transporte delgado) +
  `AllowlistEmailSink` (decorator) + factory validante `make_email_sink`.
- `Source` (Protocol) + `InboxSource`/`PdfSource` + `default_sources()`; el intérprete despacha
  la fuente por `step.tool` (la ruta antes muerta `read_pdf` ahora funciona).
- `SecurityPolicy` como estrategia (`DenyUntrustedArgsPolicy`).
- **`Interpreter` como clase** con colaboradores inyectados (policy/sinks/sources/extractor).
  Las funciones de módulo `run`/`validate_plan` quedan como wrappers compatibles.
- **`PrivilegedPlanner`** (dueño del catálogo derivado del registry) y **`QuarantineExtractor`**
  (callable que encaja en el slot extractor del intérprete; nace UNTRUSTED por construcción).
- **`CompositionRoot`** (todo el cableado del grafo de objetos) + **`IkarusApp`** (servicio que
  orquesta las 3 escenas) + **`cli` delgado** (solo argparse + delegación; `make_email_sink` se
  sigue resolviendo en el namespace de `cli` para el monkeypatch/`IKARUS_SINK`).
- **`TraceRenderer`** (presentación como colaborador inyectable; `render_trace`/`verdict_line`
  quedan como wrappers).
- **`ScenarioRegistry`** + `default_scenarios()` sobre las fábricas de escenarios; `SCENARIOS`
  queda por compatibilidad.
- **Split de config:** `is_reasoning_model` + `REASONING_MODEL_MARKERS` movidos a
  `ikarus/models.py` (SRP: conocimiento de familia de modelo ≠ carga de env).

**Pendiente del refactor:** nada. (Stretch fuera de alcance: Q-LLM real, B2, vista web — ver abajo.)

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

- **Rama:** `ikarus-impl` (NO fusionada a `master`). ~42 commits.
- **Tests:** `128 passed` (pytest). Cobertura de las tres garantías + las tres escenas + los
  endurecimientos de la auditoría + las clases del refactor SOLID/OOP.
- **Instalable:** `pip install -e .` funciona (verificado).
- Hay un warning de `pytest-asyncio` que es **del entorno** (plugin global, no es dependencia del
  proyecto, no hay código async). No es culpa del código.

### Mapa de archivos (`ikarus/`)
- `config.py` — `Settings` + `load_settings` (env: `IKARUS_BASE_URL`, `IKARUS_MODEL`,
  `IKARUS_API_KEY`, presupuestos de tokens `IKARUS_MAX_TOKENS`/`IKARUS_REASONING_MAX_TOKENS`, y
  settings del sink `IKARUS_SINK`, `RESEND_API_KEY`, `IKARUS_EMAIL_FROM`,
  `IKARUS_ALLOWED_RECIPIENTS`, `IKARUS_TRUSTED_RECIPIENT`, `IKARUS_ATTACKER_ADDR`).
- `models.py` — **OOP/SRP:** heurística de familia de modelo (`is_reasoning_model` +
  `REASONING_MODEL_MARKERS`), separada de la carga de env.
- `labels.py` — `Trust`, `Provenance`, `Tainted` (inmutable) + ley de taint (UNTRUSTED domina).
- `schemas.py` — modelos pydantic: `Plan`, `PlanStep`, `ArgRef`, `Extraction`.
- `tools/` — `registry.py` (SOURCE/SINK + sensitive_args), `sinks.py` (mock).
- `tools/sources.py` — **OOP:** `Source` (Protocol) + `InboxSource`/`PdfSource` +
  `default_sources()` (todas nacen UNTRUSTED).
- `tools/email_sink.py` — **OOP:** `EmailSink` (Protocol) + `MockEmailSink`/`ResendEmailSink`
  (transporte delgado) + `AllowlistEmailSink` (decorator) + factory validante `make_email_sink`
  + `SinkError`/`SinkBlocked` + CLI de smoke.
- `policy.py` — guardia deny-by-default: `SecurityPolicy` (Protocol) + `DenyUntrustedArgsPolicy`
  (bloquea si CUALQUIER arg es UNTRUSTED); + stub control-flow (B3).
- `llm_client.py` — wrapper OpenAI-compatible para LM Studio (import perezoso, testeable por DI).
  **Creció:** presupuesto de tokens para razonamiento + rescate de `reasoning_content` + parseo
  JSON tolerante.
- `q_llm.py` — cuarentena: `extract()` siempre UNTRUSTED + **`QuarantineExtractor`** (callable
  inyectable en el intérprete).
- `p_llm.py` — planificador: solo request+catálogo, fallback a plan canónico (prompt reforzado +
  `request_fields`) + **`PrivilegedPlanner`** (dueño del catálogo derivado del registry).
- `interpreter.py` — **`Interpreter` (clase)**: guardia determinista con colaboradores inyectados
  (policy/sinks/sources/extractor); corre el plan, propaga taint, consulta la política antes de
  cada sink. `validate_plan` (rechaza destinatario `literal`, permite `from="step"`) y `run`
  quedan como wrappers de módulo compatibles. Despacho de fuente por `step.tool` + manejo de
  `SinkError`.
- `app.py` — **`IkarusApp`**: servicio de aplicación que orquesta las 3 escenas (sin cableado ni
  parseo de args). Usa el intérprete inyectado + `PrivilegedPlanner` para la selección de plan en
  vivo, y el `TraceRenderer` inyectado para presentar.
- `composition.py` — **`CompositionRoot`**: único lugar que arma el grafo de objetos desde
  `Settings` (registry, sinks, intérprete, escenarios, renderer); el `email_sink` se inyecta.
- `naive_agent.py` — agente ingenuo que se deja secuestrar (el contraste). Sink inyectable.
- `scenarios.py` — escenarios `email` y `pdf` con fixtures de inyección (direcciones
  sobre-escribibles por env) + **`ScenarioRegistry`** (`names`/`create`/`__contains__`) +
  `default_scenarios()`. `SCENARIOS` queda por compatibilidad.
- `tui.py` — **`TraceRenderer`** (render `rich`: Taint Ledger + veredicto); `render_trace`/
  `verdict_line` quedan como wrappers. **Ojo:** usa `Console(file=io.StringIO())` para grabar sin
  imprimir; el CLI imprime el texto devuelto (si rompes esto, cada escena se imprime doble — ya
  pasó y se arregló).
- `cli.py` / `__main__.py` — **CLI delgado:** solo argparse + delega en `CompositionRoot`/
  `IkarusApp`. `make_email_sink` se resuelve aquí (namespace `cli`) para `IKARUS_SINK` y el
  monkeypatch de los tests.

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

1. **Refactor SOLID/OOP — COMPLETADO.** Ver la sección "Refactor SOLID/OOP (COMPLETADO)" arriba.
   Nada pendiente del refactor.
2. **Q-LLM real:** la extracción sigue siendo un mock determinista en todos los modos (nace
   UNTRUSTED por diseño). Cablearla a un modelo es trabajo pendiente.
3. **Stretch B2** (taint por flujo de control real) — **EN COLA**, solo si el dueño lo aprueba.
   Requiere extender `schemas.py` (condicionales), `interpreter.py` y
   `policy.py:propagate_control_flow_taint`.
4. **Stretch C2 (vista web):** **diseñada pero NO construida** — pendiente.
5. **Decisión de cierre de rama:** `ikarus-impl` no está fusionada (el dueño la fusionará a
   mano). Opciones: merge a `master`, PR, o dejarla. (Pendiente que decida el dueño.)
