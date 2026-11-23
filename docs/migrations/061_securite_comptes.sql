-- 061 — Sécurité des comptes : mot de passe à changer à la prochaine
-- connexion (mot de passe provisoire donné par l'administrateur, compte créé
-- par lui, ou mot de passe identique à l'identifiant).
ALTER TABLE users ADD COLUMN IF NOT EXISTS mdp_a_changer BOOLEAN NOT NULL DEFAULT FALSE;

-- Rappel la veille de la date de retour prévue (une fois par prêt).
ALTER TABLE request_loans ADD COLUMN IF NOT EXISTS rappel_echeance_at TIMESTAMPTZ;
