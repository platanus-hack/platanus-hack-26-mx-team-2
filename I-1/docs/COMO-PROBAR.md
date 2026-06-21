# Cómo probar el demo de Ikarus

Guía paso a paso para verificar que Ikarus funciona. Pensada para retomar el proyecto en frío.

## 0. Requisitos

- Python 3.11+ (probado con 3.12).
- Dependencias: `openai`, `pydantic>=2`, `rich`, `pytest`.

```bash
cd /Users/gabriels/Proyectos/Platanus/CAMEL
pip install -e .          # instala el paquete ikarus + dependencias
```

Si `rich`/`openai` no estuvieran: `pip install "rich>=13" "openai>=1.0" "pydantic>=2" pytest`.

## 1. Correr los tests (no necesita LM Studio)

```bash
python3 -m pytest -q
```

**Esperado:** `50 passed`. Puede salir UN warning de `pytest-asyncio` — es del entorno
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

## 3. Probar el modo `--live` contra LM Studio (híbrido)

Solo el **P-LLM** corre contra el modelo; el Q-LLM sigue siendo mock. Pasos:

1. Abre **LM Studio** y arranca el servidor OpenAI-compatible en `http://localhost:1234/v1`.
2. Carga un modelo (Qwen3.5 35B A3B, o el 9B de respaldo). Apunta `IKARUS_MODEL` a su id:

```bash
export IKARUS_MODEL="qwen3.5-35b-a3b"          # ajusta al id real que muestre LM Studio
# opcionales: export IKARUS_BASE_URL="http://localhost:1234/v1"
python3 -m ikarus --scene 1 --scenario email --live
```

**Qué esperar:** en Escena 1 el plan lo emite el modelo real. Si el modelo no responde o
devuelve JSON inválido, verás `[note] P-LLM unavailable/invalid — used canonical fallback plan.`
y el demo sigue funcionando (la garantía la da el intérprete, no el modelo).

> Nota honesta: la Escena 2 SIEMPRE usa el plan "subvertido" (defensa en profundidad) y el Q-LLM
> es mock incluso en `--live`. Ver `docs/HONESTY.md`.

## 4. Si algo falla

- `ModuleNotFoundError: ikarus` → corre desde la raíz del repo o `pip install -e .`.
- El demo se imprime doble → revisa `ikarus/tui.py` (`Console(record=True, file=io.StringIO())`).
- `--live` cuelga o da error de conexión → LM Studio no está sirviendo en `localhost:1234`.
- Para entender qué se simplificó vs CaMeL real → `docs/HONESTY.md` y `docs/CAMEL-VS-IKARUS.md`.

## 5. Estado y contexto

Para el panorama completo (decisiones, mapa de archivos, pendientes, stretch B2): ver
[`docs/ESTADO-IKARUS.md`](ESTADO-IKARUS.md).
