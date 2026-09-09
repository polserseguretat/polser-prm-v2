-- =====================================================================
-- PRM POLSER — Migració 06: nous sectors de serveis
--
-- S'afegeixen dos nous valors al tipus enum `service_sector`:
--   'comunidades' (comunitats de veïns / administradors de finques)
--   'industria'   (naus, polígons, industrial)
--
-- Executar COM A SUPERUSUARI (pgAdmin, usuari postgres/owner) sobre la BBDD
-- del PRM (per defecte `prm`). PostgreSQL 12+ permet afegir valors d'enum
-- dins d'una transacció; aquí es fa directament.
--
-- ATENCIÓ: no es pot utilitzar el valor acabat d'afegir en la MATEIXA
-- transacció. Per tant aquesta migració només afegeix els valors; els INSERTs
-- o UPDATEs que facin servir 'comunidades'/'industria' s'han de fer en una
-- transacció/execució posterior.
-- =====================================================================

ALTER TYPE service_sector ADD VALUE IF NOT EXISTS 'comunidades';
ALTER TYPE service_sector ADD VALUE IF NOT EXISTS 'industria';

-- =====================================================================
-- FI DE LA MIGRACIÓ 06
-- =====================================================================
