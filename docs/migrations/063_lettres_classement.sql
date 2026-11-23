-- 063 — Lettre de classement corrigée à la main, par entreprise.
-- La règle (helpers/lettreClassement) saute « Société », « Entreprise », les
-- chiffres… ; quand elle se trompe (« Société » faisant partie du nom),
-- l'archiviste corrige, et la correction vaut pour les entrées suivantes.
CREATE TABLE IF NOT EXISTS lettres_classement (
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nom_simple  VARCHAR(255) NOT NULL,
  lettre      CHAR(1) NOT NULL,
  corrige_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
  corrige_le  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, nom_simple)
);
