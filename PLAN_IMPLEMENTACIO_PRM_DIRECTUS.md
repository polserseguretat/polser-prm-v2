# PRM POLSER — Plan de Implementación
## Partner Relationship Management a medida
**Stack:** Directus (sobre PostgreSQL) + Portal React PWA responsive · Externo a Odoo
**Versión:** 1.0 · **Fecha:** 08/09/2026 · **Autor:** Pol (Chief of Staff, agente IA)
**Estado:** Propuesta de plan — pendiente de validación F0

---

## 0. Resumen ejecutivo y decisiones

Objetivo: sistema **externo a Odoo**, de coste fijo (sin coste por usuario de partners), donde POLSER pueda
**definir lógica de negocio** (motor de comisiones + ciclo de venta/referido) y desde donde los partners operen
desde **móvil**, viendo el avance de sus referidos y su cartera de comisiones.

**Decisiones tomadas:**
- Backend/BD: **postgres** — una BBDD PostgreSQL dedicada al PRM.
- Plataforma de datos + API + admin + lógica: **Directus** (self-hosted, BSL 1.1, gratis para <5M€ y <50 empleados).
- Frontend del portal de partners: **React** (Vite + TypeScript) como **PWA instalable**, responsive/mobile-first.
- **Odoo queda solo para operaciones internas y facturación/contabilidad.** Se sincronizan las **sales** (véase §6.3).
- Twenty CRM: **descartado** (AGPL open-core, RBAC/SSO en plano de pago). Appsmith/Budibase/Tooljet/Supabase: descartados.

**Decisiones pendientes (F0, necesarias antes de F1):** listado en §10.

---

## 1. Contexto y motivación

- El programa de partners hoy vive repartido en **Odoo 19** (Resellers/Commissions), **NocoDB** y formularios **n8n**.
- Odoo tiene **licencia por usuario**: añadir partners externos sale caro y no es rentable.
- El modelo necesita reglas de negocio muy específicas (perfil Afiliat/Col·laborador, comisión de alta + recurrente,
  cartera digital, factura inversa) que ninguna plataforma CRM genérica cubre sin personalización.
- Los partners (inmobiliarias, administradores de fincas, operadores de telecom, autónomos) deben poder registrar
  referidos y seguir su estado desde el móvil.

El PRM será **fuente de verdad del ciclo de referencia/venta** (lead → contactado → presupuesto → aceptado → instalado).
Odoo recibe las sales para facturación y devuelve el estado de suscripción para calcular la comisión recurrente.

---

## 2. Arquitectura

### 2.1 Capas

| Capa | Tecnología | Responsabilidad |
|---|---|---|
| Data + API | **Directus** sobre PostgreSQL (dedicada) | Auth, RBAC, CRUD, REST/GraphQL auto-generado, Flows, extensiones, storage de fichas, panel admin |
| Base de datos | **PostgreSQL 16** (Docker) | BBDD única del PRM (las colecciones Directus = tablas Postgres) |
| Portal partner | **React 19 + Vite + TypeScript** → **PWA** | Interfaz mobile-first/installable para partners |
| Backoffice lógico | **Flows + extensiones Directus** (JS/TS) + **n8n** (orquestación) | Motor de comisiones, ciclos, notificaciones, sincronización Odoo |
| Orquestación | **n8n** (ya en stack) | Sincronización Odoo, emails, alertas |
| Infra | **Docker Compose + Cloudflare Tunnel** (API) + **Cloudflare Pages** (portal) | Self-hosted, mínimo de servicios; TLS/DNS en Cloudflare |

### 2.2 Topología (Docker Compose)

- `postgres` — BBDD del PRM (docker volume + `pg_dump` diario).
- `directus` — app Node conectada a `postgres`.
- `portal` — build estático de React, desplegado como **Worker de static assets** (`wrangler.jsonc`,
  `not_found_handling: single-page-application`). PWA manifest + service worker.
- `cloudflared` — túnel Cloudflare que expone `directus` (API + admin) en `api.partners.polser.cat`.
- `n8n` — sync Odoo ↔ PRM, emails de hitos (ya existente).

```
Internet ── Cloudflare
             ├─ partners.polser.cat     → Cloudflare Pages → portal React (PWA)
             │                              └─ fetch cross-origin → Directus (API + admin)
             ├─ api.partners.polser.cat → Cloudflare Tunnel → Directus
             ├─ n8n.polser.cat          → orquestación
             └─ (Odoo 19 vía API, MISMO host o red) → sales
```

> **Nota infra (decisión dirección 08/09/2026):** Caddy sustituido por Cloudflare Tunnel (API)
> + Cloudflare Pages (portal). Directus vive a la raíz de `api.partners.polser.cat` (sin prefijo `/directus`).

**Principio aplicado:** backend unificado para el PRM con **una sola BBDD Postgres**; Odoo se integra **por API**,
**sin sincronización de esquemas** entre dos BBDD (solo intercambio de datos / eventos idempotentes).

---

## 3. Modelo de datos (colecciones Directus = tablas PostgreSQL)

> Las colecciones de Directus crean tablas reales en Postgres. Esquema versionado como **migraciones SQL** (véase F2)
> y re-creado/fuente única en el repositorio. Convención de tipos: `uuid` PK, `ts` timestamps, `dec` numeric,
> `sel` enum (check constraint), FK con `on delete` según nota.

### 3.1 System de Directus (nativo)
`directus_users` (cuentas), `directus_roles` (POLSER_admin, POLSER_cpso, POLSER_ceo, partner), `directus_permissions`/`policies`,
`directus_files` (fichas de contrato/materiales). Se usan tal cual; los roles se mapean en §4.

### 3.2 Colecciones propias

#### `partners` — el partner/organización
| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `name` | text | nombre empresa/autónomo |
| `profile` | sel | `afiliat` \| `colaborador` (regla CEO §6.2.5) |
| `type` | sel | `inmobiliaria` \| `administrador_fincas` \| `operador_telecom` \| `autonomo` \| `otro` |
| `nif` | text | único (empresa) / DNI (autónomo) |
| `email` | email | único, contacto principal |
| `phone` | text | |
| `address` | text | opcional |
| `status` | sel | `pendente` \| `actiu` \| `inactiu` \| `bloquejat` |
| `activation_date` | ts | cuando `pendente → actiu` |
| `contract_file` | file (fk `directus_files`) | contrato firmado |
| `notes` | text | notas internas |
| `created_by` / `created_at` / `updated_at` | — | tracking/auditoría |

#### `partner_members` — relación partner ↔ usuarios (varias cuentas por organización)
| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `partner` | FK `partners` | |
| `user` | FK `directus_users` | cuenta del portal |
| `role_in_partner` | sel | `owner` \| `editor` \| `viewer` |
| `created_at` | ts | |

Un partner se activa cuando su owner completa onboarding; las cuentas adicionales las crea POLSER (nunca self-registro sin validación).

#### `services` —catálogo (dato semilla del §7, fuente KB alarmes-productes)
| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `code` | text | `pis`,`casa`,`oficina`,`botiga`,`amida`,`videovigilancia`,`manteniment` |
| `name` | text | |
| `category` | sel | `alarma` \| `videovigilancia` \| `manteniment` |
| `sector` | sel | `residencial` \| `negocio` |
| `alta_fee` | dec | precio de alta (IVA según sector) |
| `monthly_fee` | dec | cuota mensual (base de la comisión recurrente) |
| `iva_included` | bool | residencial=true, negocio=false |
| `details` | json | detectores, extras (sirena, pánico, vídeo…) |
| `active` | bool | |

#### `referrals` — el referido / la venta (el corazón del PRM)
| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `partner` | FK `partners` (nullable) | null si lead directo/no atribuido |
| `referral_code` | text | código de atribución único del partner |
| `client_name` | text | **mínimo** (RGPD §6.5) |
| `client_phone` | text | usado para dedupe |
| `client_email` | email | opcional |
| `client_address` | text | solo para presupuesto, minimización |
| `service` | FK `services` | si ya consta |
| `service_type` | sel | copia lógica si `service` null |
| `status` | sel | `lead` \| `contactado` \| `presupuesto` \| `aceptado` \| `instalado` \| `perdido` |
| `stage_date` | ts | fecha del estado actual |
| `estimated_value` | dec | valor estimado |
| `final_value` | dec | valor final (de Odoo, cuota alta) |
| `active_subscription` | bool | **sincro Odoo** (§6.3): derivada del estado financiero de la oportunidad; cliente con cuota activa |
| `odo_opportunity_id` | int | **id de la oportunidad del CRM de Odoo (`crm.lead`)** — ancla del referido |
| `odo_customer_id` | int | referencia res.partner Odoo |
| `odo_sale_id` | int | referencia de la orden/presupuesto derivada de esa oportunidad |
| `odoo_sync_status` | sel | `pendiente` \| `ok` \| `error` |
| `source` | sel | `portal` \| `whatsapp` \| `email` \| `telefono` \| `web` |
| `self_referral` | bool | marcado por dedupe (mitigación §6.2.6) |
| `notes` | text | |
| `created_by` / `created_at` / `updated_at` | — | |

*RGPD:* en el portal el partner **nunca** ve los campos de datos personales del cliente (solo estado/fecha). Los empleados POLSER sí.

#### `referral_events` — historial de transiciones (auditoría)
| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `referral` | FK `referrals` | |
| `from_status` | sel | |
| `to_status` | sel | |
| `changed_by` | FK `directus_users` | quién lo movió (comercial/internal) |
| `reason` / `lost_reason` | text | motivo de pérdida |
| `created_at` | ts | |

#### `commission_rules` — reglas de comisión (parámetro, editable solo por CEO)
| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `name` | text | p.ej. «Alta estándar», «Recurrente Col·laborador» |
| `profile` | sel | `afiliat` \| `colaborador` \| `all` |
| `kind` | sel | `high` (por alta) \| `recurring` (mensual) |
| `service` | FK `services` (nullable) | null = aplica a todos |
| `fixed_amount` | dec | p.ej. 60 € (por alta). Null si `kind=recurring`. |
| `rate` | dec | 0.10 para recurrent (10 %). Null si `kind=high`. |
| `base` | sel | para recurring: `monthly_fee` (quota servei) o `amount_invoiced` |
| `allow_recurring` | bool | **FALSE para `afiliat`** (regla CEO §6.2.5) |
| `partner_override` | FK `partners` (nullable) | comisión especial CEO para un partner concreto |
| `active` / `valid_from` / `valid_to` | — | versionado |
| `created_by` | FK | solo rol `POLSER_ceo` puede crear/editar |

#### `wallet_ledger` — cartera digital (movimientos **inmutables**)
| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `partner` | FK `partners` | |
| `referral` | FK `referrals` (nullable) | |
| `type` | sel | `high` \| `recurring` \| `adjustment` \| `payout_deduction` \| `reversal` |
| `amount` | dec | firmado: + comisión, − retirada |
| `period` | text | `YYYY-MM` (solo `recurring`) |
| `status` | sel | `accrued` \| `poised` \| `paid` \| `reversed` \| `void` |
| `description` | text | |
| `created_at` / `created_by` | — | |

**Regla de integridad:** el ledger es append-only. Los errores se corrigen con entradas `reversal`, nunca con UPDATE.

#### `payouts` — retiradas / factura inversa
| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `partner` | FK `partners` | |
| `amount` | dec | ≥ mínimo retirada (config) |
| `invoice_reference` | text | nº factura del partner |
| `invoice_received_at` | ts | |
| `status` | sel | `solicitada` \| `factura_rebuda` \| `en_proces` \| `pagada` |
| `paid_at` | ts | |
| `odoo_vendor_bill_id` | int | referencia factura de proveedor en Odoo |
| `created_at` | ts | |

#### `interactions` — log con partners (CPSO / Irene)
| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `partner` | FK `partners` | |
| `referral` | FK `referrals` (nullable) | |
| `channel` | sel | `whatsapp` \| `email` \| `telegram` \| `telefono` \| `portal` |
| `direction` | sel | `inbound` \| `outbound` |
| `type` | sel | `onboarding` \| `followup` \| `reactivation` \| `info` \| `complaint` |
| `summary` | text | |
| `outcome` | sel | `positive` \| `neutral` \| `negative` \| `pending` |
| `created_at` / `created_by` | — | |

#### `documents` — biblioteca de materiales (portal)
| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `title` | text | |
| `type` | sel | `contrato` \| `material` \| `manual` \| `acuerdo` |
| `category` | text | |
| `file` | FK `directus_files` | |
| `version` | text | |
| `published` | bool | visible en portal |
| `updated_at` | ts | |

#### `notifications` — notificacions i campanyes on-demand
| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `title` | text | títol (ex. «Campanya Setmana» ) |
| `body` | text | missatge |
| `image` | file (fk `directus_files`) | opcional — ex. creatiu per penjar al WhatsApp |
| `audience` | sel | `all` \| `afiliats` \| `colaboradors` \| (o FK `partners` per a un segment/partner concret) |
| `channel` | sel | `inapp` \| `push` \| `both` |
| `scheduled_at` | ts | opcional — programació (campanya setmanal) |
| `sent_at` | ts | quan s'envia |
| `status` | sel | `draft` \| `queued` \| `sent` \| `failed` |
| `created_by` | FK | admin/CEO |
| `created_at` / `updated_at` | — | |

`notification_deliveries` (junction opcional): `(notification, user, read_at, delivered_at)` per a seguiment de repartiment/lectura per usuari.

#### `odoo_sync_log` — auditoría de sincronización
| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `entity` | sel | `referral` \| `partner` \| `payout` |
| `entity_id` | uuid/fk | |
| `action` | sel | `create_customer` \| `create_sale` \| `update_sale_status` \| `read_subscription` \| `create_vendor_bill` |
| `odoo_operation` | text | método/call Odoo |
| `status` | sel | `pending` \| `success` \| `failed` |
| `error` | text | |
| `created_at` / `attempts` | — | reintentos |

#### `settings` — configuración global
| Campo | Tipo | Valor por defecto |
|---|---|---|
| `min_payout` | dec | 100 € |
| `payout_days` | int | 15 días hábiles |
| `default_fixed_commission` | dec | 60 € |
| `default_recurring_rate` | dec | 0.10 |
| `recurring_enabled` | bool | true (solo Col·laborador) |
| `invoice_concept` | text | «Assistència comercial a POLSER SEGURETAT, SL» |
| `sla_days_no_contact` | int | p.ej. 7 |

---

## 4. Autenticación, roles y RBAC

Roles Directus:
| Rol | Permisos destacados |
|---|---|
| `partner` | **Self-service solo de su organización**: leer sus `referrals`, crear referidos, ver sus `wallet_ledger`/saldo, listar paquete/materials, crear `interactions` (outbound). NO ve datos personales de clientes, NO ve config de comisiones de otros, NO ve `payouts` de otros. Via **portal React** (JWT session de Directus). |
| `POLSER_cpso` | CRUD `partners`, `referrals`, `interactions`, `referral_events`, `documents`. Lee `wallet_ledger` y `commission_rules` (sin editar). (Irene) |
| `POLSER_admin` | CRUD de todo su dominio (no reglas de comisión), retiradas, sync. |
| `POLSER_ceo` | Único con **write en `commission_rules`** (incl. `partner_override`), aprobación de retiradas y comisiones especiales. |

- Aislamiento multicuenta: `partner_members` víncula cada cuenta a su `partners`; las políticas de permisos de Directus filtran por `partner_members.partner = current-user.partner`.
- 2FA (TOTP) para roles POLSER (F6/robustez); **partners: login sin contraseña (email OTP, §6.6)** — no precisan contrasenya ni 2FA.
- RGPD borrado: `partners`→`bloquejat` (lógico) + anonimización de `client_*` de un referido si se solicita.

---

## 5. Vistas a diseñar

### 5.1 Portal del partner — React PWA (mobile-first)

**Idioma de la UI: CATALÀ** (decisió CEO: tot el portal en català). PWA = manifest + service worker + tema POLSER `#042149`/`#FF6B00`.

**Navegació: barra inferior (bottom nav) amb 3 pestanyes principals**, fixada a mobile:
- 🏠 **Inici (Dashboard)**
- 📋 **Els meus referits**
- 💰 **Cartera**

La resta de pantalles (nou referit, detall, materials, perfil, notificacions) són secundàries i s'accedeix des de dins de cada secció (rutes apilades). En desktop, la mateixa estructura de 3 seccions (sidebar o pestanyes superiors), sense canviar el model.

| Pestanya / Ruta | Contingut / accions |
|---|---|
| Autenticació (`/login`, `/logout`) | **Login sense contrasenya (email OTP):** introdueix el teu email → reps un codi d'un sol ús → l'introdueixes → sessió llarga (~1 mes). Sense pàgina de recuperació (no hi ha contrasenya per oblidar). |
| **Inici / Dashboard (`/`)** | **4 comptadors informatius:** «Referits enviats», «Referits completats», «Comissions acumulades» i «Saldo de la cartera». A sota, **secció «Els nostres productes»**: catàleg accessible (`services` publicats) que el partner pot vendre, amb preu i quota, i acció directa «Nou referit» per a cada producte. També últims moviments i avisos. |
| **Els meus referits (`/referrals`)** | Llistat en targetes amb **estat + data** (sense dades personals del client); filtre per estat; cerca. |
| └ `/referrals/new` | Nou referit: nom client, telèfon, email, producte/servei, comentaris → genera `referral` amb `referral_code` (atribució). |
| └ `/referrals/:id` | Detall: timeline de `referral_events`, estat actual i valor; **NO** mostra dades personals del client. |
| **Cartera (`/wallet`)** | **Comissions pendents de cobrar** (llistat), **saldo acumulat de la cartera**, moviments (`wallet_ledger`) i **botó «Sol·licitar retirada»** habilitat si saldo ≥ `min_payout` (100 €). Explica quan es pot retirar i el termini (15 dies hàbils). |
| └ `/wallet/payouts` | Retirades: llista de `payouts` amb estat i data prevista de pagament. |
| Secundàries: `/materials`, `/profile`, `/notifications` | Biblioteca de materials, compte/perfil de l'organització (owner), notificacions d'hit. |

**Mobile:** bottom nav de 3 pestanyes, inputs touch-first, PWA offline shell (cache de shell) per a Android/iOS sense App Store; accessible, estats de càrrega/error i empty-states; taules/cards adaptades a pantalles petites.

### 5.2 Backoffice — Directus Studio (+ paneles React de POLSER si conviene)

Directus ya da el panel CRUD. Se configuran:
- **Referidos**: vista **Kanban por `status`** (lead→instalado) + tabla (filtros: partner, estado, Odoo sync) + panel de detalle con timeline y datos de cliente.
- **Partners**: CRUD + aprobación de onboarding (`pendente→actiu`), ficha con `partner_members`, contrato, wallet.
- **Comisiones**: ver `commission_rules` (solo CEO edita), revisar comisiones generadas por referido, **aprobación de retiradas** y factura inversa, revisar ledger.
- **Payouts**: bandeja de solicitudes → registrar factura recibida → marcar pagada (15 días hábiles).
- **Sincronización Odoo**: panel de `odoo_sync_log` con estado y **reintento/forzado** de operaciones fallidas.
- **KPIs (F6)**: dashboard con activación, reactivación, respuesta, nuevos partners/mes, NPS, funnel y valor atribuido.
- **Interacciones (CPSO/Irene)**: registro + acciones sobre partners/referidos.
- **Notificaciones / campañas**: enviar **on-demand desde el panel** a todos los partners (o a un segmento/perfil) una notificación in-app + push PWA; crear la campanya (títol, text, imatge), enviar ja o programar (p.ej. una campanya setmanal).
- **Kanban (backoffice):** nativo en Directus (layout Kanban de `referrals` por `status`) → sin librería externa. Nota valorada (CEO): `react-kanban-kit` (braiekhazem) — TypeScript, drag&drop Atlassian, 95 stars — pero **license NOASSERTION (sin definir)** → **no se adopta como dependencia hoy**; solo tendría sentido en un eventual panel React de POLSER, y entonces usar una lib MIT con licencia clara (pragmatic-drag-drop/@dnd-kit).

---

## 6. Lógica de negocio

### 6.1 Ciclo de vida del referido (máquina de estados)

```
lead ──► contactado ──► presupuesto ──► aceptado ──► instalado
  └──► perdido (en cualquier punto, con motivo)
```

**Gatillos y efectos (por transición):**
- **Creación (`lead`)**: dedupe (§6.2.6), asignación de atribución, notificación interna. `odoo_sync_status=pendiente` (aún no se crea nada en Odoo).
- **→ `aceptado`**: el comercial valida; evento de sync **Odoo: crear/actualizar `res.partner` y `sale.order`** (customer ya registrado). Marcar `odoo_sync_status`.
- **→ `instalado`**: **acreditar comisión de alta** (60 €) si aplica; para Col·laborador, activar `active_subscription` (si el cliente comienza a facturar) para permitir la recurrente. Evento sync Odoo (confirmar alta/instalación).
- **→ `perdido`**: no genera comisión; la de alta ya pagada **no revierte**; la recurrente se detiene si aplicó.
- **Baja del cliente** (señal desde Odoo o manual): `active_subscription=false` → **detener la comisión recurrente** (sin nuevas entradas). La de alta ya abonada no se revierte.

Las transiciones las ejecuta el comercial/admin en Directus (backoffice) o via API; se registran SIEMPRE en `referral_events` (auditoría).

### 6.2 Motor de comisiones

**Principio dominante (CEO, 09/09): la comisión se define centralizadamente en Odoo.** En Odoo hay un campo (ubicación a
definir en fase de sync) que indica **qué comisión se está cobrando** por cada venta/oportunidad. El PRM **lee de Odoo**
ese valor para reflejar y mostrar la comisión al partner; **no la decide ni la recalcula por su cuenta.** Que el partner
pueda elegir kit/servicio no cambia esto: la comisión siempre la dicta el dato de Odoo. La tabla `commission_rules` del
PRM es un **espejo/lectura** de lo que Odoo dicta, no la fuente autoritativa.

#### 6.2.1 Reglas de negocio (fuente: KB partners-program, §3 y regla CEO 08/09/2026)
| Caso | Regla |
|---|---|
| Comisión por alta | **60 € (IVA incl.)** para **ambos perfiles** (Afiliat y Col·laborador) al pasar a `instalado` |
| Comisión recurrente mensual | **10 % sobre la cuota de servicio** (mensual facturada), **solo perfil Col·laborador** (empresa/PIME). Período **indefinido** mientras el cliente esté activo |
| Afiliat (autónomo/persona física) | **SIEMPRE Afiliat → SOLO 60 € por alta; se le bloquea y ni se le ofrece ni se le menciona el 10 % mensual** (orden CEO 08/09/2026) |
| Base recurrente | `monthly_fee` real facturada (fuente Odoo §6.3) — para «A mida», la cuota contratada real |
| Baja del cliente | detiene recurrente; la comisión de alta ya devengada no se revierte |
| Pago/retención | cartera digital acumulada; el partner factura a POLSER (concepto del §7 settings); mínimo de retirada 100 €; pago en 15 días hábiles |

> Estas reglas describen la **intención de negocio**; su implementación **autoritativa vive en Odoo** (campo de comisión).
> El PRM las refleja para que el partner sepa qué espera, pero **el valor real acreditado sale del dato de Odoo**.

#### 6.2.2 Capas de cálculo (en Directus)
1. **Acreditación de alta**: `Flow` disparado en transición a `instalado` → lee `commission_rules` (kind=high, perfil del partner) → crea entrada `wallet_ledger` type=`high` amount=+60.
2. **Recurrente mensual**: `Flow`/cron diario → para cada `referral` del perfil Col·laborador con `active_subscription=true`, genera una entrada `recurring` del período (dedup por `partner+referral+period`) → amount=+`rate*base`. Añadido como **snapshot inmutable**.
3. **Retirada**: `portales` → si saldo ≥ `min_payout`, se crea `payouts` y se deduce saldo (entrada `payout_deduction`). El partner emite factura; admin registra `invoice_received_at`; a los `payout_days` → `pagada` (sync `create_vendor_bill` en Odoo opcional).
4. **Dedup de `recurring`**: constraint único `(partner, referral, period, type=recurring)` para no duplicar meses.
5. **Auditoría**: ninguna entrada del ledger se edita; las correcciones usan `reversal` autorizado por admin/CEO.

#### 6.2.3 Dónde se implementa
- La **comisión la define Odoo**: un campo sobre la venta/oportunidad (o plan de comisión) indica la comisión aplicada; ubicación exacta a definir en la fase de sync.
- El PRM **lee de Odoo** (vía n8n) el valor de la comisión (alta y/o recurrente) → acredita `wallet_ledger` y cartera del partner.
- El **cálculo de cartera y retiradas** (saldo, mínimo 100 €, factura inversa, 15 días) vive en el PRM (Flows o extensión TS dedicada; recomendada la extensión para el ledger por su criticidad).
- `settings`/`commission_rules` del PRM se mantienen como **referencia/espejo** de la intención, no como criterio de cálculo.

#### 6.2.4 Comisiones especiales/volumen (CEO)
Exclusivas de CEO: `commission_rules.partner_override` (ratio/distinto fixed vinculado a un partner) o `adjustment` manual en el ledger. **Ningún agente/empleado (IA incluida) puede modificarlas.**

#### 6.2.5 Regla CEO autónomos — enforcement en varias capas
- `commission_rules`: el perfil `afiliat` tiene `allow_recurring=false`.
- Validación en **API/hook** que impida crear una `referral` con perfil Afiliat y `kind=recurring`.
- La UI del portal **no muestra** la opción «recurrente» a un Afiliat (solo cartera de alta).
- Test específico mínimo en F6 (§ prueba que un autónomo jamás recibe 10 %).

#### 6.2.6 Regla de atribución y dedupe
- Cada partner tiene `referral_code`; el referido se atribuye al primer partner que lo registra.
- Al crear `referral`, el sistema comprueba `client_phone`/`client_email` contra `referrals` existentes y contra el propio partner (`self_referral`). Si duplicado/auto → marca, bloquea comisión y notifica a admin (decisión manual CEO/admin con `partner_override` para excepciones).
- Atribución por timestamps; nunca se sobrescribe salvo excepción documentada.

### 6.3 Sincronización con Odoo (sales)

**Modelo de fuentes de verdad (CEO, 09/09): Odoo es la base operativa y el PRM cuelga de Odoo.**
- **Odoo** = fuente de verdad autoritativa: oportunidad comercial, venta, facturación y **definición de la comisión** (campo). Toda la data operativa se centraliza aquí.
- **PRM (Directus)** = capa de partner que **lee de Odoo**: muestra el estado y la comisión que Odoo define, y gestiona cartera/retiradas. Refleja, no duplica con criterio propio.

**Vínculo dominante:** todo referido que un partner nos deriva se vincula **directamente a una Oportunidad del CRM de
Odoo (`crm.lead`)**. De esa oportunidad cuelgan los **presupuestos** (cotizaciones), la **suscripción/cuota mensual** y
las **facturas**; la **comisión se extrae de esos datos financieros vinculados a su oportunidad**. El referido guarda
`odo_opportunity_id` como ancla. (El detalle técnico del cálculo de comisiones se define en una fase posterior.)

En Odoo se gestionan las **sales** (clientes `res.partner`, oportunidad `crm.lead`, pedidos `sale.order`, facturas
`account.move`). El PRM mantiene los referidos con `odo_opportunity_id`/`odo_customer_id`/`odo_sale_id` y sincroniza para
que la facturación refleje la oportunidad real y dé base a la comisión recurrente.

#### 6.3.1 Flujo contiene (PRM → Odoo) — vía n8n o extensión
- **Gatillo**: alta del referido / transición `aceptado` / `instalado` → webhook a n8n (`POST /webhooks/odoo-sync`).
- **Pasos n8n**: crea/víncula la **oportunidad `crm.lead`** en Odoo (o la localiza por `odo_opportunity_id`/código del PRM) → busca/reusa `res.partner` por teléfono/email → cuelga de la oportunidad el presupuesto y, al pasar a `instalado`, mantiene la relación con `sale.order`/facturas → PATCH `referrals.odo_opportunity_id`/`odo_customer_id`/`odo_sale_id` → `odoo_sync_log` (success/failed).
- **Idempotencia**: si ya existe `odo_opportunity_id`, no duplica la oportunidad; se localiza por referencia/código del PRM.
- **Retentivas**: cola de n8n con reintentos; `odoo_sync_log` permite re-emitir operaciones fallidas.

#### 6.3.2 Flujo callback (Odoo → PRM) — recurrente mensual
- El **cobro mensual de la alarma se factura en Odoo** (subscripción/recurring documents o donde viva la gestión de ingresos), siempre ligado a la oportunidad del referido.
- n8n, **diariamente**, consulta Odoo el **estado financiero de la oportunidad** (`crm.lead` → suscripción/facturas activas) → PATCH `referrals.active_subscription` (true si el cliente sigue facturándose, false si baja). De ahí se extrae la base de la comisión recurrente.
- El cron de comisión recurrente (§6.2.2) lee `active_subscription` y genera el 10 % mensual.

> Nota crítica (heredada): la comisión recurrente **solo es fiable si las cuotas mensuales se facturan dentro de Odoo**. Si algún día la facturación de alarmas sale de Odoo, la señal `active_subscription` debe venir de esa fuente (n8n) igualmente. Ver decisión en §10.

#### 6.3.3 Reversa (payouts)
- Al registrar una retirada el partner emite factura; admin a `pagada` → (opcional) n8n crea `account.move` de **factura de proveedor** en Odoo vinculada al pago; se registra en `odoo_vendor_bill_id`.

#### 6.3.4 Endpoints Odoo a usar (confirmar versión exacta en F0)
- `res.partner`, `sale.order`, `account.move` (facturas), `account.payment`, modelo de subscripción/recurring según módulo instalado.
- Estrategia de API: JSON-RPC (``/jsonrpc`) o XML-RPC (`/xmlrpc/2/object`) autenticado con un usuario técnico de Odoo (nunca admin@). Confirmar en la instancia real.

### 6.4 Notificaciones y automatismos (n8n)
- Email/mail a partner en hitos: referido registrado, `aceptado`, `instalado`, comisión devengada, saldo ≥ 100 €, hito de retirada.
- Avisos internos (Telegram/email) a admin/CEO en: referido `perdido` tras SLA, sync Odoo fallida, retirada pendiente, nuevo partner a validar.
- La **AI (agentes)** se identifica como tal si opera con terceros (EU AI Act); las automatizaciones internas no requieren identificación.

#### 6.4.1 Notificaciones on-demand (broadcast a partners) desde Directus
- **Cas d'ús:** des del panel de Directus, l'admin/CEO crea una notificació (títol + text + imatge opcional, ex. creatiu de campanya per penjar al WhatsApp) i la envia **a tots els usuaris de l'app** (o a un segment: `all`, `afiliats`, `colaboradors`, o un partner concret), **ara o programada** (`scheduled_at`).
- **Dos canals:**
  - **In-app:** la notificació es desa a `notifications` i el portal la rep a l'instant via **Directus Realtime** (sense recarregar). Visible a la secció de notificacions del portal.
  - **Push PWA (Web Push API, VAPID):** per arribar fins i tot amb l'app **tancada**. El service worker del portal gestiona la subscripció push de cada usuari; l'enviament el fa **n8n** (o una operació/extensió Directus) que crida `web-push`. Funciona a Android (Chrome) i iOS (16.4+), sense App Store.
- **Mecànica del botó «Enviar»:** crear el registre a `notifications` (status `queued`) → n8n llegeix els destinataris (totes les subscripcions push del segment + in-app) → dispara `web-push` → marca `sent_at`/`status=sent` i registra entregues a `notification_deliveries`.
- Això cobreix la **campanya setmanal** (programable) i qualsevol avís puntual a sota demanda.

### 6.5 RGPD y seguridad
- Minimización: en el portal los partners ven solo **estado/fecha**, nunca datos personales del cliente referido.
- Consentimiento de clientes referidos (base legitimada) y **DPA con partners**.
- Cifrado en tránsito (TLS Cloudflare Tunnel / Pages) y en reposo; backups `pg_dump` diarios con retención; restauración probada antes de go-live.
- Borrado: anonimización de `client_*` si se solicita; `partners` → `bloquejat` lógico.
- RBAC y auditoría (`referral_events`, `odoo_sync_log`, `wallet_ledger`).

---

### 6.6 Autenticació sense contrasenya (email OTP) — P0

- **Motiu:** elimina la gestió de contrasenyes (i l'«he oblidat la meva contrasenya») per a partners.
- **Flux:**
  1. El partner obre la PWA i **introdueix el seu email** (el que està assignat al seu `partner_members`/`directus_users`).
  2. El servei valida que l'email pertany a un **partner actiu** → genera un **codi OTP d'un sol ús** (6 dígits, criptogràficament segur) amb TTL curt (5–10 min) i l'envia per **email (SMTP/n8n)**.
  3. El partner introdueix el codi → es verifica (hash + TTL + un sol ús) → s'emet la sessió.
- **Sessió llarga "màxim possible":** token de refresc llarg **≈ 1 mes (sliding)**, re-emès amb activitat; token d'accés curt. Revocable pel servidor (admin pot tancar totes les sessions d'un partner).
- **Seguretat mínima:** rate-limit de sol·licituds OTP (ex. 5/h per email), bloqueig temporal per intents fallits, codi single-use amb TTL curt, registre d'intents; **re-OTP només per a accions sensibles** (ex. cartera, si es configura).
- **Implementació:** extensió Directus `extensions/auth-otp` (rutes `POST /auth-otp/request-otp`
  i `POST /auth-otp/verify-otp`; Directus prefixa els endpoints pel nom de l'extensió); emmagatzematge de
  codis a `auth_otps` (hash + expiració); s'emet un JWT de Directus. Els usuaris de rol `partner` no necessiten
  contrasenya; els rols POLSER interns mantenen contrasenya + 2FA.
- Inclòs en F3/F4 (auth + portal).

## 7. Catálogo de servicios (datos semilla — fuente KB alarmes-productes)
| code | Servicio | Sector | Alta | Mensual | IVA | Comisión recurrente (base) |
|---|---|---|---|---|---|---|
| `pis` | Per pisos | residencial | 599 € | 27,99 € | incl. | 10 % s/27,99 € |
| `casa` | Per cases | residencial | 749 € | 29,99 € | incl. | 10 % s/29,99 € |
| `oficina` | Per oficines | negocio | 549 € | 27,99 € | no incl. | 10 % s/27,99 € |
| `botiga` | Per botigues | negocio | 699 € | 34,99 € | no incl. | 10 % s/34,99 € |
| `amida` | A mida | ambos | pressupost | a definir | — | 10 % s/cuota real facturada |

(Alta = `services.alta_fee`; mensual = `services.monthly_fee`, base de la comisión recurrente.)

---

## 8. Roadmap (12 semanas)

| Fase | Contenido | Entregable / acepción |
|---|---|---|
| **F0 · Decisiones y spec** | Cerrar fuente de Odoo para `active_subscription` (§6.3), endpoint Odoo, export partners (NocoDB/Odoo), idioma portal, aprobar UI/tema, reglas comisión finales, RGPD/DPA | Checklist firmado; backlog P0 cerrado |
| **F1 · Infra y BD** | Docker Compose (postgres + directus + cloudflared), BBDD del PRM, migraciones SQL (schema §3), backups, TLS (Cloudflare Tunnel + Pages) | `docker compose up` limpio; migraciones aplicadas; pg_dump OK |
| **F2 · Directus modelado** | Crear colecciones §3, roles/permissions §4, seed `services`/`settings`, seed `commission_rules`, Flows base (estados) | Modelo versionado en repo; RBAC operativo |
| **F3 · API y auth** | Restricciones de `partner_members`, aislamiento por partner, endpoints para React, validaciones (dedupe, regla autónomos) | API: crear partner/referido, mover estado, saldo por partner |
| **F4 · Portal React PWA** | Login, dashboard, referidos (lista/nuevo/detalle), wallet, materials, notifications; PWA manifest+SW, mobile-first | Un partner de prueba refiere y ve el estado desde el móvil |
| **F5 · Motor comisiones + sync Odoo** | Flows acreditación alta/recurrente, retiradas+factura inversa, n8n sync sales Odoo (§6.3), `odoo_sync_log`, reintentos | Cálculo verificado contra caso real (alta + recurrente); venta reflejada en Odoo |
| **F6 · P1 + QA/seguridad** | KPIs, 2FA, alertas SLA, panel Odoo sync (reintento/forzado), pruebas (incl. regla autónomos), RGPD (DPA/borrado), go-live en paralelo con Odoo | Ciclo completo: referido→instalado→comisión→retirada→pago; go-live aprobado |
| **F7 · Retirada de operativa manual** | Formación interna (CPSO/admin), migración definitiva partners, desactivar NocoDB/n8n forms para referidos | Portal en producción; operativa manual descontinuada |

**MVP = F1–F5** (portal + ciclo referido + motor comisiones + sync Odoo). Criterio de salida: un Col·laborador y un Afiliat reales operan referidos, estados y cartera; admin liquida comisiones; la venta sincroniza con Odoo — sin hojas de cálculo.

---

## 9. Riesgos y mitigaciones
| Riesgo | Impacto | Mitigación |
|---|---|---|
| Dependencia de `active_subscription` correcto para la recurrente | Alto | Fuente única de facturación definida en F0 (§6.3.2); snapshot reconciliable mensual |
| BSL 1.1 (=source-available, no OSI) | Medio | Gratis para el tamaño POLSER; pinnear versión; leer change date; esquema exportable a SQL estándar |
| Regla CEO autónomos mal aplicada | Alto | Enforcement en 3 capas (§6.2.5) + test |
| Datos históricos sucios (NocoDB) | Medio | Limpieza en F0/F5; import idempotente con informe de duplicados |
| Fuga de datos RGPD de clientes a partners | Alto | Portal solo muestra estado/fecha; minimización; DPA |
| Sync Odoo asíncrono falla | Medio | `odoo_sync_log` + reintentos + cola n8n; panel de reintento/forzado |
| Alcance (features PRM enterprise) | Medio | P0/P1 cerrados; MDF/TCMA/certificación descartados explícitamente |
| Coste usario por partner | — | Eliminado: Directus self-hosted usuarios ilimitados gratis |

---

## 10. Próximos pasos y decisiones pendientes (checklist F0)
- [ ] **Confirmar arquitectura** Directus + React PWA + PostgreSQL (este documento v1.0).
- [ ] Cerrar cómo se **vincula cada referido a su oportunidad `crm.lead`** en Odoo y de dónde se extrae el estado financiero (`active_subscription`) para la comisión. (Detalle del cálculo de comisiones: **fase posterior**, abierto.)
- [ ] Proteger o crear **usuario técnico de Odoo** para la sync.
- [ ] **Export de partners actuales** (NocoDB + Odoo) para el plan de migración.
- [ ] Confirmar **globales** (§7/services, `settings`, reglas de comisión) y regla CEO autónomos.
- [ ] Decidir **idioma del portal** (catalán recomendado, marca POLSER).
- [ ] Verificar **licencia BSL** y change date de la versión de Directus a pinnear.
- [ ] Aprobar **tema/UI** del portal y estructura de páginas (§5.1).
- [ ] Fijar **fecha de kickoff F1**.

---

*Documento generado por Pol (Chief of Staff, agente IA) el 08/09/2026. Fuentes: KB compartida POLSER (`alarmes-productes.md`, `partners-program.md`), skills `polser-platform-architecture`, `software-evaluation`, benchmark PRM 2025-2026. Precios, cuotas y reglas de comisión según KB; no inventar condiciones fuera de ella.*