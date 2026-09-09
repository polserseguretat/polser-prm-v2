-- =====================================================================
-- PRM POLSER — Migració 04: directus_users.partner
-- Necessari per a l'aïllament per partner (F4): filtrar referits/cartera
-- per $CURRENT_USER.partner. El valor es manté sincronitzat amb
-- partner_members (extensions/partners).
-- =====================================================================

ALTER TABLE directus_users ADD COLUMN IF NOT EXISTS partner uuid REFERENCES partners(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_directus_users_partner ON directus_users (partner);