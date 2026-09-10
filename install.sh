#!/usr/bin/env bash
# =====================================================================
# PRM POLSER — Script d'instal·lació i desplegament (PocketBase 0.40.3)
# =====================================================================
# Deixa el portal llest per funcionar "des del moment 0":
#   1. Verifica prerequisits (docker, docker compose, node, npm)
#   2. Prepara .env (copia des de .env.example si no existeix)
#   3. Construeix el portal React (npm install + build -> portal/dist)
#   4. Construeix i aixeca el contenidor Docker (Postgres-free: PocketBase+SQLite)
#   5. Crea/actualitza el superuser des de les variables d'entorn
#   6. Aplica la configuració (appName, appURL, SMTP) via la API /api/settings
#   7. Verifica que tot és operatiu
#
# Correu des de l'arrel del repo:  ./install.sh
# Preparar-ho (una vegada):        chmod +x install.sh
#
# Variables d'entorn (llegides de .env, amb fallback a valors per defecte):
#   PUBLIC_URL, APP_NAME, SUPERUSER_EMAIL, SUPERUSER_PASSWORD,
#   EMAIL_SMTP_HOST/PORT/USER/PASSWORD, EMAIL_FROM, OTP_DEV_REVEAL,
#   ODOO_*, VITE_POCKETBASE_URL
# =====================================================================
set -euo pipefail

# Mitiga el problema de valors com ${PUBLIC_URL:-default}: hem de configurar
# l'API URL local per a les crides curl (el contenidor escolta en 8090).
PB_INTERNAL=localhost:8090

# -------------------------------------------------------------------
# 1. Prerequisits
# -------------------------------------------------------------------
echo "==> [1/7] Verificant prerequisits..."
command -v docker >/dev/null 2>&1 || { echo "ERROR: 'docker' no trobat."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "ERROR: 'docker compose' no compatible."; exit 1; }
if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  echo "    node + npm OK ($(node --version))"
else
  echo "ERROR: cal 'node' i 'npm' per construir el portal (Vite)."
  exit 1
fi

# -------------------------------------------------------------------
# 2. Preparar .env
# -------------------------------------------------------------------
echo "==> [2/7] Preparant .env..."
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "    Creat .env des de .env.example. EDITEU-LO amb les credencials reals abans de continuar."
  echo "    (PUBLIC_URL, APP_NAME, SUPERUSER_EMAIL/PASSWORD, EMAIL_SMTP_*, ODOO_*)"
  exit 1  # forcem edició explícita; no volem desplegar amb valors per defecte
else
  echo "    .env ja existeix." 
fi

# Carrega .env (no sobreescriu variables ja exportades a l'entorn)
set -a; source .env; set +a

# Valors obligatoris per no arrencar "en fals"
[[ -n "${SUPERUSER_EMAIL:-}" && -n "${SUPERUSER_PASSWORD:-}" ]] || { echo "ERROR: .env sense SUPERUSER_EMAIL/PASSWORD."; exit 1; }
if [[ "${SUPERUSER_PASSWORD}" == "CHANGE_ME_STRONG_PASSWORD" || "${SUPERUSER_EMAIL}" == "CHANGE_ME"* ]]; then
  echo "ERROR: .env encara té valors per defecte d'exemple. Editeu-lo."
  exit 1
fi

APP_NAME="${APP_NAME:-PRM POLSER}"
PUBLIC_URL="${PUBLIC_URL:-http://localhost:8090}"
EMAIL_SMTP_HOST="${EMAIL_SMTP_HOST:-}"
EMAIL_SMTP_PORT="${EMAIL_SMTP_PORT:-465}"
EMAIL_SMTP_USER="${EMAIL_SMTP_USER:-}"
EMAIL_SMTP_PASSWORD="${EMAIL_SMTP_PASSWORD:-}"
EMAIL_FROM="${EMAIL_FROM:-POLSER SEGURETAT <no-reply@polser.cat>}"

# -------------------------------------------------------------------
# 3. Construir el portal React
# -------------------------------------------------------------------
echo "==> [3/7] Construint el portal React..."
pushd portal >/dev/null
  export VITE_POCKETBASE_URL="${VITE_POCKETBASE_URL:-$PUBLIC_URL}"
  if [[ ! -d node_modules ]]; then
    echo "    npm install (primera vegada)..."
    npm install
  fi
  echo "    npm run build..."
  npm run build
  [[ -d dist ]] || { echo "ERROR: build no ha generat portal/dist."; popd >/dev/null; exit 1; }
popd >/dev/null
echo "    Portal compilat a portal/dist ($(du -sh portal/dist | cut -f1))."

# -------------------------------------------------------------------
# 4. Construir i aixecar el contenidor Docker
# -------------------------------------------------------------------
echo "==> [4/7] Construeix i aixeca el contenidor Docker..."
docker compose build
docker compose up -d

echo -n "    Esperant que PocketBase arrenqui (health) "
for i in $(seq 1 30); do
  if curl -fsS "http://$PB_INTERNAL/api/health" >/dev/null 2>&1; then
    echo "OK"; break
  fi
  [[ $i -eq 30 ]] && { echo; echo "ERROR: PocketBase no respon a /api/health."; docker compose logs --tail=50 pocketbase; exit 1; }
  echo -n "."; sleep 2
done

# -------------------------------------------------------------------
# 5. Crear/actualitzar superuser (idempotent)
# -------------------------------------------------------------------
echo "==> [5/7] Configurant superuser (${SUPERUSER_EMAIL})..."
docker compose exec -T pocketbase pocketbase superuser upsert "${SUPERUSER_EMAIL}" "${SUPERUSER_PASSWORD}" >/dev/null
echo "    superuser llest."

# -------------------------------------------------------------------
# 6. Aplicar configuració via /api/settings (appName, appURL, SMTP)
# -------------------------------------------------------------------
echo "==> [6/7] Aplicant configuració (appName, appURL, SMTP)..."
# Autenticació com a superuser per obtenir token
TOKEN=$(curl -fsS -X POST "http://$PB_INTERNAL/api/collections/_superusers/auth-with-password" \
  -H 'Content-Type: application/json' \
  -d "{\"identity\":\"$SUPERUSER_EMAIL\",\"password\":\"$SUPERUSER_PASSWORD\"}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])' 2>/dev/null)
[[ -n "${TOKEN:-}" ]] || { echo "ERROR: no s'ha pogut autenticar el superuser."; exit 1; }

# Descompon EMAIL_FROM ("Nom <addr>") a senderName/senderAddress
SENDER_NAME="POLSER SEGURETAT"
SENDER_ADDR="${SUPERUSER_EMAIL}"
if [[ "$EMAIL_FROM" =~ ^(.*)\<([^>]+)\>$ ]]; then
  SENDER_NAME="${BASH_REMATCH[1]//[[:space:]]+$/}"  # trim espais finals del nom
  SENDER_NAME="${SENDER_NAME%% }"
  SENDER_ADDR="${BASH_REMATCH[2]}"
fi

# Construïm el payload SMTP: només si SMTP_HOST està definit.
# A PB el senderName/senderAddress viuen a meta (NO dins de smtp).
SMTP_JSON="{\"enabled\":false}"
if [[ -n "${EMAIL_SMTP_HOST}" ]]; then
  SMTP_JSON="{\"enabled\":true,\"host\":\"$EMAIL_SMTP_HOST\",\"port\":${EMAIL_SMTP_PORT:-465},\"username\":\"$EMAIL_SMTP_USER\",\"password\":\"$EMAIL_SMTP_PASSWORD\"}"
fi

SETTINGS_JSON=$(python3 -c '
import json, sys
app_name, public_url, sender_name, sender_addr, smtp_json = sys.argv[1:6]
meta = {"appName": app_name, "appURL": public_url, "senderName": sender_name, "senderAddress": sender_addr}
smtp = json.loads(smtp_json)
print(json.dumps({"meta": meta, "smtp": smtp}))
' "$APP_NAME" "$PUBLIC_URL" "$SENDER_NAME" "$SENDER_ADDR" "$SMTP_JSON")

curl -fsS -X PATCH "http://$PB_INTERNAL/api/settings" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "$SETTINGS_JSON" >/dev/null
echo "    Configuració aplicada."

# -------------------------------------------------------------------
# 7. Verificació final
# -------------------------------------------------------------------
echo "==> [7/7] Verificant..."
# Frontend (portal buid a pb_public via volum)
FRONT_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://$PB_INTERNAL/")
# Config aplicada?
APPLIED_NAME=$(curl -s -H "Authorization: Bearer $TOKEN" "http://$PB_INTERNAL/api/settings" | python3 -c 'import sys,json;print(json.load(sys.stdin)["meta"]["appName"])' 2>/dev/null)
SMTP_STATUS=$(curl -s -H "Authorization: Bearer $TOKEN" "http://$PB_INTERNAL/api/settings" | python3 -c 'import sys,json;print(json.load(sys.stdin)["smtp"]["enabled"])' 2>/dev/null)

echo "    - API health:        $(curl -s http://$PB_INTERNAL/api/health)"
echo "    - Frontend (portal):  HTTP $FRONT_CODE"
echo "    - appName aplicat:    $APPLIED_NAME"
echo "    - SMTP habilitat:     $SMTP_STATUS"

if [[ "$FRONT_CODE" == "200" ]] && [[ "$APPLIED_NAME" == "$APP_NAME" ]]; then
  echo
  echo "=============================================="
  echo "✅ PRM POLSER desplegat i operatiu."
  echo "   Portal:   http://localhost:10001/"
  echo "   Admin UI: http://localhost:10001/_/"
  echo "   Superuser: $SUPERUSER_EMAIL"
  echo "   Hostname públic (PUBLIC_URL): $PUBLIC_URL"
  echo "=============================================="
else
  echo "⚠️  Verificació no completada. Revisa docker compose logs pocketbase."
fi