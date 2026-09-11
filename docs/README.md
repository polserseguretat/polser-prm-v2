# Documentació — PRM POLSER (v2 · PocketBase)

Índex central de la documentació del **PRM** (Partner Relationship Management) de
**POLSER SEGURETAT, SL**. Aquests documents descriuen **com funciona el sistema, com es
configura i com s'opera** sobre l'implementació actual (stack PocketBase).

> Font de veritat: codi del repo (`pb_hooks/`, `pb_migrations/`, `portal/`).
> La KB externa (preus/comissions/partners) viu a `~/.hermes/knowledge/`, no es duplica aquí.

## Documents

| Document | Contingut |
|---|---|
| [`01-ARQUITECTURA.md`](01-ARQUITECTURA.md) | Stack, components, flux d'alt nivell, mapa de responsabilitats dels hooks, decisions d'arquitectura |
| [`02-MODEL-DADES.md`](02-MODEL-DADES.md) | Les 16 col·leccions, camps, índexs, migracions i regles d'integritat |
| [`03-CONFIGURACIO.md`](03-CONFIGURACIO.md) | Totes les variables d'entorn, com es configura l'app (appName/URL/SMTP), install.sh pas a pas |
| [`04-INTEGRACIO-ODOO.md`](04-INTEGRACIO-ODOO.md) | Outbox, API JSON-2, els 6 crons, mapeig d'estats etapa↔status, model de comissions i idempotència |
| [`05-RUNBOOK-OPERACIONS.md`](05-RUNBOOK-OPERACIONS.md) | Desplegar, superuser, logs, còpies de seguretat, troubleshooting, problemes coneguts |

Documents de treball existents al repo (judici històric / tasques, no documentació operativa):
- `TASQUES_AGENT_POCKETBASE.md` — auditoria i tasques pendents de l'agent de codi.
- `PENDENT_revisio_perdido.md` — revisió de la detecció de leads perdudes.
- `unif_finances_euros.md` — motiu i detall de la unificació monetària a euros.

## Guia ràpida de lectura

1. **"Com funciona?":** comença per `01-ARQUITECTURA.md` (una frase + diagrama) i segueix a
   `04-INTEGRACIO-ODOO.md` (el cor: com es mouen els diners i l'estat entre PRM i Odoo).
2. **"Com ho desplego / configure?":** `03-CONFIGURACIO.md` + `05-RUNBOOK-OPERACIONS.md`.
3. **"Quines dades hi ha?"** `02-MODEL-DADES.md`.

## Conviccions / metadades

- **LLOC:** tot en català (UI i docs). Marca POLSER: primary `#042149`, accent `#FF6B00`.
- **Moneda canònica:** EUROS amb 2 decimals (migració `004`). Mai cèntims, mai floats.
- **Deploy actual verificat:** `https://prm.polser.cat` (root → portal, `/api/health` → `200`).
- **Versió pinneada:** PocketBase `0.40.3`.

---
*Documentació generada per Pol (CoS) · 11/09/2026.*