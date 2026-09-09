-- =====================================================================
-- PRM POLSER — Esquema de dades (PostgreSQL)
-- Font de veritat del model: PLAN_IMPLEMENTACIO_PRM_DIRECTUS.md (secció 3)
-- Aplicar contra la BBDD 'prm' UN COP a la primera arrencada i en cada canvi
-- de model. Directus descobreix aquestes taules com a col·leccions.
--
--  psql "$DATABASE_URL" -f schema/01__schema.sql
-- =====================================================================

-- gen_random_uuid() està al nucli de PostgreSQL ≥13. La creem per seguretat.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================================================
-- ENUMS
-- =====================================================================
CREATE TYPE partner_profile  AS ENUM ('afiliat','colaborador');
CREATE TYPE partner_type     AS ENUM ('inmobiliaria','administrador_fincas','operador_telecom','autonomo','otro');
CREATE TYPE partner_status   AS ENUM ('pendente','actiu','inactiu','bloquejat');
CREATE TYPE member_role      AS ENUM ('owner','editor','viewer');
CREATE TYPE service_category AS ENUM ('alarma','videovigilancia','manteniment');
CREATE TYPE service_sector   AS ENUM ('residencial','negocio','comunidades','industria');
CREATE TYPE referral_status  AS ENUM ('lead','contactado','presupuesto','aceptado','instalado','perdido');
CREATE TYPE referral_source  AS ENUM ('portal','whatsapp','email','telefono','web');
CREATE TYPE sync_status      AS ENUM ('pendiente','ok','error');
CREATE TYPE rule_profile     AS ENUM ('afiliat','colaborador','all');
CREATE TYPE rule_kind        AS ENUM ('high','recurring','adjustment','reversal');
CREATE TYPE wallet_type      AS ENUM ('high','recurring','adjustment','payout_deduction','reversal');
CREATE TYPE wallet_status    AS ENUM ('accrued','poised','paid','reversed','void');
CREATE TYPE payout_status    AS ENUM ('solicitada','factura_rebuda','en_proces','pagada');
CREATE TYPE int_channel      AS ENUM ('whatsapp','email','telegram','telefono','portal');
CREATE TYPE int_direction    AS ENUM ('inbound','outbound');
CREATE TYPE int_type         AS ENUM ('onboarding','followup','reactivation','info','complaint');
CREATE TYPE int_outcome      AS ENUM ('positive','neutral','negative','pending');
CREATE TYPE notif_audience   AS ENUM ('all','afiliats','colaboradors');
CREATE TYPE notif_channel    AS ENUM ('inapp','push','both');
CREATE TYPE notif_status     AS ENUM ('draft','queued','sent','failed');
CREATE TYPE sync_action      AS ENUM ('create_customer','create_sale','update_sale_status','read_subscription','create_vendor_bill','create_opportunity');
CREATE TYPE source_entity    AS ENUM ('referral','partner','payout');

-- =====================================================================
-- TAULES DE NEGOCI
-- =====================================================================

-- Catàleg de serveis (dades al 02__seed.sql; font KB alarmes-productes)
CREATE TABLE services (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code         text NOT NULL UNIQUE,
    name         text NOT NULL,
    category     service_category NOT NULL,
    sector       service_sector NOT NULL,
    alta_fee     numeric(10,2),
    monthly_fee  numeric(10,2),
    iva_included boolean NOT NULL DEFAULT false,
    details      jsonb,
    active       boolean NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- Partner / organització
CREATE TABLE partners (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text NOT NULL,
    profile         partner_profile NOT NULL DEFAULT 'afiliat',
    type            partner_type NOT NULL,
    nif             text UNIQUE,
    email           text UNIQUE,
    phone           text,
    address         text,
    status          partner_status NOT NULL DEFAULT 'pendente',
    activation_date timestamptz,
    contract_file   uuid,                  -- fk directus_files (Directus gestiona)
    notes           text,
    created_by      uuid,                  -- fk directus_users (Directus gestiona)
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Cuenta(s) d'usuari del portal vinculades al partner (Directus Users)
CREATE TABLE partner_members (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    partner         uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
    "user"          uuid NOT NULL,          -- fk directus_users (Directus); "user" és reservat a PG
    role_in_partner member_role NOT NULL DEFAULT 'viewer',
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (partner, "user")
);

-- Referit / la venta (el cor del PRM)
CREATE TABLE referrals (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    partner             uuid REFERENCES partners(id) ON DELETE SET NULL,
    referral_code       text,
    client_name         text NOT NULL,      -- RGPD: mínim; només intern
    client_phone        text,
    client_email        text,
    client_address      text,
    service             uuid REFERENCES services(id) ON DELETE SET NULL,
    service_type        service_category,
    status              referral_status NOT NULL DEFAULT 'lead',
    stage_date          timestamptz NOT NULL DEFAULT now(),
    estimated_value     numeric(12,2),
    final_value         numeric(12,2),
    active_subscription boolean NOT NULL DEFAULT false,  -- sincro Odoo (§6.3)
    odo_opportunity_id  integer,            -- id crm.lead Odoo (ancla del referit)
    odo_customer_id     integer,            -- id res.partner Odoo
    odo_sale_id         integer,            -- id sale.order Odoo
    odoo_sync_status    sync_status NOT NULL DEFAULT 'pendiente',
    source              referral_source NOT NULL DEFAULT 'portal',
    self_referral       boolean NOT NULL DEFAULT false,
    notes               text,
    created_by          uuid,               -- fk directus_users
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_referrals_partner  ON referrals (partner);
CREATE INDEX idx_referrals_status   ON referrals (status);
CREATE INDEX idx_referrals_phone    ON referrals (client_phone);
CREATE INDEX idx_referrals_odo_opp  ON referrals (odo_opportunity_id);

-- Historial de transicions (auditoria)
CREATE TABLE referral_events (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    referral    uuid NOT NULL REFERENCES referrals(id) ON DELETE CASCADE,
    from_status referral_status,
    to_status   referral_status NOT NULL,
    changed_by  uuid,                       -- fk directus_users
    reason      text,
    lost_reason text,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_referral ON referral_events (referral);

-- Regles de comissió (ESPEC: el valor final el dicta Odoo; taula = espejo)
CREATE TABLE commission_rules (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text NOT NULL,
    profile         rule_profile NOT NULL,
    kind            rule_kind NOT NULL,
    service         uuid REFERENCES services(id) ON DELETE CASCADE,
    fixed_amount    numeric(10,2),
    rate            numeric(6,4),
    base            text,                   -- 'monthly_fee' | 'amount_invoiced'
    allow_recurring boolean NOT NULL DEFAULT false,
    partner_override uuid REFERENCES partners(id) ON DELETE CASCADE,
    active          boolean NOT NULL DEFAULT true,
    valid_from      timestamptz,
    valid_to        timestamptz,
    created_by      uuid,                   -- SOLO rol POLSER_ceo
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- Cartera digital (moviments IMMUTABLES; correccions = reversal)
CREATE TABLE wallet_ledger (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    partner     uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
    referral    uuid REFERENCES referrals(id) ON DELETE SET NULL,
    type        wallet_type NOT NULL,
    amount      numeric(12,2) NOT NULL,     -- signat: +comissió, -retirada
    period      text,                       -- YYYY-MM (recurring)
    status      wallet_status NOT NULL DEFAULT 'accrued',
    description text,
    created_by  uuid,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ledger_partner ON wallet_ledger (partner);
-- Deduplicació de la recurrent mensual (1 per partner+referral+periode)
CREATE UNIQUE INDEX uq_ledger_recurring
    ON wallet_ledger (partner, referral, period)
    WHERE type = 'recurring';

-- Retirades / factura inversa
CREATE TABLE payouts (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    partner            uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
    amount             numeric(12,2) NOT NULL,
    invoice_reference  text,
    invoice_received_at timestamptz,
    status             payout_status NOT NULL DEFAULT 'solicitada',
    paid_at            timestamptz,
    odo_vendor_bill_id integer,             -- factura proveïdor Odoo
    created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_payouts_partner ON payouts (partner);

-- Log d'interaccions amb partners (CPSO / Irene)
CREATE TABLE interactions (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    partner    uuid REFERENCES partners(id) ON DELETE CASCADE,
    referral   uuid REFERENCES referrals(id) ON DELETE SET NULL,
    channel    int_channel NOT NULL,
    direction  int_direction NOT NULL,
    type       int_type NOT NULL,
    summary    text,
    outcome    int_outcome NOT NULL DEFAULT 'pending',
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_interactions_partner ON interactions (partner);

-- Biblioteca de materials (portal)
CREATE TABLE documents (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title      text NOT NULL,
    type       text,
    category   text,
    file       uuid,                        -- fk directus_files
    version    text,
    published  boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Notificacions / campanyes on-demand (§6.4.1)
CREATE TABLE notifications (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title        text NOT NULL,
    body         text,
    image        uuid,                      -- fk directus_files
    audience     notif_audience NOT NULL DEFAULT 'all',
    channel      notif_channel NOT NULL DEFAULT 'both',
    scheduled_at timestamptz,
    sent_at      timestamptz,
    status       notif_status NOT NULL DEFAULT 'draft',
    created_by   uuid,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notification_deliveries (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    notification uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    "user"         uuid NOT NULL,             -- fk directus_users
    delivered_at timestamptz,
    read_at      timestamptz,
    UNIQUE (notification, "user")
);

-- Auditoria de sincronització amb Odoo (§6.3)
CREATE TABLE odoo_sync_log (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entity        source_entity NOT NULL,
    entity_id     uuid,
    action        sync_action NOT NULL,
    odoo_operation text,
    status        sync_status NOT NULL DEFAULT 'pendiente',
    error         text,
    attempts      integer NOT NULL DEFAULT 0,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Configuració global
CREATE TABLE settings (
    id                        integer PRIMARY KEY DEFAULT 1,
    min_payout                numeric(10,2) NOT NULL DEFAULT 100,
    payout_days               integer NOT NULL DEFAULT 15,
    default_fixed_commission  numeric(10,2) NOT NULL DEFAULT 60,
    default_recurring_rate    numeric(6,4) NOT NULL DEFAULT 0.10,
    recurring_enabled         boolean NOT NULL DEFAULT true,
    invoice_concept           text NOT NULL DEFAULT 'Assistència comercial a POLSER SEGURETAT, SL',
    sla_days_no_contact       integer NOT NULL DEFAULT 7,
    CONSTRAINT settings_single_row CHECK (id = 1)
);

-- OTP per al login sense contrasenya (§6.6) — emmagatzemem el HASH del codi
CREATE TABLE auth_otps (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email      text NOT NULL,
    code_hash  text NOT NULL,
    expires_at timestamptz NOT NULL,
    used       boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_otps_email ON auth_otps (email);

-- =====================================================================
-- FI DE L'ESQUEMA
-- =====================================================================