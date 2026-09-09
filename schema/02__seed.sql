-- =====================================================================
-- PRM POLSER — Dades semilla (catàleg de serveis + configuració)
-- Font: KB alarmes-productes (polser.cat/alarmes, 28/08/2026)
--   psql "$DATABASE_URL" -f schema/02__seed.sql
-- =====================================================================

-- Catàleg de serveis (base de la comissió recurrent = monthly_fee)
INSERT INTO services (code, name, category, sector, alta_fee, monthly_fee, iva_included, details) VALUES
  ('pis',      'Per pisos',              'alarma', 'residencial', 599.00, 27.99, true,  '{"detectors":3,"aviso_policia":true,"app":true}'),
  ('casa',     'Per cases',              'alarma', 'residencial', 749.00, 29.99, true,  '{"detectors":5,"aviso_policia":true,"app":true}'),
  ('oficina',  'Per oficines',           'alarma', 'negocio',     549.00, 27.99, false, '{"detectors":3,"gestio_usuaris":true}'),
  ('botiga',   'Per botigues',           'alarma', 'negocio',     699.00, 34.99, false, '{"detectors":3,"sirena":true,"panic":true,"videovigilancia":true,"cameras":2}'),
  ('amida',    'A mida (residencial)',   'alarma', 'residencial', NULL,   NULL,  true,  '{"pressupost":true}'),
  ('amida-neg', 'A mida (negoci)',       'alarma', 'negocio',     NULL,   NULL,  false, '{"pressupost":true,"analitica_video":true}')
ON CONFLICT (code) DO NOTHING;

-- Configuració global
INSERT INTO settings (id, min_payout, payout_days, default_fixed_commission, default_recurring_rate, invoice_concept)
VALUES (1, 100, 15, 60, 0.10, 'Assistència comercial a POLSER SEGURETAT, SL')
ON CONFLICT (id) DO NOTHING;

-- =====================================================================
-- FI DEL SEED
-- =====================================================================