# 05 · Runbook d'operacions

## Desplegar (instal·lació des de zero)

```bash
cp .env.example .env        # EDITA: PUBLIC_URL, SUPERUSER_*, EMAIL_SMTP_*, ODOO_*
./install.sh                # idempotent; 7 passos (vegeu 03-CONFIGURACIO.md)
```

Resultats esperats: portal `200` a `http://localhost:${PUBLIC_PORT}/`, admin a `/_/`,
`meta.appName == APP_NAME`, `smtp.enabled == true`.

### Quickstart manual (equivalent)

```bash
cp .env.example .env
cd portal && npm install && npm run build        # → portal/dist
docker compose up -d                              # PocketBase :8090 (aplica migracions i carrega hooks)
docker compose exec pocketbase pocketbase superuser upsert admin@polser.cat PASS
# aplica appName/appURL/SMTP per API: auth superuser → PATCH /api/settings (o UI /_/)
```

## Verificació d'estat

- `GET /api/health` → `{"message":"API is healthy.",...}`.
- Portal: `GET /` → `200` (React). Admin: `/_/`.
- Superuser: `docker compose exec pocketbase pocketbase superuser upsert EMAIL PASS` (idempotent).
- Config: `docker compose exec pocketbase cat /pb/pb_data/settings.db`? — millor via
  `GET /api/settings` amb token de superuser, o la UI `/_/` → Settings.

## Logs (marcs útils del log de PocketBase)

```bash
docker compose logs -f pocketbase
```

| Marca | Què indica |
|---|---|
| `[outbox] ok/error` | Resultat del proces d'outbox cap a Odoo |
| `[cron:sync_odoo] error` | Fallada global del cron d'outbox |
| `[odoo_two_way_sync]` | Etapes/comissions sincronitzades d'Odoo |
| `[high_commission]` | Acreditació de la comissió d'alta (o error) |
| `[commission_monthly]` | Generació de la recurrent mensual |
| `[otp:dev] Codi OTP` | **Només dev** (`OTP_DEV_REVEAL=true`) |
| `[portal] referit creat` | Creació d'un lead des del portal |

## Superuser: troubleshooting del login d'inici (OPS-1)

Si a `/_/` surt directament el **login** (no el formulari de creació del primer superuser), el
volum `pb_data` ja conté un superuser d'una execució anterior.

- **Opció A (no perd dades):** `docker compose exec pocketbase pocketbase superuser upsert EMAIL PASS`.
- **Opció B (tornar a zero):** `docker compose down -v && docker compose up -d` (esborra el volum `pb_data`).

## Còpies de seguretat (recomanat)

No hi ha mecanisme de backup al repo; recomanació:

```bash
# aturar escriptura neta abans de copiar el fitxer SQLite
docker stop polser-prm-pb
tar -C /var/lib/docker/volumes/... -czf backup_pb_data_$(date +%Y%m%d).tgz _data
docker start polser-prm-pb
```

Alternativa menys intrusiva: `sqlite3 .backup` des de dins del contenidor
(`docker compose exec pocketbase sqlite3 /pb/pb_data/data.db ".backup /pb/pb_data/backup.db"`), però
el fitxer també es pot copiar amb calma si es respecten els locks WAL. **Produeix una
rutina de còpia periòdica abans de fer canvis de model.**

## Canvis de model / avaluació de l'stato

- Afegeix col·leccions/camps com a **migracions** numerades a `pb_migrations/` (es versionen i
  s'apliquen a l'arrencada). No només per la UI.
- Si una migració reinicia la BBDD: els monetaris han de reposar el seed **en euros** (el 001 els
  crea en cèntims i el 004 els reconverteix; en un repos 001+004 → euros nets).

## Problemes coneguts / notes d'operació

- **`PB_*` del compose són inerts.** `PB_APP_URL`/`PB_SMTP_*` no es llegeixen; config via API/UI.
- **JVM aïllat (PB 0.40.3):** els handlers de hooks han de ser **autocontinguts** (lògica inline).
  No afegir helpers globals a nivell de fitxer i cridar-los des de rutes/crons — donaria `ReferenceError`.
- **Migració morta:** `002_remove_auth_otps.js` (l'`auth_otps` mai es crea) — en `try/catch`, no trenca.
- **Col·lecció `users` per defecte** no s'usa; la migració `1788942106` li activa OTP 6 dígits (inofensiva).
- **`odoo_two_way_sync` atura la consulta d'etapes als referits `instalado`** (final de pipeline).
- **server `source`:** `_portal.pb.js` força `source='portal'` a les altes (la UI envia
  `'onboarding'`, que no està entre els valors `source` de l'esquema). Incoherència menor; revisar
  si es vol `onboarding` com a font.
- **Seguretat del repo:** actualment el repositori és **públic** a GitHub, però conté l'snapshot
  de preus/comissions i el model complet. **Recomanació: passar-lo a privat.**
- **`settings`:** en un entorn migrat des de 001 sense 004, comprovar que els valors monetaris
  estiguin en euros abans d'operar.

## Procés d'incidència ràpida

1. Consulta `docker compose logs --tail=200 pocketbase` per l'error exacte (`[cron:*]`, `[outbox]`).
2. Si és una sync Odoo: verifica credencials (`ODOO_URL/DB/LOGIN/APIKEY`), que `ODOO_STAGE_ID`/`TEAM_ID`
   siguin els de la BD Odoo, i l'estat de les files `outbox` (`status`, `attempts`, `last_error`).
3. Correccions de la cartera: `wallet_ledger` és immutable → fer una entrada `reversal` (permès a
   superusers), no un UPDATE directe.
4. Si el portal no compila: revisa que `npm install` hagi instal·lat `@types/*` (una `node_modules`
   copiada a mà pot no tenir-los) i que `VITE_POCKETBASE_URL` estigui buit en producció.