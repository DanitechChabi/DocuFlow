-- ============================================================================
-- Migration 009 : Rebrand « AFGC » → « DocuFlow »
-- L'app n'appartient pas à l'AFGC : le tenant par défaut (propriétaire de la
-- plateforme, créé par setup_db.sql / migration 001) et son nom d'affichage
-- sont renommés en « DocuFlow ».
-- ============================================================================

-- 1. Tenant par défaut
UPDATE tenants
SET name = 'DocuFlow', slug = 'docuflow', updated_at = CURRENT_TIMESTAMP
WHERE slug = 'afgc' OR name = 'AFGC';

-- 2. Réglages de marque hérités du tenant par défaut
UPDATE settings
SET value = 'DocuFlow'
WHERE tenant_id = 1
  AND key = 'site_name'
  AND value ILIKE '%afgc%';

-- ============================================================================
-- Fin de la migration
-- ============================================================================
