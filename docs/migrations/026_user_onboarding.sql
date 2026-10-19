-- ============================================================================
-- 026_user_onboarding.sql — progression de la prise en main, par utilisateur
-- ============================================================================
-- La visite guidée se mémorisait dans le stockage du navigateur : elle
-- revenait sur un autre poste, dans l'application de bureau, après un
-- nettoyage du navigateur. La progression vit désormais avec le compte.
--
-- Forme (validée par l'application, services/onboardingService.js) :
--   { "tours": { "accueil": "2026-10-19T…", "demandes": "…" },
--     "conseils": ["recherche", "docubot"] }
--
-- Idempotent. Retour arrière : docs/migrations/down/026_user_onboarding.down.sql
-- ============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding JSONB NOT NULL DEFAULT '{}'::jsonb;
