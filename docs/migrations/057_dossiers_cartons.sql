-- 057 — Dossiers en cartons (édition AFGC) : les fonds rangés par carton,
-- importés de leurs classeurs Excel —
--   non_retires      : points des dossiers non retirés par les clients, ou annulés ;
--   ouverture_compte : répertoires d'ouverture de compte (matricule / n° de compte).
-- On y cherche par nom, n° d'acte ou matricule ; le carton dit où aller.
CREATE TABLE IF NOT EXISTS dossiers_cartons (
  id           SERIAL PRIMARY KEY,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fonds        VARCHAR(30) NOT NULL,
  serie        VARCHAR(120),
  carton       VARCHAR(40),
  rang         INTEGER,
  denomination VARCHAR(255),
  matricule    VARCHAR(60),
  num_actes    VARCHAR(255),
  actes        INTEGER[] NOT NULL DEFAULT '{}',
  typologie    VARCHAR(120),
  statut       VARCHAR(40),
  annee        INTEGER,
  note         VARCHAR(255),
  fichier      VARCHAR(255),
  empreinte    VARCHAR(40) NOT NULL,
  cree_par     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  cree_le      TIMESTAMP NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dossiers_cartons_empreinte ON dossiers_cartons (tenant_id, empreinte);
CREATE INDEX IF NOT EXISTS idx_dossiers_cartons_carton ON dossiers_cartons (tenant_id, fonds, carton);
CREATE INDEX IF NOT EXISTS idx_dossiers_cartons_actes ON dossiers_cartons USING GIN (actes);
CREATE INDEX IF NOT EXISTS idx_dossiers_cartons_matricule ON dossiers_cartons (tenant_id, matricule);
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_dossiers_cartons_nom_simple ON dossiers_cartons USING GIN (
  (trim(regexp_replace(translate(lower(denomination), 'àáâäãéèêëíîïóôöõúùûüçñ', 'aaaaaeeeeiiioooouuuucn'), '[^a-z0-9]+', ' ', 'g'))) gin_trgm_ops
);
