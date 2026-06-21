# Plan — Arquitectura e inicio de construcción de Lazarus

## Context

Lazarus es un **gateway MCP de defensa contra prompt injection por diseño** (Hackathon Platanus, track IA Safety, 4 personas). El documento maestro
(`iteration-01/01 - Documento Maestro - Lazarus.md`) ya cerró el _qué_ y el _porqué_: un solo MCP con una función `run_task(task)` hacia el proveedor LLM del usuario; un **Planner** interno convierte la tarea en un programa de un **DSL mínimo propio**; un **intérprete desde cero** lo ejecuta rastreando **capacidades** por valor; los datos no confiables se parsean en un **Quarantine** (LLM del usuario, sin tools, sin caché); un **motor de políticas declarativo** bloquea sinks alimentados con argumentos no confiables; un **agregador** conecta N MCPs upstream.

Este plan define el _cómo_: la arquitectura concreta para empezar a construir. El repo está **greenfield** (solo docs). Stack base ya decidido en el doc: **TypeScript end-to-end, monolito modular, zod, SDK oficial de MCP**. Se suma por decisión del usuario: **Supabase (Postgres + Auth)** y **Prisma ORM**.

**Decisiones del usuario tomadas en esta sesión (vinculantes):**

1. **UI = Vite + React SPA**, con **API Node aparte** (NO Next.js). Se mantiene la elección del doc para la UI.
2. **Gateway MCP = proceso Node de larga vida** (no Vercel serverless). Conexiones upstream persistentes + runs de 30–120s lo exigen.
3. **Upstream de la demo = MCPs mock controlados** (no Gmail real en el camino crítico).
4. **Auth = Supabase Auth** (login real, cada usuario con sus MCPs/políticas/keys).

**Cambios que esto introduce sobre el doc maestro §8:** persistencia `SQLite → Supabase Postgres`; se añade `Supabase Auth` + `Prisma`; se añade `Vercel AI SDK` para Planner/Quarantine. La UI (Vite+React) y "monolito modular" se conservan; el monolito se materializa como **un backend Node de larga vida** que sirve tanto la API REST de la UI como el endpoint MCP, más un **SPA estático** y **paquetes compartidos** en un monorepo pnpm.

---

## Topología del repo (monorepo pnpm)

Monorepo pnpm: un `pnpm install`, grafo `tsc` único (un cambio de interfaz rompe al consumidor en compilación → atrapa drift de integración), y fronteras de paquete explícitas para que 4 personas trabajen en paralelo sin merge hell. La única superficie de edición compartida es `packages/shared`, que se **congela en M0**.

```
lazarus/
  pnpm-workspace.yaml
  tsconfig.base.json
  .env.example            # LAZARUS_ENC_KEY, DATABASE_URL, DIRECT_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_JWT_SECRET
  prisma/
    schema.prisma         # modelo de datos (abajo)
    seed.ts               # escenario de demo: mailbox + mailer + correo inyectado

  packages/
    shared/               # @lazarus/shared — EL CONTRATO (congelar en M0)
      src/types/          # capability.ts, program.ts (AST), tool-catalog.ts, policy.ts, trace.ts, run.ts
      src/interfaces/     # Interpreter, ToolProvider, QuarantineClient, Planner, PolicyEngine
    interpreter/          # @lazarus/interpreter — Persona 1 (núcleo, puro, sin I/O)
      src/                # lexer.ts, parser.ts, values.ts, capabilities.ts, evaluator.ts, errors.ts
      test/               # unit tests adversariales de propagación de capacidades
    gateway/              # @lazarus/gateway — Persona 2
      src/upstream/       # connection-manager.ts (singleton de clientes MCP vivos), stdio-client.ts, http-client.ts, introspect.ts
      src/schema/         # json-schema-to-zod.ts (subset §7.4 + degradación opaca)
      src/tool-provider.ts
      src/mcp-server/     # server.ts (run_task + recurso catálogo), run-task.ts (orquesta Planner→Interp), catalog-resource.ts
    policy/               # @lazarus/policy — Persona 3
      src/                # engine.ts (default-secure), effect-classifier.ts (read/sink), defaults.ts
    llm/                  # @lazarus/llm — Persona 3
      src/                # planner.ts (+planner-prompt.ts), quarantine.ts, provider-factory.ts (AI SDK desde ModelConfig)

  apps/
    server/               # @lazarus/server — PROCESO NODE DE LARGA VIDA (Persona 2 + 4)
      src/
        main.ts           # boot: HTTP server (Hono) = API REST de la UI + transporte MCP Streamable HTTP
        mcp.ts            # monta packages/gateway/mcp-server sobre StreamableHTTPServerTransport (stateful)
        api/              # rutas REST: connections, policies, models, runs/traces (CRUD)
        auth.ts           # verifica JWT de Supabase en cada request de la UI
        db.ts             # Prisma client singleton
        crypto.ts         # AES-256-GCM (LAZARUS_ENC_KEY) — encrypt/decrypt, write-only serializer
    web/                  # @lazarus/web — Vite + React SPA (Persona 4)
      src/
        lib/supabase.ts   # @supabase/supabase-js (login + sesión)
        pages/            # connections (MCPs+keys), models (Planner/Quarantine), policies, traces/[runId]
        components/
```

**Por qué `apps/server` unifica API + MCP:** ambos son de larga vida y comparten Prisma, el pool de upstream y el crypto. El servidor MCP es solo otra ruta/transporte en el mismo backend. Esto satisface a la vez "API aparte de la UI" y "gateway = proceso Node dedicado": **dos deployables** (SPA estático `web` + backend `server`), no tres.

---

## Cómo conecta Claude y cómo viven las conexiones

- **Superficie pública:** `apps/server` expone el servidor MCP oficial (`@modelcontextprotocol/sdk`) vía **Streamable HTTP en modo stateful** (SSE está deprecado; no implementar). El usuario lo agrega en Claude como **Custom Connector remoto (URL)**. Para la demo: contenedor always-on (Railway/Fly/Render) o laptop tras un túnel público.
- **`run_task` description** corta (cómo formular tareas, requerimiento COMPLETO); el **catálogo detallado** va como **recurso MCP** `lazarus://catalog/<mcp_id>` (§6.6).
- **Upstream (agregador):** `ConnectionManager` singleton a nivel de módulo en el proceso `server`, keyed por `mcpConnectionId`. Para la demo, los upstream son **MCPs mock** (stdio child o HTTP in-process):
  - `mailbox.list_recent()` → bandeja fija con el correo inyectado.
  - `mailer.send_email(to, ...)` → sink que solo **registra** el intento (no manda nada real).
  - Lazy-init + caché del `list_tools` (catálogo = dato estructural confiable, **sí cacheable**; distinto del Quarantine §7.6). Reconexión perezosa al fallar; matar child procs en SIGTERM.

---

## Modelo de datos (Prisma / Supabase Postgres)

Supabase Auth posee la identidad en `auth.users` (Prisma no la gestiona). Cada fila Lazarus referencia `userId String` = UID de Supabase (UUID). Un `User` propio se hace upsert al primer login; las tablas FK a _nuestro_ `User`, no cruzando schema.

```prisma
model User { id String @id  // = auth UID
  email String @unique; createdAt DateTime @default(now())
  connections McpConnection[]; policies Policy[]; modelConfigs ModelConfig[]; runs Run[] }

enum McpTransport { STDIO HTTP }
model McpConnection { id String @id @default(cuid())
  userId String; user User @relation(fields:[userId],references:[id],onDelete:Cascade)
  label String; transport McpTransport; endpoint String   // URL (HTTP) o command+args JSON (STDIO)
  encryptedCreds Bytes?; credIv Bytes?; credAuthTag Bytes?  // §7.7 — clave NO está aquí (env)
  credLast4 String?                                         // único dato secreto que la UI puede ver
  catalogCache Json?; status String @default("unverified")
  policies Policy[]; @@index([userId]) }

enum ToolEffect { READ SINK }
model Policy { id String @id @default(cuid())
  userId String; user User @relation(fields:[userId],references:[id],onDelete:Cascade)
  connectionId String; connection McpConnection @relation(fields:[connectionId],references:[id],onDelete:Cascade)
  toolName String; effect ToolEffect; sensitiveArgs String[]; requireTrusted Boolean @default(true)
  @@unique([connectionId, toolName]); @@index([userId]) }

enum ModelRole { PLANNER QUARANTINE }
enum ModelProvider { ANTHROPIC OPENAI }
model ModelConfig { id String @id @default(cuid())
  userId String; user User @relation(fields:[userId],references:[id],onDelete:Cascade)
  role ModelRole; provider ModelProvider; modelId String
  encryptedKey Bytes; keyIv Bytes; keyAuthTag Bytes; keyLast4 String?   // misma regla §7.7
  @@unique([userId, role]) }

enum RunStatus { PLANNING RUNNING BLOCKED COMPLETED ERROR }
model Run { id String @id @default(cuid())
  userId String; user User @relation(fields:[userId],references:[id],onDelete:Cascade)
  task String; program String?; status RunStatus @default(PLANNING); result Json?
  createdAt DateTime @default(now()); traces TraceEvent[]; @@index([userId]) }

model TraceEvent { id String @id @default(cuid())
  runId String; run Run @relation(fields:[runId],references:[id],onDelete:Cascade)
  seq Int; kind String       // tool_call | query_ai | policy_deny | return
  toolName String?; argCaps Json   // args + capacidades — NUNCA secretos crudos
  verdict String?; ruleId String?; detail Json?; @@index([runId, seq]) }
```

`DATABASE_URL` = pooled (pgbouncer) para la app; `DIRECT_URL` = directa para migraciones. La clave de cifrado vive **solo** en `process.env.LAZARUS_ENC_KEY`, nunca en la DB. Bloquear la tabla de secretos del REST auto-generado de Supabase.

---

## Librerías más allá del doc

| Librería                              | Uso                                      | Por qué                                                                                                                                                                                                                                                                            |
| ------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@modelcontextprotocol/sdk`           | servidor MCP público + clientes upstream | Mandado por el doc. `StreamableHTTPServerTransport` (stateful), `StdioClientTransport`, `Client`, resources.                                                                                                                                                                       |
| `ai` (Vercel AI SDK)                  | Planner + Quarantine                     | `generateObject({schema})` = salida **estructurada validada por zod**, agnóstica de proveedor → exacto para `output_type` del Quarantine (§6.5) y para el programa del Planner. Modelo+key del usuario = swap de config. Falla con `NoObjectGeneratedError` tipado (retry limpio). |
| `@ai-sdk/anthropic`, `@ai-sdk/openai` | adaptadores                              | Los dos proveedores de la demo; `provider-factory.ts` elige por `ModelConfig`.                                                                                                                                                                                                     |
| `zod`                                 | mandado                                  | Fuente de verdad: JSON Schema→zod (§7.4) y schemas de salida del Quarantine.                                                                                                                                                                                                       |
| `zod-to-json-schema`                  | catálogo / prompt del Planner            | Firmas tipadas legibles para el recurso catálogo y el prompt.                                                                                                                                                                                                                      |
| `@supabase/supabase-js`               | Auth (SPA)                               | Login + sesión en el Vite SPA; el backend verifica el JWT.                                                                                                                                                                                                                         |
| `@prisma/client` + `prisma`           | DB                                       | ORM (decisión).                                                                                                                                                                                                                                                                    |
| `hono`                                | HTTP del backend                         | Ligero, TS-first; sirve API REST + monta el transporte MCP en el mismo proceso.                                                                                                                                                                                                    |
| `tsx`                                 | dev del `server` + seed                  | Ejecuta TS sin build en dev.                                                                                                                                                                                                                                                       |

**NO añadir:** caché alrededor del Quarantine (§7.6 lo prohíbe); ningún framework de agentes (LangChain etc.) — el intérprete desde cero (§7.2) es el punto; un agent loop reintroduce control-flow incontrolado. El **`json-schema-to-zod` se escribe a mano** (subset diminuto, queremos la degradación-a-opaco auditable y explícita).

---

## El intérprete (núcleo de seguridad — Persona 1)

- **Parser recursivo-descendente escrito a mano** (~150–250 líneas), no generador. Errores precisos para el bucle de reintento del Planner (§7.3). **Nunca** `eval`/`Function`.
- DSL total por construcción: sin loops/recursión/funciones (§6.7) → terminación gratis. AST: `Program = Stmt[]`; `Stmt = Assign | Return`; `Expr = ToolCall | QueryAI | Member | Index | Var | Literal`.
- Evaluador: `eval(expr, env) -> TaggedValue` donde `TaggedValue = { value, caps }`, `caps = { provenance: Set<source>, trusted: bool }`. Env = `Map<string, TaggedValue>` plano.
- **Trampas de corrección (donde se pierde la garantía) — testear adversarialmente:**
  1. **`joinCaps` "lo más restrictivo gana":** toda combinación (member, index, list/dict literal con valores tagged, source de `query_ai`) → `trusted = AND`, `provenance = UNION`. Una sola unión olvidada = hueco de exfiltración. Una función `join`, todo pasa por ella.
  2. **La salida de `query_ai` es SIEMPRE `trusted:false`**, sin importar la entrada. Hard-code.
  3. **Acceso a campo hereda a nivel objeto** (§12): `email.sender` tan no-confiable como `email`. No marcar subcampos como confiables.
  4. **Literales del Planner = confiables** (vienen de la tarea confiable); son la única fuente confiable además de la tarea. Resultados de tool / `query_ai` nunca reclasificables a confiable.
  5. **Política ANTES de la llamada con efectos, sobre caps de argumentos** (no de resultados).
  6. **Identificador/tool desconocido = error de parseo/resolución** alimentado al reintento del Planner, nunca ejecutado.

---

## Quarantine, mapeo de tipos y crypto (resumen operativo)

- **Quarantine:** `generateObject({schema})` con modelo+key del usuario instanciado por request desde `ModelConfig`. Capturar `NoObjectGeneratedError`, reintentar 1–2 veces con prompt endurecido; al fallar, devolver error **tipado y confiable** ("no se pudo extraer `list[Email]`") — una extracción mala queda _contenida_ por capacidades igualmente. **Sin caché jamás**; preferir `.nullable()` sobre `.optional()` (compat. structured-output de OpenAI).
- **Mapeo JSON Schema → tipos (allow-list estricta, resto → OPAQUE no confiable):** primitivos, `enum`, `array`, `object` con props nombradas, `nullable`/`anyOf:[T,null]`. `oneOf/anyOf` no triviales, `$ref` recursivo, `additionalProperties` dinámico → **OPAQUE**. Degradar es seguro por diseño (perder precisión nunca debilita la garantía). Un mapper, dos renderers (validador zod + firma legible para el Planner).
- **Crypto (§7.7):** AES-256-GCM, clave 32 bytes base64 en `LAZARUS_ENC_KEY`. **IV 12 bytes aleatorio por escritura** (nunca reusar). Guardar `iv || authTag || ciphertext`. `getAuthTag()`/`setAuthTag()` obligatorios. Campo **write-only**: el serializer de la API omite el secreto y devuelve solo `{configured:true, last4}` (a nivel query, no solo en React). Nunca loguear ni meter en trazas. Prefijo `keyVersion` (1 byte) para rotación futura sin migración.

---

## Reparto (4 personas) y costuras

El contrato es `@lazarus/shared` (types + interfaces). Todos codean contra interfaces; las clases concretas se enchufan. Se **congela en M0**; cambios posteriores requieren sign-off rápido del grupo.

| Persona              | Posee                                                     | Consume (solo interfaz)                                              | Produce                                                                                    |
| -------------------- | --------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **1 — Intérprete**   | `packages/interpreter`                                    | `ToolProvider`, `QuarantineClient`, `PolicyEngine` (fakes al inicio) | `Interpreter`, AST, `joinCaps`                                                             |
| **2 — Gateway/MCP**  | `packages/gateway`, `apps/server` (mcp + upstream)        | `Interpreter`, `Planner`                                             | `ToolProvider`, servidor MCP `run_task`, recurso catálogo, `ConnectionManager`, schema→zod |
| **3 — Policy + LLM** | `packages/policy`, `packages/llm`                         | tipos `ToolCall`/`Capability`, AST `Program`                         | `PolicyEngine`, `Planner`, `QuarantineClient`                                              |
| **4 — Web/datos**    | `apps/web`, `apps/server` (api+auth+db+crypto), `prisma/` | tipos `Run`/`TraceEvent`/`Policy`/`ModelConfig`                      | schema Prisma, crypto, auth Supabase, 4 pantallas, seed de demo                            |

Costuras que evitan bloqueo: P1 testea contra **fakes** in-memory (Gmail canned) — cero dependencia de 2/3. P2 compone las 3 interfaces en `run-task.ts`. P3 son funciones puras de tipos compartidos. P4 trabaja contra tipos Prisma + filas sembradas. El único dato verdaderamente cruzado es `TraceEvent` (engine escribe / UI lee) → fijar su forma en M0.

---

## Orden de construcción (milestones)

- **M0 — Espina y costuras (todos, ~1ª hora, juntos).** Scaffold pnpm + `tsconfig.base` + `.env.example`. Escribir y **congelar `@lazarus/shared`** (la hora de mayor apalancamiento). Schema Prisma + primera migración contra el proyecto Supabase compartido + seed stub.
- **M1 — Slice vertical con todo stubbeado (paralelo).** P2: `apps/server` bootea, MCP SDK sirve `run_task` → programa **hardcodeado** por el intérprete de P1 con ToolProvider/Quarantine/Policy **fake**. Meta: Claude (o MCP Inspector) llama `run_task` y recibe resultado **end-to-end** (la espina). P1: parser+evaluador+capacidades reales sobre el programa de demo. P3: `PolicyEngine` real (sink+untrusted⇒deny) + Quarantine real; Planner aún stub que devuelve el programa canónico. P4: auth + pantalla de conexiones + CRUD Prisma + seed del escenario de demo.
- **M2 — Componentes reales reemplazan stubs.** P2: `ConnectionManager` conecta los 2 MCP mock; `introspect`→catálogo tipado; `json-schema-to-zod`. P3: Planner real vía `generateObject` (NL→DSL) + bucle de validación/reintento (§7.3). P4: pantalla de trazas leyendo `TraceEvent` reales; pantallas de políticas y modelos con storage cifrado.
- **M3 — Demo (§11) y endurecimiento.** Camino completo: _"resume mis correos de hoy"_ → Planner → intérprete → Quarantine sobre el correo inyectado → `send_email(to=untrusted)` → **deny de política** → traza split-screen. Toggle "Lazarus off" (MCPs directos) para mostrar la exfiltración por contraste. Scrub de secretos en trazas/logs.

**Camino crítico:** el `run_task` stubbeado end-to-end de M1 es la espina; lo demás es swap-in. Los dos swaps de mayor riesgo: **Planner emitiendo DSL mínimo válido** (P3 — riesgo de prompt; mitigar con temperatura baja, retry cap, y **plan pre-fijado para la tarea exacta de la demo** —cachear el _plan_ de una tarea confiable está permitido §7.6—) y **introspección/mapeo de tipos upstream** (P2 — degradar a opaco es la válvula §7.4). Front-load ambos en M2.

---

## Verificación (end-to-end)

1. **Intérprete (unit):** `pnpm --filter @lazarus/interpreter test` — suite adversarial de `joinCaps` (combinaciones que deben quedar no-confiables), `query_ai` siempre no-confiable, herencia de campo a nivel objeto, rechazo de construcciones fuera del subset.
2. **Espina MCP:** levantar `apps/server`, conectar con **MCP Inspector** (`npx @modelcontextprotocol/inspector`) al endpoint Streamable HTTP; llamar `run_task("resume mis correos de hoy")` y leer el recurso `lazarus://catalog/<mcp_id>`.
3. **Crypto:** test de round-trip encrypt/decrypt; verificar que el endpoint de la API de conexiones nunca devuelve el secreto (solo `last4`), revisando el payload de red.
4. **Política (el corazón de la demo):** con el seed del correo inyectado, confirmar que `mailer.send_email(to=<no confiable>)` produce `policy_deny` con `ruleId`, mientras el resumen se entrega; ver el `TraceEvent` correspondiente.
5. **Demo completa:** Claude (o Inspector) conectado **solo** al MCP de Lazarus → tarea legítima → split-screen rojo (intento bloqueado) vs verde (resumen limpio) con la traza de data-flow. Toggle off muestra la exfiltración contra el mismo mock.
6. **Lint/build:** `pnpm -r build` (grafo tsc unificado) y `pnpm -r lint` verdes.
