-- ============================================================================
-- Migration 009 : Rebrand « AFGC » → « DocuFlow »
-- L'app n'appartient pas à l'AFGC : le tenant par défaut (propriétaire de la
-- plateforme, créé par setup_db.sql / migration 001) et son nom d'affichage
-- sont renommés en « DocuFlow ».
-- ============================================================================

-- 1. Tenant par défaut
-- Garde « aucun tenant ne porte déjà le slug docuflow » : au rejeu (le serveur
-- rejoue les migrations au démarrage sur une base migrée à la main), le
-- renommage heurtait l'unicité du slug dès qu'une autre ligne s'appelait encore
-- AFGC — le rebrand est alors déjà fait.
UPDATE tenants
SET name = 'DocuFlow', slug = 'docuflow', updated_at = CURRENT_TIMESTAMP
WHERE (slug = 'afgc' OR name = 'AFGC')
  AND NOT EXISTS (SELECT 1 FROM tenants t2 WHERE t2.slug = 'docuflow');

-- 2. Réglages de marque hérités du tenant par défaut
UPDATE settings
SET value = 'DocuFlow'
WHERE tenant_id = 1
  AND key = 'site_name'
  AND value ILIKE '%afgc%';

-- ============================================================================
-- Fin de la migration
-- ============================================================================
