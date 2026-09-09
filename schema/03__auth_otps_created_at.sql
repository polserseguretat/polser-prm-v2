-- =====================================================================
-- PRM POLSER — Migració 03: auth_otps.created_at
-- Necessari per a l'extensió d'OTP (F3): ordenar/netejar codis per temps.
-- Aplicar només si ja es va executar 01__schema.sql abans d'aquest canvi.
-- =====================================================================

ALTER TABLE auth_otps ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();