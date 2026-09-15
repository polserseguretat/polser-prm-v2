# 06 · Panell d'administració (/admin)

Panell centralitzat per a **superusuaris de PocketBase** de POLSER: estadístiques,
gestió de partners/usuaris, notificacions, retirades, materials, salut d'Odoo i ajustos.
Viu dins del **mateix portal React** (`portal/`) i es publica a `https://prm.polser.cat/admin`.

> **Idioma:** UI en català. **Marca:** primary `#042149`, accent `#FF6B00`.

## 1. Autenticació

- El panell s'autentica com a **superusuari de PocketBase** amb
  `POST /api/collections/_superusers/auth-with-password` (el mateix mecanisme que
  ja fa servir `install.sh` per configurar l'app). El superusuari es crea/actualitza amb:
  ```bash
  docker compose exec pocketbase pocketbase superuser upsert EMAIL PASS
  ```
- Amb el Bearer token de superusuari, el panell usa l'**API REST nativa** de PocketBase
  (`/api/collections/<col>/records`), que ignora les regles de col·lecció (`listRule`, …).
- Els endpoints propis del panell (`/api/admin/*`, `pb_hooks/_admin.pb.js`) comproven
  `e.requestInfo().hasSuperuserAuth()` a cada petició.

### Seguretat (important)

El token de superusuari té accés **total** (escritura a `wallet_ledger`, PII de clients,
comptes auth). Per això:

- El token es guarda a **`sessionStorage`** amb la clau `polser_admin_token` (s'esborra en
  tancar la pestanya) i **mai** es barreja amb el del portal (`polser_token`, `localStorage`).
- Fes servir un **superusuari dedicat** al panell, amb contrasenya forta i diferent de les
  credencials de `/_/`.
- **Restringeix per IP** (`/admin` i `/_/`) al reverse proxy / CDN (Caddy, Cloudflare…) si és
  possible. El panell no incorpora autenticació de dos factors.
- Les accions queden registrades a la col·lecció `admin_audit` (vegeu §4).

## 2. Seccions del panell

| Ruta | Contingut |
|---|---|
| `/admin` | Resum: KPIs (partners, referits, conversió, comissions, retirades, outbox) + gràfiques (evolució, comissions/mes, embudo, perfils) + alertes |
| `/admin/partners` | Llistat amb cerca (nom/NIF/email), filtre per estat i paginació |
| `/admin/partners/:id` | Fitxa editable, ascens a col·laborador, reenviament d'invitació, referits i cartera |
| `/admin/users` | Comptes del portal: rol, partner, activar/desactivar, esborrar, alta |
| `/admin/referrals` | Visió global (inclou dades de client) + detall amb historial |
| `/admin/notifications` | Composer (títol, missatge, imatge, públic, canal, programació), enviament immediat i entregues |
| `/admin/payouts` | Retirades i canvi d'estat |
| `/admin/documents` | Materials: publicar/despublicar, pujar i esborrar |
| `/admin/outbox` | Salut de la cua cap a Odoo, errors i reintent |
| `/admin/settings` | Ajustos globals (`min_payout`, `payout_days`, `default_*`, `recurring_enabled`, `sign_config`, …) |
| `/admin/audit` | Registre d'accions del panell |

Les gràfiques (`recharts`) es carreguen en un chunk a part (`React.lazy`): el portal de
partners no inclou la llibreria.

## 3. API del panell (`pb_hooks/_admin.pb.js`)

Tot és autocontingut (JSVM PB 0.40.3) i exigeix superusuari.

| Mètode | Ruta | Ús |
|---|---|---|
| GET | `/api/admin/stats` | KPIs i sèries de 12 mesos |
| GET | `/api/admin/outbox-health` | Recompte per estat + darrers errors |
| POST | `/api/admin/outbox/{id}/retry` | Reencua un event (`pending`, `attempts=0`) |
| POST | `/api/admin/notifications/{id}/send` | Entrega immediata (mateixa lògica que el cron) |
| POST | `/api/admin/users` | Alta d'usuari del portal (`setRandomPassword`) |
| POST | `/api/admin/partners/invite` | Alta/reenviament de partner per invitació (l'email i el token es generen al servidor; **no** s'exposa cap clau al navegador) |
| POST | `/api/admin/audit` | Registra una acció a `admin_audit` |

> El CRUD general no té endpoints propis: es fa amb l'API nativa de PB des del frontend
> (`portal/src/lib/adminApi.ts`).

### ⚠️ Limitació PB 0.40.3: no ordenar per `created`/`updated`

En aquesta versió, `?sort=-created` o `?sort=-updated` a l'API nativa retornen **400**
(«Something went wrong while processing your request»). Cal ordenar pels camps
`created_at`/`updated_at` de cada col·lecció (autodate). Excepcions:

- `notification_deliveries`: no té `created_at`; ordena per `-delivered_at`.
- `documents`: només té `updated_at`.
- `partner_users`: la migració `012` li afegeix `created_at`/`updated_at`.
- `settings`: només té una fila; no cal ordenar.

Els endpoints de `_admin.pb.js` fan servir `$app.findRecordsByFilter` amb `-created_at`
(gran treballa igual); el problema és exclusivament de la capa REST nativa.


## 4. Migració 011 i esquema

`pb_migrations/011_admin_panel.js`:

- `partner_users.disabled` (bool) — desactiva comptes sense esborrar-los. S'usa `disabled`
  (default `false`) i **no** `active`, perquè en afegir un bool els registres existents
  quedarien a `false` i es desactivarien tots. Els hooks d'OTP
  (`onRecordRequestOTPRequest` / `onRecordAuthWithOTPRequest`) bloquegen els comptes
  `disabled=true`.
- `admin_audit` (base, només superusuari): `actor`, `action`, `entity`, `entity_id`,
  `payload`, `ip`, `created_at`.

## 5. RGPD

- El superusuari veu els camps `client_*` de `referrals` (permesos per `_business_rules.pb.js`).
  L'accés queda auditat via `admin_audit`.
- El portal de partners continua sense exposar `client_*`.
- L'`admin_audit` és l'únic registre d'accions del panell.

## 6. Troubleshooting

- **401 al panell**: la sessió ha caducat; torna a `/admin/login`. Esborra només la sessió
  admin (`polser_admin_token`), no la del portal.
- **La invitació es crea però no arriba el correu**: revisa SMTP (`PATCH /api/settings` o
  `/_/` → Settings). El panell mostra l'enllaç per copiar-lo manualment.
- **La notificació no arriba als partners**: comprova que el cron `notification_processor`
  corre (cada 5 min) o usa "Envia ara" al panell. El destí es filtra per `audience` i
  `notification_deliveries`.
- **Odoo no rep events**: mira `/admin/outbox` (estat `error`/`dead` + `last_error`) i revisa
  `ODOO_*` al `.env`.

---
*Document creat amb el desenvolupament del panell (/admin).*
