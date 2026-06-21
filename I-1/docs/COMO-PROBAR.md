# Cómo probar el demo de Ikarus

Guía paso a paso para verificar que Ikarus funciona. Pensada para retomar el proyecto en frío.

## 0. Requisitos

- Python 3.11+ (probado con 3.12).
- Dependencias: `openai`, `pydantic>=2`, `rich`, `pytest`.

> IMPORTANTE: el prototipo vive bajo `I-1/`. TODOS los comandos se corren **desde dentro de
> `I-1/`** (tanto `pytest` como `python3 -m ikarus ...`).

```bash
cd /Users/gabriels/Proyectos/Platanus/CAMEL/I-1
pip install -e .          # instala el paquete ikarus + dependencias
```

Si `rich`/`openai` no estuvieran: `pip install "rich>=13" "openai>=1.0" "pydantic>=2" pytest`.

## 1. Correr los tests (no necesita LM Studio)

Desde `I-1/`:

```bash
python3 -m pytest -q
```

**Esperado:** `82 passed`. Puede salir UN warning de `pytest-asyncio` — es del entorno
(plugin global), no es del proyecto. Ignóralo.

## 2. Correr el demo completo en modo mock (no necesita LM Studio)

Esto es lo que se muestra al jurado. 100% determinista.

```bash
python3 -m ikarus --scene all --scenario email --mock
```

**Qué debes ver:**
- **Escena 1:** tabla "Ikarus — Taint Ledger" con `send_email` → `PASS` → `VERDICT: ALLOWED`.
  (La inyección del inbox NO aparece: el P-LLM nunca la vio.)
- **Escena 2:** tabla con `s1 source` UNTRUSTED, `s2 extract` (Q-LLM) UNTRUSTED, `s3 sink`
  `BLOCK BLOCKED: sensitive arg 'to' of send_email is UNTRUSTED (provenance: q_llm)`
  → `VERDICT: BLOCKED`.
- **Escena 3:** `NAIVE AGENT sent to: attacker@evil.com (hijacked=True)` + el log del sink mock.

> Cada escena debe imprimirse UNA sola vez. Si ves cada tabla duplicada, se rompió el fix de
> `tui.py` (debe usar `Console(file=io.StringIO())`).

### Variantes útiles

```bash
python3 -m ikarus --scene 2 --scenario email --mock     # solo la escena del bloqueo por taint
python3 -m ikarus --scene all --scenario pdf  --mock     # el escenario del PDF con inyección oculta
```

### Chequeo rápido (one-liners de verificación)

```bash
# "Taint Ledger" debe aparecer 2 veces en --scene all (escena 1 + 2; la 3 no tiene tabla)
python3 -m ikarus --scene all --scenario email --mock 2>/dev/null | grep -c "Taint Ledger"   # -> 2
# La escena 2 debe bloquear
python3 -m ikarus --scene 2 --scenario email --mock 2>/dev/null | grep -c "BLOCKED"           # -> >=1
# La escena 3 debe exfiltrar
python3 -m ikarus --scene 3 --scenario email --mock 2>/dev/null | grep -c "attacker@evil.com" # -> >=1
```

## 3. Probar el modo `--live` contra LM Studio (híbrido) — YA FUNCIONA

Antes solo se validaba el modo mock; ahora `--live` corre de verdad contra el modelo. Solo el
**P-LLM** (el planificador) corre contra el modelo; el **Q-LLM** sigue siendo un mock
determinista incluso en `--live` (la Escena 2 es 100% determinista). Pasos:

1. Abre **LM Studio** y arranca el servidor OpenAI-compatible en `http://localhost:1234/v1`.
2. Carga un modelo. Los que funcionan bien como planificador:
   - `google/gemma-3-12b`
   - `openai/gpt-oss-20b`
   - `google/gemma-3-27b`

   Apunta `IKARUS_MODEL` al id que muestre LM Studio (puede venir con prefijo):

```bash
export IKARUS_MODEL="google/gemma-3-12b"       # ajusta al id real que muestre LM Studio
# opcionales: export IKARUS_BASE_URL="http://localhost:1234/v1"
python3 -m ikarus --scene 1 --scenario email --live
```

**Qué esperar:** en Escena 1 el plan lo emite el modelo real.

### Modelos de razonamiento (Qwen3, DeepSeek-R1, …)

También funcionan ahora. El cliente les da más tokens y, cuando el modelo "piensa" y mete el
plan dentro del razonamiento, rescata el JSON del campo `reasoning_content`. Se puede ajustar
con:

```bash
export IKARUS_MAX_TOKENS=2048              # tope general de tokens de salida
export IKARUS_REASONING_MAX_TOKENS=8192    # tope extra para modelos de razonamiento
```

### Fallback elegante (sin crash)

Si un modelo emite un plan inválido, Ikarus cae al plan canónico y verás:

```
[note] P-LLM unavailable/invalid — used canonical fallback plan.
```

El demo sigue funcionando (la garantía la da el intérprete, no el modelo). Los modelos de
razonamiento a veces caen en este fallback; es esperado y no rompe nada.

### Chequeo rápido (y su trampa)

```bash
python3 -m ikarus --scene 1 --scenario email --live 2>&1 | grep -q "fallback" && echo "uso fallback" || echo "uso modelo real"
```

> Cuidado: este one-liner puede engañar. Si hay un **crash**, el error va a stderr SIN la
> palabra "fallback", así que el grep diría "uso modelo real" cuando en realidad reventó.
> Mejor mira la salida completa: si NO aparece ninguna línea `[note]`, corrió contra el modelo
> real de verdad.

> Nota honesta: la Escena 2 SIEMPRE usa el plan "subvertido" (defensa en profundidad) y el Q-LLM
> es mock incluso en `--live`. Ver `docs/HONESTY.md`.

## 4. Probar envío de correo real (Resend)

Hay **dos interruptores independientes**:

- `--mock` / `--live`: controla **solo el P-LLM** (el planificador).
- `IKARUS_SINK` (`mock` por defecto | `resend`): controla **el envío real de correo**.

Se pueden combinar: `--mock` (plan determinista) + `IKARUS_SINK=resend` (correo real). Es la
combinación recomendada para probar el envío sin depender del modelo.

### Variables de entorno

```bash
export IKARUS_SINK=resend
export RESEND_API_KEY="re_..."                       # tu API key de Resend
export IKARUS_EMAIL_FROM="onboarding@resend.dev"     # remitente sandbox de Resend
export IKARUS_TRUSTED_RECIPIENT="tu@correo"          # destinatario legítimo
export IKARUS_ATTACKER_ADDR="tu+attacker@correo"     # el "atacante" = tu propio inbox
export IKARUS_ALLOWED_RECIPIENTS="tu@correo,tu+attacker@correo"   # allowlist dura
```

> Nota sobre el remitente: `onboarding@resend.dev` es el sandbox de Resend y **solo entrega al
> dueño de la cuenta**. Para enviar a otras direcciones tienes que verificar un dominio propio.

> `IKARUS_ALLOWED_RECIPIENTS` es una allowlist dura: cualquier destinatario fuera de la lista se
> **rechaza** y nunca se envía.

### Smoke test del sink

```bash
python3 -m ikarus.tools.email_sink --to "tu@correo" --body "hola"
```

- Si el destinatario está en la allowlist: imprime `[RESEND send_email]` y recibes el correo.
- Si está fuera de la allowlist: imprime `BLOCKED: ... not in the allowlist` (no se envía).

### Demo completo con correo real

Con las variables de arriba puestas:

```bash
python3 -m ikarus --scene all --scenario email --mock
```

Lo que recibes:

- **Escena 1:** `VERDICT: ALLOWED` → te llega un correo legítimo a tu inbox.
- **Escena 2:** `VERDICT: BLOCKED` por taint → **no se envía nada**.
- **Escena 3:** el agente ingenuo es secuestrado → el correo de "exfiltración" cae en tu inbox
  `+attacker`.

> Default seguro para el jurado: si **NO** defines `IKARUS_SINK`, todo queda en mock y no se
> envía ningún correo. Una key inválida o un fallo de red se registra como
> `real sink refused: ...` y **no rompe** el demo.

## 5. Si algo falla

- `ModuleNotFoundError: ikarus` → corre **desde `I-1/`** o ejecuta `pip install -e .` ahí.
- El demo se imprime doble → revisa `ikarus/tui.py` (`Console(record=True, file=io.StringIO())`).
- `--live` cuelga o da error de conexión → LM Studio no está sirviendo en `localhost:1234`.
- Para entender qué se simplificó vs CaMeL real → `docs/HONESTY.md` y `docs/CAMEL-VS-IKARUS.md`.

## 6. Estado y contexto

Para el panorama completo (decisiones, mapa de archivos, pendientes, stretch B2): ver
[`docs/ESTADO-IKARUS.md`](ESTADO-IKARUS.md).
