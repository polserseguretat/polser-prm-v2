# PRM POLSER

Portal de partners i gestió de referits/comissions de **POLSER SEGURETAT, SL**.
PRM a mesura, **extern a Odoo**: sense cost per usuari, amb lògica de negoci pròpia i
pensat per a mòbil.

**Stack:** [Directus](https://directus.io) (sobre **PostgreSQL**) + **portal React (PWA)**.
Publicació: **Cloudflare Tunnel** per a l'API Directus i **Cloudflare Pages** per al portal.
Integració amb **Odoo** (sales) i **n8n** (orquestació) per API.

> Document de referència complet: [`PLAN_IMPLEMENTACIO_PRM_DIRECTUS.md`](PLAN_IMPLEMENTACIO_PRM_DIRECTUS.md)
> (models, vistes, motor de comissions, sincronització amb Odoo, roadmap).

---

## Arquitectura (una frase)

Odoo és la base operativa i la font de veritat; el PRM és la capa de partner que hi **penja**
(llegeix la comissió que dicta Odoo, gestiona cartera i retirades). Esquema al plan §3 i §6.

```
Internet ── Cloudflare ──┬── partners.polser.cat ───► Cloudflare Pages ─► portal React (PWA)
                         │                                └─ fetch cross-origin
                         └── api.partners.polser.cat ──► Cloudflare Tunnel ─► Directus (API + admin) ─► PostgreSQL
                                             ├── n8n (integracions/Odoo, emails, push)
                                             └── Odoo 19 (operacions internes + facturació) ── sync de sales
```

---

## Quickstart (F1)

```bash
# 0) copia i omple les variables d'entorn
cp .env.example .env
#    - POSTGRES_*  → BBDD del PRM
#    - DIRECTUS_*  → KEY/SECRET (aleatoris) i admin
#    - VITE_DIRECTUS_URL / PUBLIC_URL / CORS_ORIGIN segons el teu entorn

# 1) eschema de dades (només a la primera arrencada / en canvis de model)
#    (necessites el Postgres aixecat: docker compose up -d db)
docker compose up -d db
docker compose exec db psql -U prm -d prm -f / -c "\i /tmp/nonexistent" 2>/dev/null || true
# Més fàcil: aplica-ho copiant el fitxer al contenidor o amb psql cap al port publicat (5432):
#   PGPASSWORD=... psql -h localhost -p 5432 -U prm -d prm -f schema/01__schema.sql
#   PGPASSWORD=... psql -h localhost -p 5432 -U prm -d prm -f schema/02__seed.sql

# 2) Directus
docker compose up -d directus   # http://localhost:8055 → panel admin (Directus Studio, accés local)

# 3) portal React PWA (build local per pujar-lo a Cloudflare Pages)
cd portal && npm install && npm run build   # genera portal/dist
#    Desplega portal/dist a Cloudflare Pages (direct upload amb wrangler o connexió git).
#    En el build de producció de Pages defineix la variable VITE_DIRECTUS_URL=https://api.partners.polser.cat

# 4) Cloudflare Tunnel (exposa Directus per API)
#    Crea el túnel a Zero Trust i el public hostname api.partners.polser.cat → http://directus:8055,
#    posa el token a .env (CLOUDFLARE_TUNNEL_TOKEN) i:
docker compose up -d cloudflared
```

> Després de pujar l'esquema, a Directus assigna les col·leccions (parts/serveis),
> crea els rols (§4) i els `commission_rules`/decisió Odoo (F0). Vegeu el plan.

---

## Estructura

```
polser-prm/
├── docker-compose.yml     # postgres + directus + cloudflared (túnel)
├── .env.example           # variables d'entorn (copy → .env, mai commitgem .env)
├── README.md
├── PLAN_IMPLEMENTACIO_PRM_DIRECTUS.md   # el plan (models, lògica, roadmap)
└── schema/
    ├── 01__schema.sql     # DDL del model de dades (§3) — enums, taules, índexs
    └── 02__seed.sql       # catàleg de serveis + configuració (KB)
└── portal/                # React PWA (mobile-first, bottom-nav: Inici / Els meus referits / Cartera)
    └── public/              # manifest + sw.js (el SPA fallback el gestiona wrangler.jsonc)
```

---

## Decisions clau (DR — Decision Records)

| Data | Decisió |
|---|---|
| 08/09/2026 | Stack del PRM: **Directus (PostgreSQL) + portal React PWA**, extern a Odoo (cost per usuari d'Odoo no rentable per a partners). |
| 08/09/2026 | **Comissió definida a Odoo** (camp) i el PRM hi penja; el portal reflecteix, no decideix. |
| 08/09/2026 | Login **sense contrasenya (email OTP)** amb sessió llarga (~1 mes) per a partners. |
| 08/09/2026 | Notificacions/campanyes **on-demand** des del panel (in-app + push PWA). |
| 08/09/2026 | Kanban de referits: **natiu de Directus**, sense llibreria externa (react-kanban-kit descartat: llicència NOASSERTION). |
| 08/09/2026 | Infra: **Caddy substituït per Cloudflare Tunnel (API) + Cloudflare Pages (portal)**. TLS i DNS a Cloudflare; Directus a l'arrel d'`api.` i portal estàtic a `partners.`. |

---

## Seguretat

- `.env` i credencials **no** es commitegen (`.gitignore`).
- Backup: `pg_dump` diari + retenció; restauració provada abans del go-live.
- RGPD: el portal del partner **no mostra dades personals** del client referit (només estat/data).
- Directus: percepcions dades personals; DPA amb partners; borrat/anonimització.

---

## Llicència / nota

Codi propi de POLSER (repo privat). **Directus** és **BSL 1.1** (self-hosted gratuït per a
<5 M€ de facturació i <50 empleats; source-available). Pinnear la versió de Directus i revisar
la *change date*. Detalls a `PLAN_IMPLEMENTACIO_PRM_DIRECTUS.md` §2 i §9.