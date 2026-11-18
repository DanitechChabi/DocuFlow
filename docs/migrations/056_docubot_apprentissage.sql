-- 056 — DocuBot apprend de l'usage, et veille.
-- Chaque question posée à DocuBot est gardée avec ce qu'il a compris ; l'avis
-- de la personne (utile ou non) et la correction de l'archive en font de
-- nouveaux exemples, sur lesquels il se réentraîne (intentionService). Les
-- échanges de plus d'un an sont effacés.
CREATE TABLE IF NOT EXISTS docubot_echanges (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  question    TEXT NOT NULL,
  intention   VARCHAR(30),
  confiance   REAL,
  source      VARCHAR(20),
  utile       BOOLEAN,
  correction  VARCHAR(30),
  corrige_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
  cree_le     TIMESTAMP NOT NULL DEFAULT now(),
  corrige_le  TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_docubot_echanges_tenant ON docubot_echanges (tenant_id, cree_le DESC);

-- Le point du matin envoyé par courriel : une fois par jour et par organisation.
CREATE TABLE IF NOT EXISTS docubot_veille (
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  jour      DATE NOT NULL,
  envoye_le TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, jour)
);
