-- =====================================================================
-- PRM POLSER — Migració 05: GRANTs de les taules del PRM a l'usuari de Directus
--
-- Les taules del PRM es van crear via pgAdmin com a superusuari; l'usuari de
-- Directus (DB_USER) no té cap privilegi sobre elles ("permission denied for
-- table ..."). Això afecta tant els hooks com l'API /portal.
--
-- EXECUTAR COM A SUPERUSUARI (pgAdmin, usuari postgres/owner).
-- Ajusta 'polserprm' al teu DB_USER si és diferent.
-- =====================================================================

GRANT USAGE ON SCHEMA public TO polserprm;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO polserprm;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO polserprm;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO polserprm;