#!/usr/bin/env bash
# Levanta server (API + MCP) y web (SPA) juntos.
# Ctrl-C o matar este script (SIGTERM/SIGINT) tumba ambos: el trap manda
# `kill 0`, que señala a TODO el grupo de procesos (server, web y sus hijos
# node/tsx/vite, que heredan el grupo). Portable a macOS (bash 3.2, sin setsid).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# Carga el .env de la raíz (el server lo necesita; Vite lee sus vars aparte).
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
else
  echo "✗ falta $ROOT/.env" >&2
  exit 1
fi

cleanup() {
  trap - INT TERM EXIT
  echo ""
  echo "⏹  deteniendo ikarus…"
  kill 0 2>/dev/null || true   # SIGTERM a todo el grupo de procesos
}
trap cleanup INT TERM EXIT

echo "▶  demo-mcp → http://localhost:8900  (mailbox /mailbox/mcp · mailer /mailer/mcp)"
pnpm --filter @ikarus/demo-mcp start &

echo "▶  server  → http://localhost:${PORT:-8787}  (MCP /mcp · API /api)"
pnpm --filter @ikarus/server start &

echo "▶  web     → http://localhost:5173"
pnpm --filter @ikarus/web dev &

# Espera a los hijos. Si recibe señal, el trap limpia al grupo entero.
wait
