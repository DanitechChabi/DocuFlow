-- 049 — Entrée des dossiers aux archives (édition AFGC).
-- Chaque ligne d'un « point des dossiers retirés » (classeur Excel quotidien) :
-- le dossier entre aux archives ; il est traité par semaine de production
-- (vendredi → jeudi) et classé par lettre avant d'être mis en boîte.
CREATE TABLE IF NOT EXISTS dossiers_entres (
  id              SERIAL PRIMARY KEY,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  date_point      DATE NOT NULL,
  semaine         DATE NOT NULL,              -- vendredi qui ouvre la semaine de production
  rubrique        VARCHAR(150),               -- « Attestations / opérations banalisées »…
  num_ordre       INTEGER,
  num_actes       VARCHAR(255),               -- tel qu'écrit : « 1963-1964-1965 », « 71 à 74 »
  actes           INTEGER[] NOT NULL DEFAULT '{}', -- les numéros, pour les retrouver un à un
  denomination    VARCHAR(255),
  lettre          CHAR(1),
  type_garantie   VARCHAR(100),
  montant         NUMERIC(18, 2),
  commission_ht   NUMERIC(18, 2),
  commission_ttc  NUMERIC(18, 2),
  agent           VARCHAR(100),
  fichier         VARCHAR(255),
  empreinte       CHAR(32) NOT NULL,          -- même ligne réimportée : ignorée
  cree_par        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dossiers_entres_empreinte ON dossiers_entres (tenant_id, empreinte);
CREATE INDEX IF NOT EXISTS idx_dossiers_entres_semaine ON dossiers_entres (tenant_id, semaine, lettre);
CREATE INDEX IF NOT EXISTS idx_dossiers_entres_date ON dossiers_entres (tenant_id, date_point);
CREATE INDEX IF NOT EXISTS idx_dossiers_entres_actes ON dossiers_entres USING GIN (actes);
