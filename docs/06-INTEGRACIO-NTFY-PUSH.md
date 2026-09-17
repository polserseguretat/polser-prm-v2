# 06 — Integració ntfy per a notificacions push a la PWA

> **Estat:** IMPLEMENTAT al codi (migració `013`, hook `_push.pb.js`, endpoints
> `/api/portal/push/*`, service worker i UI). **Pendent:** validació en entorn real
> (spike: aixecar ntfy, provar push a Chrome/Android i Safari iOS instal·lat) i el
> desplegament amb les claus VAPID generades per `install.sh`.
> Configuració operativa a `03-CONFIGURACIO.md` (secció «Notificacions push (ntfy)»).
> **Objectiu:** enviar notificacions **push reals** als usuaris de la PWA (`prm.polser.cat`)
> reutilitzant el model de notificacions existent (`notifications` + `notification_deliveries`)
> i fent servir **ntfy self-hosted** com a servei d'enviament Web Push (VAPID + xifratge RFC8291).

---

## 1. Context i decisions preses

ntfy **no és un proveïdor Web Push estàndard per a tercers**, però resol la part difícil: la
firma VAPID i el xifratge de la càrrega, i l'enviament al `PushSubscription` del navegador.
Al PRM només cal **publicar missatges HTTP** (`POST /<topic>`).

En un navegador, l'únic canal de push en segon pla és la **Push API** amb un service worker.
Perquè ntfy entregui push a la *nostra* PWA:

- El `sw.js` de POLSER rep l'esdeveniment `push` i mostra la notificació.
- La PWA es subscriu amb la **VAPID pública de ntfy** i registra el `PushSubscription` a ntfy.

**Decisions (aprovades):**

| Decisió | Opció triada |
|---|---|
| Estil d'integració | **Nativa a la PWA POLSER** (una sola app) |
| Hosting ntfy | **Self-hosted** (Docker + Caddy a `ntfy.polser.cat`) |
| Esdeveniments que generen push | Canvis d'estat de referits · Comissions acreditades · Campanyes/notificacions · Canvis de payout |

---

## 2. Arquitectura

```
Event (cron/hook PB) ──► POST https://ntfy.polser.cat/<topic>   [Bearer NTFY_PUBLISH_TOKEN]
                                   │
                                   ▼
                          ntfy (self-hosted) ──Web Push(VAPID)──► SW de la PWA
                                                                      │ showNotification
PWA: GET  /api/portal/push/config     ─► PB ─► GET  /v1/config   (VAPID pública + topic)
PWA: POST /api/portal/push/subscribe  ─► PB ─► POST /v1/webpush  (registra subscripció)
```

- **1 topic ntfy per usuari** (`polser-<random>`), generat al servidor. El topic actua de
  contrasenya; mai s'exposa en llistats, només a l'usuari propietari.
- El **token de publicació** viu només al backend PocketBase (mai al navegador).
- PocketBase i ntfy comparteixen xarxa Docker (`http://ntfy:80` intern,
  `https://ntfy.polser.cat` a `NTFY_BASE_URL`).

### Endpoints de ntfy confirmats (a validar al spike)

| Mètode | Path | Ús |
|---|---|---|
| `GET` | `/v1/config` | Retorna `WebPushPublicKey` i `EnableWebPush` |
| `POST` | `/v1/webpush` | Registra subscripció: `{endpoint, auth, p256dh, topics:[...]}` |
| `DELETE` | `/v1/webpush` | Elimina subscripció |
| `POST` | `/<topic>` | Publica un missatge (headers `Title`, `Click`, `Priority`, `Tags`) |

---

## 3. Infraestructura

### 3.1 `docker-compose.yml`
- [ ] Nou servei `ntfy` amb imatge **pinneada** `binwiederhier/ntfy:v2.26.0` (`command: serve`).
- [ ] Volum `ntfy_data` (cache/auth/webpush) i xarxa comuna amb `pocketbase`.
- [ ] Variables:
  - `NTFY_BASE_URL=https://ntfy.polser.cat`
  - `NTFY_BEHIND_PROXY=true`
  - `NTFY_CACHE_FILE=/var/lib/ntfy/cache.db`
  - `NTFY_AUTH_FILE=/var/lib/ntfy/auth.db`
  - `NTFY_AUTH_DEFAULT_ACCESS=deny-all`
  - `NTFY_AUTH_USERS=<backend user hash>:user` (o admin)
  - `NTFY_AUTH_TOKENS=<backend user>:tk_...`
  - `NTFY_AUTH_ACCESS='*:polser-*:read-only'` (subscripció anònima de lectura al prefix)
  - `NTFY_WEB_PUSH_FILE=/var/lib/ntfy/webpush.db`
  - `NTFY_WEB_PUSH_PUBLIC_KEY`, `NTFY_WEB_PUSH_PRIVATE_KEY`, `NTFY_WEB_PUSH_EMAIL_ADDRESS`
- [ ] **No** cal `NTFY_UPSTREAM_BASE_URL`: només afecta l'app nativa d'iOS, no la PWA (Safari fa servir APNs directament).

### 3.2 Caddy (extern)
- [ ] Publicar `ntfy.polser.cat` → `ntfy:80` amb TLS.

### 3.3 `.env.example`
- [ ] `NTFY_URL=https://ntfy.polser.cat`
- [ ] `NTFY_PUBLISH_TOKEN=CHANGE_ME_NTFY_TOKEN`
- [ ] `NTFY_VAPID_PUBLIC_KEY=CHANGE_ME_VAPID_PUBLIC`
- [ ] `NTFY_TOPIC_PREFIX=polser-`

### 3.4 `install.sh`
- [ ] Generar VAPID keys si no existeixen (`npx web-push generate-vapid-keys`).
- [ ] Aixecar el servei ntfy i verificar `GET /v1/health`.
- [ ] Afegir el pas al resum final de verificació.

---

## 4. Model de dades (`pb_migrations/013_push_ntfy.js`)

A `partner_users`:
- [ ] `ntfy_topic` — text, max 64, **ocult** (no surt en exports/llistats genèrics).
- [ ] `push_enabled` — bool.
- [ ] `push_subscribed_at` — date.
- [ ] Índex únic sobre `ntfy_topic`.
- [ ] Backfill: generar topic per als usuaris existents.

> `notifications` (camp `channel: inapp|push|both`) i `notification_deliveries` es
> reutilitzen tal qual. **No** cal col·lecció nova de subscripcions: les guarda ntfy.

---

## 5. Backend PocketBase

### 5.1 `pb_hooks/_portal.pb.js` — endpoints nous (auth `partner_users`)
- [ ] `GET /api/portal/push/config` → `{ vapid_public_key, topic, enabled }`
      (proxy a `GET /v1/config`; el token no surt mai al navegador).
- [ ] `POST /api/portal/push/subscribe` → rep `{ endpoint, keys }`, fa
      `POST /v1/webpush` amb `[ntfy_topic]`, marca `push_enabled=true`
      i `push_subscribed_at`.
- [ ] `DELETE /api/portal/push/subscribe` → `DELETE /v1/webpush`, `push_enabled=false`.
- [ ] Generar `ntfy_topic` a l'alta de l'usuari (`_invitations.pb.js`,
      `_partner_provisioning.pb.js`) si no en té.

> **JSVM 0.40.3:** cada handler ha de ser **totalment autocontingut** (lògica inline dins
> del callback); no definir helpers de nivell de fitxer.

### 5.2 `pb_hooks/_crons.pb.js` — publicació
- [ ] `ntfyPublish(topic, {title, body, click, priority, tags})` **inline** via
      `$http.send` a `NTFY_URL + '/' + topic` amb `Authorization: Bearer NTFY_PUBLISH_TOKEN`.
- [ ] `notification_processor`: després de crear les `notification_deliveries`, si
      `channel` ∈ {`push`, `both`}, publicar per cada usuari amb `ntfy_topic`.
- [ ] Cron `push_processor` (`* * * * *`) per als events transaccionals, **o** baixar
      `notification_processor` a `*/1 * * * *`.

### 5.3 Esdeveniments transaccionals
Per cada event, crear una `notifications` `queued` (+ delivery dirigit); el cron la publica.
- [ ] **Canvi d'estat de referit** — `odoo_two_way_sync` (`_crons.pb.js`) i històric
      `referral_events` (`_business_rules.pb.js`). Text: "El referit `REF-XXXX` ha passat a
      `<estat>`." Deep-link `/referrals/<id>`.
- [ ] **Comissió acreditada** — `high_commission` (`_business_rules.pb.js`) i
      `commission_monthly` (`_crons.pb.js`). Deep-link `/wallet`.
- [ ] **Payout** — `payout_processor` (`en_proces` / `pagada`). Deep-link `/wallet`.
- [ ] **Campanyes** — `notifications` amb `channel=push|both` (ja cobert pel punt 5.2).

### 5.4 Regles
- [ ] **RGPD:** el payload **mai** porta camps `client_*`; només `referral_code` i estats.
- [ ] Idempotència: no duplicar pushes per un mateix canvi.

---

## 6. Portal PWA

- [ ] `portal/public/sw.js`:
  - handler `push` → parseja el JSON de ntfy (`title`, `message`) → `showNotification`.
  - handler `notificationclick` → obre el deep-link.
  - handler `pushsubscriptionchange` → re-subscripció.
  - Pujar `CACHE_NAME` (ex. `polser-partners-v5`).
- [ ] `portal/src/lib/push.ts` (nou): `ensurePushSubscription()` — demana permís,
      `GET /api/portal/push/config`, `pushManager.subscribe({ applicationServerKey })`,
      `POST /api/portal/push/subscribe`.
- [ ] `portal/src/lib/api.ts`: tipus + funcions dels endpoints nous.
- [ ] `portal/src/pages/Profile.tsx`: targeta "Notificacions push" amb botó
      activar/desactivar i estat; avís iOS (cal instal·lar la PWA a la pantalla d'inici).
- [ ] `portal/src/App.tsx`: cridar `ensurePushSubscription()` quan l'app obre amb sessió
      (renova subscripcions expirades).

---

## 7. Fases d'execució

1. **Spike (bloquejant)** — aixecar ntfy, validar `GET /v1/config`, `POST /v1/webpush` i
   push real a Chrome/Android + iOS instal·lat. Confirmar subscripció anònima amb
   `deny-all` + ACL `polser-*: read-only`.
2. **Infra** — `docker-compose.yml`, Caddy, `.env.example`, `install.sh`.
3. **Model + endpoints** — migració `013`, `/api/portal/push/*`, generació de topic.
4. **Frontend** — `sw.js`, `push.ts`, UI Profile, arrencada.
5. **Publicació** — `ntfyPublish` + els 4 tipus d'esdeveniment.
6. **Verificació i docs** — `npm run build`, proves en dispositius, actualitzar
   `01-ARQUITECTURA.md`, `02-MODEL-DADES.md`, `03-CONFIGURACIO.md`, `AGENTS.md`.

---

## 8. Riscos i mitigacions

| Risc | Mitigació |
|---|---|
| API interna `/v1/webpush` de ntfy no documentada / canvis de versió | Pinnejar `v2.26.0` i encapsular-la al backend (`_portal.pb.js`) |
| Expiració de les subscripcions Web Push | Renovar a cada obertura de la PWA (`ensurePushSubscription`) |
| +1 servei a mantenir (matisa "mínim de serveis" d'AGENTS.md) | A canvi, elimina la necessitat d'un servei sender propi |
| iOS: només PWA instal·lada (iOS 16.4+) | Validar-ho al spike; avís a la UI |
| Fuita del topic (és la contrasenya) | Topic aleatori llarg (`polser-<random 24>`); sense PII al payload |
| Filtre de relacions al JSVM de PB 0.40.3 | Lògica inline autocontinguda, sense helpers de fitxer |

---

## 9. Verificació (criteris d'acceptació)

- [ ] `GET https://ntfy.polser.cat/v1/health` → `200`.
- [ ] `npm run build` (portal) → exit 0.
- [ ] Un push de prova arriba amb l'app **tancada** a: Chrome Android, Chrome desktop,
      Safari iOS (PWA instal·lada).
- [ ] Els 4 tipus d'esdeveniment generen exactament **un** push per destinatari.
- [ ] Cap endpoint del portal exposa `ntfy_topic` d'altres usuaris ni camps `client_*`.
- [ ] `notification_processor` no llança errors a l'arrencada ni a l'execució.

---

*Pla creat per a execució posterior · 15/09/2026.*
