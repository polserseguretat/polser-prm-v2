-- =====================================================================
-- PRM POLSER — Migració 07: motor d'automatitzacions amb n8n
--
-- Decisió (CEO, 09/09/2026): la lògica de negoci s'orquestra amb n8n, no
-- amb Directus Flows (la llicència free en limita el nombre). El disparador
-- d'events el gestiona el mateix n8n: el nodo "Postgres Trigger" (mode
-- 'Table Row Change Events') CREA el seu propi trigger sobre `referrals`
-- (AFTER INSERT → pg_notify) quan s'activa el workflow i l'elimina en
-- desactivar-lo.
--
-- Aquesta migració només prepara la BD:
--   1) Nou valor a sync_action per al log de creació d'oportunitat.
--   2) Permís CREATE al schema public per a l'usuari de la BD.
--      n8n es connecta amb el MATEIX usuari de BD que Directus (DB_USER,
--      habitualment `polserprm`), que ja té ALL PRIVILEGES sobre les taules
--      (migració 05) → inclou TRIGGER sobre `referrals` i SELECT.
--   ⚠️ El payload del NOTIFY que genera n8n és row_to_json(NEW), és a dir,
--      LA FILA COMPLETA (inclou client_name/phone/email). Assumit (canal
--      intern de Postgres). Les ESCRIPTURES de negoci es fan sempre per la
--      API de Directus (token tècnic POLSER_admin), mai per la BD.
--
-- Executar COM A SUPERUSUARI (pgAdmin, usuari postgres/owner) sobre la BBDD
-- del PRM (per defecte `prm`).
-- =====================================================================

-- 1) Nou valor a sync_action per al log de creació d'oportunitat
ALTER TYPE sync_action ADD VALUE IF NOT EXISTS 'create_opportunity';

-- 2) Permís perquè l'usuari de la BD (el de Directus, que també fa servir n8n)
--    pugui crear la funció/trigger d'events al schema public.
--    (TRIGGER sobre les taules i SELECT ja els té per la migració 05.)
--    ⚠️ Ajusta 'polserprm' al teu DB_USER si és diferent.
GRANT CREATE ON SCHEMA public TO polserprm;

-- =====================================================================
-- FI DE LA MIGRACIÓ 07
-- =====================================================================