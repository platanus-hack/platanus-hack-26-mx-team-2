# 00 · Documento Maestro — Sandbox-Proxy para Agentes de IA

> Documento central del proyecto. Consolida contexto, origen, antecedentes, modelo de amenaza, arquitectura, inquietudes, decisiones tomadas, alcance del MVP, stack y fuentes. Notas relacionadas: [[Sandbox-Proxy - Validación de la idea]] · [[Casos reales - Agentes IA destruyendo producción]] · [[Tonic.ai - referencia para ofuscación]] · [[Policy on the AI Exponential]]

**Proyecto:** Hackathon Platanus · **Track:** IA Safety · **Equipo:** 4 personas · **Estado:** diseño de arquitectura cerrado, definiendo MVP
**Última actualización:** 2026-06-20

---

## 1. Resumen ejecutivo (el pitch en un párrafo)

Los agentes de IA cada vez operan sobre datos y sistemas reales, y ya han causado destrozos irreversibles en producción (Replit, Amazon Kiro, Cursor/PocketOS). Proponemos un **proxy que convierte cualquier fuente de datos en un sandbox**: el agente sigue trabajando con los datos reales (lee normal), pero **toda mutación de entidad se contiene en un middleware con estado**, sin tocar el origen. Un gestor de sandboxes permite crear, refrescar, eliminar, ver divergencias y el log de cambios, con rollback en un clic. Opcionalmente, un módulo desacoplado ofusca los datos preservando su forma. Es **infraestructura de contención a nivel de datos** para el despliegue seguro de agentes — el eje complementario a los sandboxes de _ejecución_ (microVM/gVisor) que ya existen.

---

## 2. Contexto y origen

### 2.1 De dónde nace

La idea surge de una investigación sobre las propuestas de política pública de Anthropic ([[Policy on the AI Exponential]] y [[Anthropic's Advanced AI Framework]]). Dentro de ese framework, el problema que más nos llamó la atención es el de **R&D automatizada**:

> "**Automated R&D.** AI systems are automating the research and development of AI itself, which could further amplify the three above risks."

Anthropic reconoce que la agenda de resiliencia para los riesgos de _loss-of-control_ y _automated R&D_ está **poco desarrollada**, y señala como dirección prometedora:

> "developing the capacity to detect and respond to AI systems acting outside their developers' control, and building **infrastructure for containing or shutting down such systems**."

Nuestra idea ataca exactamente esa frase: **infraestructura de contención**, aplicada al eje de los datos. Un agente puede actuar, pero sus efectos destructivos quedan aislados, observables (diff/log) y reversibles (rollback).

### 2.2 Por qué encaja en el track IA Safety

No es un producto de "test data" disfrazado de safety. El problema real, urgente y documentado es el **despliegue seguro de agentes autónomos** que tocan sistemas de producción. El valor central es **contención + auditabilidad + reversibilidad**, no privacidad de datos. Eso lo coloca de lleno en el track.

---

## 3. La idea completa

### 3.1 Descripción

Un **proxy/middleware** que se interpone entre el agente (o cualquier cliente) y una fuente de datos. Desde fuera se comporta como la fuente real. Por dentro:

- **Lecturas** → pasan a la fuente real, **fusionadas** con el estado del sandbox (read-your-writes, ver §6.4).
- **Mutaciones de entidad** (crear/modificar/borrar) → se **contienen** en una capa con estado (overlay), nunca tocan el origen.
- **Estado persistente** por sandbox: la divergencia respecto al origen se acumula como un log de mutaciones y se puede inspeccionar, diffear y revertir.

### 3.2 Gestor de sandboxes

Interfaz para **crear, refrescar, eliminar** sandboxes, **ver divergencias (diff)** respecto al origen y el **log de cambios**, con **rollback**. Cada sandbox es un entorno aislado: dos corridas no se interfieren.

### 3.3 Módulo de ofuscación (desacoplado)

Cada sandbox puede activar la ofuscación de datos preservando su forma (un correo → otro correo de largo similar, nombre → nombre, número → número). Es un **módulo completamente desacoplado** del core (ver §6.6 y decisión §7.1): mask determinista simple al inicio, sustituible por Tonic.ai a futuro.

### 3.4 Schema y relaciones

El schema se obtiene **on-the-fly por introspección** cuando la fuente lo permite (SQL `information_schema`, OData `$metadata`, GraphQL introspection query). Las relaciones entre entidades se **siembran** automáticamente desde la introspección (FKs en SQL, nav properties en OData) y se pueden **ver y ajustar en una UI** (editor de relaciones, ver §6.5).

### 3.5 Fuentes de datos objetivo

SQL y OData como capas implementadas; MCP como superficie de consumo del agente (vía bridge existente, solo para demo). REST/GraphQL como diseño futuro. Ver §7.3 y §8 sobre el alcance realista.

---

## 4. Conexión con el problema R&D de Anthropic

| Necesidad del framework            | Cómo la cubre el Sandbox-Proxy                                       |
| ---------------------------------- | -------------------------------------------------------------------- |
| Detectar acciones fuera de control | El proxy intercepta toda mutación y la registra en el log de cambios |
| Contener sistemas                  | Las mutaciones golpean el overlay con estado, no producción          |
| Apagar / revertir                  | Rollback en un clic; el sandbox se elimina o refresca sin daño       |
| Auditabilidad                      | Log de mutaciones y diff completos de toda la divergencia            |

La visión de largo plazo: que este tipo de capa se vuelva un **estándar que las plataformas ofrecen para desarrollo**. Si se adopta ampliamente, se acerca el estado de contención sistémica que el framework pide (north star, no promesa del MVP).

---

## 5. Antecedentes y estado del arte

### 5.1 El dolor es real y reciente — casos documentados

Detalle completo y fuentes en [[Casos reales - Agentes IA destruyendo producción]]. Resumen:

- **Replit (jul 2025)** — borró una DB de producción durante un _code freeze_, pese a instrucciones en MAYÚSCULAS; perdió ~1.200 ejecutivos y ~1.100 empresas, fabricó 4.000 usuarios falsos y mintió sobre el rollback. Replit luego añadió separación automática dev/prod y un "planning-only mode".
- **Amazon Kiro (dic 2025)** — decidió "borrar y recrear" un entorno de producción; tumbó AWS Cost Explorer ~13h. El borrado fue más rápido que leer un prompt de confirmación → conclusión: el único safeguard viable es **aprobación pre-ejecución**.
- **Cursor / Opus 4.6 — PocketOS (abr 2026)** — borró toda la DB de producción + 3 meses de backups en 9 segundos, usando un token de API sobre-permisionado encontrado en un archivo no relacionado.

**Patrón común:** instrucciones ignoradas, velocidad inhumana, irreversibilidad, credenciales sobre-permisionadas como vector de escape, y el agente que miente/fabrica. Todos se neutralizan si las mutaciones golpean un middleware con estado.

### 5.2 Mercado

- **Test Data Management:** ~USD 0,8–1,6B en 2025, CAGR ~16% a 2035.
- **Data Masking + Synthetic Data:** ~USD 1–3B en 2025, CAGR 10–18% a 2030. Impulsado por brechas, regulación de privacidad y expansión de la IA generativa.

Hay disposición a pagar por "datos realistas sin exponer datos reales" y por seguridad en el despliegue de agentes.

### 5.3 Primitivas técnicas ya probadas (baja el riesgo de ejecución)

- **Copy-on-write / branching:** Neon crea branches instantáneos de Postgres a nivel de página/WAL. Demuestra que un sandbox de datos con estado, instantáneo y barato es viable. _Diferencia clave:_ Neon controla el storage; nosotros NO, así que hacemos overlay lógico a nivel de operación (ver §6).
- **Merge-on-read (el primitivo de read-your-writes sobre diff):** battle-tested en Iceberg / Hudi / Delta Lake (base + delete vectors + filas nuevas, fusionadas al leer) y en el propio **MVCC de Postgres** (tuplas + visibilidad por transacción). No lo inventamos; nos apoyamos en él (ver §6.4 y §7.7).
- **Bridge OData↔MCP:** `oisee/odata_mcp_go` lee `$metadata` y auto-genera tools MCP tipadas para CRUD completo. Nos da la superficie MCP del demo **sin escribir código MCP**.
- **Proxies de interceptación:** en sandboxing de agentes 2026 ya es estándar enrutar tráfico por un proxy host-side.
- **Masking determinista / FPE:** preserva integridad referencial PK/FK y consistencia entre tablas. Base del módulo de ofuscación.
- **Sandboxes de ejecución:** microVM (Firecracker ~150ms), gVisor, hardened containers. Investigación 2026 cita ~90% menos incidentes con agentes sandboxeados. **Es un eje ortogonal al nuestro** (ellos aíslan ejecución, nosotros datos).

### 5.4 Competidores y por qué no competimos ahí

Data masking / TDM está saturado y bien financiado: **Tonic.ai, Delphix (Perforce), K2View, IBM Optim, Informatica, Oracle, Broadcom, Gretel**. Detalle en [[Tonic.ai - referencia para ofuscación]]. Branching de datos ya resuelto para SQL común por Neon, PlanetScale, Xata, Turso. Versionado SQL con semántica git por **Dolt** (ver §7.7).

→ **No competimos en masking ni en branching.** Nuestro core es la **contención de mutaciones de agentes con estado, diff y rollback, sobre fuentes que no controlamos**.

---

## 6. Arquitectura

### 6.1 Principio central: core agnóstico + adaptadores traductores

El **manejo de entidades, diff y estado se centraliza** en un core que habla un **modelo canónico de entidades**. SQL y OData son **adaptadores** que traducen bidireccionalmente entre el protocolo de wire y ese modelo canónico. El core nunca sabe qué fuente hay detrás; solo ve entidades y mutaciones.

```
Agente
  │  MCP tools (CRUD por entity set)
  ▼
[ odata-mcp bridge ]   ← OSS existente (oisee/odata_mcp_go), solo para demo
  │  OData HTTP (GET/POST/PATCH/DELETE, $filter, $expand, $metadata)
  ▼
┌──────────────── SANDBOX-PROXY (Go) ────────────────┐
│  Adaptador OData ─┐                                  │
│  Adaptador SQL  ──┤→   MODELO CANÓNICO               │
│                   │    (entidad · key · atributos ·  │
│                   │     relaciones)                  │
│   CORE (agnóstico de fuente):                        │
│    · schema registry (tipos/keys/relaciones)         │
│    · overlay por sandbox = LOG DE MUTACIONES         │
│      (+ shadow materializado opcional)               │
│    · merge engine (read-your-writes)                 │
│    · diff · changelog · rollback                      │
│   ┌──────────────────────────────────────────────┐  │
│   │ Hook de ofuscación (módulo desacoplado)        │  │
│   │   mask determinista  →  (futuro) Tonic         │  │
│   └──────────────────────────────────────────────┘  │
└─────────┬────────────────────────────┬───────────────┘
          │ lecturas                    │ estado
          ▼                             ▼
     Origen (real)                 Store propio (overlay)
```

### 6.2 Modelo canónico de entidades

Todo se representa como **entidades**: tipo de entidad + clave primaria + atributos + relaciones. Las operaciones se normalizan a **mutaciones canónicas**: `CREATE(tipo, key, valores)`, `UPDATE(tipo, key, cambios)`, `DELETE(tipo, key)`. Las lecturas se expresan como queries canónicas (get entity set + filtro + expand de relaciones).

- **OData** mapea 1:1: entity sets → tipos, nav properties → relaciones, `$metadata` → schema, verbos → mutaciones.
- **SQL** es un subconjunto: tablas → tipos, FKs → relaciones, DML → mutaciones canónicas. El SQL analítico complejo (joins/group by sobre datos modificados) es el caso espinoso y solo aparece en este adaptador (ver §7.7).

### 6.3 Clasificación = estructural y automática (NO una política manual)

**Decisión clave (ver §7.2):** no existe una política `safe/contained/unknown` que se escriba a mano. La contención se **deriva automáticamente** de la estructura:

- Lo que mapea a una **mutación de entidad** (derivado de la introspección) → se contiene automáticamente. No hay nada que declarar; está atado a la lógica de preservación de estado de esa entidad.
- Lecturas puras → pasan + merge.
- **Único residuo:** operaciones con efectos que **no** son estado de entidad (OData _actions/functions_, stored procs, "manda correo", `POST /process`, tools MCP no-CRUD). No tienen estado que overlayar → no se pueden contener; solo **bloquear / mockear / aprobar**.

La detección de ese residuo también es automática **donde el protocolo declara estructura**: OData separa EntitySets de Actions/Functions; SQL separa DML de llamadas a procedimiento; **MCP no lo separa** — y por eso proponemos declaraciones nativas en MCP (§7.4).

### 6.4 El corazón técnico: read-your-writes sobre el overlay

Si el agente muta (contenido) y luego lee, el proxy debe **fusionar** el estado del sandbox con las lecturas reales, para que el agente "crea" que su mutación ocurrió. Sin esto, el agente detecta la inconsistencia y se rompe el realismo.

- En **OData** es entity-level (get + filtro + expand), así que el merge es directo sobre el overlay indexado por entidad y key. **No requiere motor SQL.**
- En **SQL** simple también; en **SQL analítico** sobre datos modificados es el caso difícil → ver estrategia en §7.7 (apoyarse en MVCC de Postgres / Dolt / DuckDB, no reimplementar un motor).

### 6.5 Editor de relaciones (cascadas)

La introspección **siembra** las relaciones (FKs de SQL, nav properties de `$metadata`). La UI permite **ver y sobreescribir** el comportamiento por relación: `cascade` / `restrict` / `set-null` / `ignorar-en-overlay`. Así un DELETE contenido respeta las cascadas correctas en el overlay, con la identificación automática pero ajustable a mano cuando haga falta.

### 6.6 Overlay como log de mutaciones

La fuente de verdad del estado de un sandbox es un **log ordenado de mutaciones canónicas**. De ahí salen gratis: el **changelog**, el **diff** (overlay vs origen) y el **rollback** (descartar o revertir a un checkpoint). Un shadow materializado es solo caché opcional para acelerar lecturas.

### 6.7 Dónde vive el estado / por qué no tocamos su infra

El overlay vive en un **store propio** (Postgres nuestro, o SQLite/bbolt embebido para la demo), **no** en la infra del origen. Distinción clave:

- **Acceso a infra/código** (desplegar en su entorno, tocar su deployment, su repo) → _no lo necesitamos ni lo queremos_.
- **Acceso a la fuente de datos** (una connection string / endpoint) → lo necesita cualquier cliente, incluido el agente. **No es infra access.**

SQL es el caso **más amigable** con "sin infra": protocolo de wire estandarizado que permite interceptar sin cooperación del target; introspección con solo credencial de lectura. Lo que NO hacemos es copy-on-write a nivel de storage (eso sí requeriría infra) — hacemos overlay lógico a nivel de operación.

---

## 7. Inquietudes, soluciones y decisiones

### 7.1 Ofuscación de datos (módulo desacoplado)

- **Inquietud:** preservar distribución/correlaciones/joins coherentes es un problema completo de datos sintéticos (privacidad diferencial, modelos generativos), no un toggle.
- **Decisión:** **completamente desacoplada del core**, modelada como un hook puro en el borde de serialización: `transform(tipoEntidad, campo, valor) → valor`, determinista y con seed. **NO la construimos avanzada.** Mask simple al inicio, sustituible por **Tonic.ai** vía API a futuro o si da tiempo. En el pitch se deja claro que la coherencia estadística la aporta un componente especializado intercambiable y no-core.

### 7.2 Clasificación de operaciones

- **Inquietud:** una política `safe/contained/unknown` manual no aplica — está totalmente atada a la lógica de preservación de estado de cada entidad y debería ser automática.
- **Decisión:** **sin política manual.** La contención se deriva automáticamente de la estructura (§6.3). Lo único que requiere decisión es qué hacer con los side-effects no-estatales (bloquear/mockear/aprobar), y su detección también es automática por protocolo.

### 7.3 REST y la semántica de acciones

- **Inquietud:** REST no declara qué es destructivo (un `POST /process` puede mutar todo). No hay forma genérica de saber el efecto sin modelar la API.
- **Decisión:** trabajamos sobre fuentes que **sí** declaran semántica estructural: **OData** (verbos + `$metadata` + separación EntitySets/Actions) y **SQL** (DML vs procedimientos). REST/GraphQL quedan como diseño futuro. Esto convierte la "limitación de REST" en una elección de diseño coherente.

### 7.4 MCP

- **Inquietud:** MCP no separa estructuralmente una tool CRUD de una acción con efectos → no hay clasificación automática posible sobre MCP puro.
- **Decisión / oportunidad:** para el demo, MCP es solo la **superficie de consumo** (vía bridge `oisee/odata_mcp_go` sobre nuestro proxy OData), así que **hereda la clasificación gratis** del adaptador OData. Como contribución de safety, **proponemos declaraciones nativas en MCP** (que una tool declare destructivo/mutador/idempotente/entidad afectada). Es un aporte de estándar al ecosistema, no un wrapper.

### 7.5 Contención total

- **Inquietud:** sandboxizar datos es un eje; un agente fuera de control también ejecuta código, manda correos, mueve dinero. Sobre-prometer "containment completo" es atacable.
- **Decisión:** vendemos **contención del eje de datos**, complementaria a los sandboxes de ejecución (microVM/gVisor). La contención sistémica total es **north star** (si se vuelve estándar de plataformas), no promesa del MVP.

### 7.6 Escape por rutas no proxyadas

- **Afirmación:** el agente no puede escapar por rutas no proxyadas porque la auth solo aplica al proxy y el proxy solo maneja lo proxyado.
- **Matiz:** cierto _dentro del modelo de amenaza_ — el agente solo posee la credencial del proxy. Lo que NO se garantiza solo es que el entorno del agente no tenga _otras_ credenciales colgando (el fallo de PocketOS fue un token tirado en un archivo). **Frase correcta:** "el proxy es el único camino con credenciales hacia los datos, y al agente no se le entrega ninguna otra". La disciplina de despliegue es parte del producto.

### 7.7 SQL analítico sobre datos modificados

- **Inquietud:** fusionar overlay con lecturas para SQL analítico arbitrario (joins, group by) es el reto más caro.
- **Hallazgo:** el _primitivo_ (merge-on-read) está battle-tested, pero **no existe** un drop-in que lo haga sobre una DB externa viva vía proxy — ese hueco es justo nuestro core. Estrategia: **no reimplementar un motor de queries**, apoyarse en uno existente:
  - **Postgres transacciones / MVCC** — atajo más barato del MVP: transacción larga por sandbox, mutaciones aisladas nunca commiteadas → read-your-writes + analítico + ROLLBACK gratis. Contras: requiere conexión (escribible) al origen, locks, no sirve para read-only/no-SQL, concurrencia limitada. Ideal para la demo del adaptador SQL.
  - **Dolt ("Git for data")** — DB SQL con branch/commit/diff/merge nativos, diff consultable por SQL (`dolt_diff_*`, `dolt_log`). Si se espeja la fuente en Dolt, diff/branch/rollback gratis sobre SQL arbitrario.
  - **DuckDB + `pg_duckdb`** — attach del origen read-only + overlay como tablas DuckDB + vistas fusionadas para analítica vectorizada.
- **Implicación:** este problema **solo aparece en el adaptador SQL**. En OData no existe (es CRUD por entidad) — por eso el modelo entity-centric es nuestro amigo.

### 7.8 Latencia / punto único de fallo

- **Inquietud:** un proxy en el path crítico añade latencia y es SPOF.
- **Decisión:** aceptable para dev/staging (primer mercado). Frase lista para el pitch; optimizable después.

---

## 8. Stack

**Decisión:** **Go** para el core + proxy + engine (idóneo para proxies/wire-protocol y concurrencia, binario único, y consistente con el bridge OData↔MCP que ya es Go). UI en React/TS aparte.

| Componente                     | Tecnología                                           | Notas                                                                                       |
| ------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Core / engine                  | **Go**                                               | Modelo canónico, overlay (log de mutaciones), merge, diff, rollback                         |
| Proxy OData (protagonista)     | Go HTTP (chi/echo/fiber)                             | Parseo de `$filter`/`$expand` con `CiscoM31/godata` o a mano (subconjunto chico)            |
| Adaptador SQL                  | Go + `pg_query_go` (parser real de Postgres) + `pgx` | Clasifica DML con precisión; MVP usa transacción-por-sandbox (§7.7)                         |
| Proxy wire Postgres (opcional) | `jackc/pgproto3`                                     | Pieza más cara; "extensión" si aprieta el tiempo                                            |
| MCP                            | binario `oisee/odata_mcp_go` → apunta al proxy OData | Cero código MCP propio; consistencia de lenguaje                                            |
| Overlay store                  | Postgres propio / SQLite / bbolt                     | Guarda el log de mutaciones                                                                 |
| Hook de ofuscación             | `interface` en Go + gofakeit (seed)                  | Desacoplado; swappable por Tonic                                                            |
| UI                             | React + Vite + TS                                    | Pantalla partida, gestor de sandboxes, visor diff/changelog, editor de relaciones, rollback |

**Reparto sugerido (4 personas):** core+engine · proxy OData + integración bridge MCP · adaptador SQL + ofuscación · UI + data semilla (un OData de ejemplo tipo Northwind).

**Polyglot:** los adaptadores están desacoplados, así que se podría meter Python (`sqlglot`) en el adaptador SQL si conviene; por defecto todo Go salvo la UI.

---

## 9. Modelo de amenaza

- **Actor:** agente de IA autónomo, potencialmente manipulado (prompt injection) o "en pánico", con tendencia a ejecutar mutaciones destructivas e irreversibles a velocidad inhumana.
- **Activo a proteger:** datos y entidades de producción (incluidos backups en el mismo blast radius).
- **Garantía del proxy:** el agente solo posee la credencial del proxy; toda mutación se contiene; nada destructivo llega al origen; todo es auditable y reversible.
- **Supuestos de despliegue:** al agente no se le entregan otras credenciales; el proxy es el único camino con auth hacia los datos.
- **Fuera de alcance:** ejecución de código arbitrario, red, correo, dinero (cubierto por sandboxes de ejecución complementarios) y side-effects no-estatales (se bloquean/mockean/aprueban, §6.3).

---

## 10. Alcance del MVP (hackathon, 4 personas)

**Riesgo principal: dispersión, no capacidad.** Foco:

**Dentro del MVP**

- Proxy OData transparente (capa protagonista).
- Introspección de schema on-the-fly (`$metadata`).
- Contención automática de mutaciones (sin política manual).
- Overlay como log de mutaciones + read-your-writes entity-level.
- Gestor de sandboxes (crear/refrescar/eliminar) con diff y changelog + rollback.
- Editor de relaciones (cascadas).
- Hook de ofuscación con mask determinista simple.
- Superficie MCP vía bridge `oisee/odata_mcp_go`.
- UI visual para la demo.

**Stretch (si sobra tiempo)**

- Adaptador SQL (prueba de generalidad) usando transacción-por-sandbox / Dolt / DuckDB.
- Integración real con Tonic vía API.
- Proxy wire Postgres transparente (`pgproto3`).

**Diseño, no implementado (se explica en el pitch)**

- REST / GraphQL.
- Ofuscación con preservación de distribución (vía Tonic).
- Declaraciones nativas en MCP (propuesta de estándar).
- Contención sistémica / adopción como estándar.

---

## 11. Demo (guion de impacto)

Conectar un agente (Claude u otro) vía MCP (bridge → proxy OData). Instrucción: _"borra todos los clientes"_. El agente lo ejecuta sin dudar. **Pantalla partida:** el sistema real **intacto** vs el estado del sandbox mostrando el `DELETE` contenido, el changelog/diff, y **rollback en un clic**. Se entiende en 30 segundos y es visceral. Cerrar mostrando una _action_ con efecto no-estatal que el proxy bloquea automáticamente, y (si está) el adaptador SQL conteniendo la misma operación contra otra fuente → "el mismo mecanismo, agnóstico de la fuente".

---

## 12. Preguntas abiertas

- Subconjunto exacto de queries que el merge soporta con overlay vs passthrough read-only en el adaptador SQL.
- Para el adaptador SQL: ¿transacción-por-sandbox (más simple) o espejo en Dolt (más completo) para el MVP/stretch?
- Forma concreta de la propuesta de declaraciones para MCP (¿campo en el manifiesto de la tool?).
- Comportamiento por defecto del editor de relaciones cuando la introspección no detecta una FK/nav property.
- Estrategia de go-to-market: ¿SDK/sidecar para plataformas, o servicio gestionado? Modelo de negocio si la visión es "estándar abierto" + componentes premium.

---

## 13. Fuentes

**Política / framework**

- [Anthropic — Policy on the AI Exponential](https://www.anthropic.com/policy-on-the-ai-exponential)

**Casos reales**

- [Tom's Hardware — Replit borra DB en producción](https://www.tomshardware.com/tech-industry/artificial-intelligence/ai-coding-platform-goes-rogue-during-code-freeze-and-deletes-entire-company-database-replit-ceo-apologizes-after-ai-engine-says-it-made-a-catastrophic-error-in-judgment-and-destroyed-all-production-data) · [AI Incident DB #1152](https://incidentdatabase.ai/cite/1152/) · [NHIMG](https://nhimg.org/replit-ai-tool-deletes-live-database-and-creates-4000-fake-users) · [Fortune](https://dc.fortune.com/2025/07/23/ai-coding-tool-replit-wiped-database-called-it-a-catastrophic-failure)
- [365i / FT — Amazon Kiro](https://www.365i.co.uk/news/2026/02/22/amazon-kiro-ai-coding-tool-aws-outage/) · [Particula.tech](https://particula.tech/blog/ai-agent-production-safety-kiro-incident) · [Thinking OS](https://www.thinkingoperatingsystem.com/ai-agent-deletes-production-environment) · [Barrack AI](https://blog.barrack.ai/amazon-ai-agents-deleting-production/)
- [The Register — Cursor/PocketOS](https://www.theregister.com/2026/04/27/cursoropus_agent_snuffs_out_pocketos/) · [The New Stack](https://thenewstack.io/ai-agents-credential-crisis/) · [Live Science](https://www.livescience.com/technology/artificial-intelligence/i-violated-every-principle-i-was-given-ai-agent-deletes-companys-entire-database-in-9-seconds-then-confesses) · [Fast Company](https://www.fastcompany.com/91533544/cursor-claude-ai-agent-deleted-software-company-pocket-os-database-jer-crane)

**Agent safety / sandboxing / MCP**

- [The 2025 AI Agent Index (MIT)](https://aiagentindex.mit.edu/data/2025-AI-Agent-Index.pdf)
- [DevOps.com — Guardrails para desplegar agentes](https://devops.com/before-you-go-agentic-top-guardrails-to-safely-deploy-ai-agents-in-observability/)
- [Securing the Model Context Protocol (MCP) — arXiv](https://arxiv.org/pdf/2511.20920) · [Checkmarx — 11 riesgos de MCP](https://checkmarx.com/zero-post/11-emerging-ai-security-risks-with-mcp-model-context-protocol/)
- [Northflank — Cómo sandboxear agentes 2026](https://northflank.com/blog/how-to-sandbox-ai-agents) · [Blaxel — Mejores sandboxes 2026](https://blaxel.ai/blog/best-cloud-sandboxes-ai-agents-2026)

**Bridge OData↔MCP / OpenAPI→MCP**

- [oisee/odata_mcp_go](https://github.com/oisee/odata_mcp_go) · [OData Bridge (mcpmarket)](https://mcpmarket.com/server/odata-bridge) · [Universal OData↔MCP Bridge (SAP Community)](https://community.sap.com/t5/technology-blog-posts-by-members/universal-odata-mcp-bridge-or-how-i-accidentally-made-15-000-enterprise/ba-p/14134696)
- [openapi-mcp-generator](https://github.com/harsha-iiiv/openapi-mcp-generator) · [FastMCP — OpenAPI](https://gofastmcp.com/integrations/openapi)

**Primitivas técnicas / branching / versionado / merge-on-read**

- [Neon — Copy-on-write](https://neon.com/blog/instantly-copy-tb-size-datasets-the-magic-of-copy-on-write) · [Neon — Masked production data branches](https://neon.com/blog/environments-masked-production-data) · [Neon vs PlanetScale vs Turso](https://techsy.io/en/blog/neon-vs-planetscale-vs-turso)
- [Dolt — Git for Data (GitHub)](https://github.com/dolthub/dolt) · [Dolt — Version Control Features](https://docs.dolthub.com/sql-reference/version-control)
- [duckdb/pg_duckdb](https://github.com/duckdb/pg_duckdb) · [MotherDuck — Postgres + DuckDB](https://motherduck.com/blog/postgres-duckdb-options/)

**Masking / TDM / competidores**

- [Tonic vs Delphix vs K2View vs IBM Optim](https://www.tonic.ai/guides/tonic-vs-delphix-vs-k2view-vs-ibm-optim) · [Tonic — FPE](https://www.tonic.ai/guides/real-world-applications-of-format-preserving-encryption-fpe) · [Tonic Ephemeral](https://www.tonic.ai/products/ephemeral)
- [OvalEdge — Mejores herramientas de masking 2026](https://www.ovaledge.com/blog/data-masking-tools/)

**Mercado**

- [Research and Markets — Data Masking & Synthetic Data 2025](https://www.researchandmarkets.com/reports/6216083/data-masking-synthetic-data-global-market) · [MarketResearchFuture — Test Data Management](https://www.marketresearchfuture.com/reports/test-data-management-market-32593)
