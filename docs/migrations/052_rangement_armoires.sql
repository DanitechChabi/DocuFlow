-- 052 — Plan de rangement des dossiers entrés (édition AFGC).
-- Les dossiers d'une semaine de production, classés par lettre, se suivent
-- d'armoire en armoire : chaque armoire couvre une plage continue, de
-- (semaine, lettre) à (semaine, lettre). Une lettre partagée entre deux
-- armoires (« S » puis « S' ») figure aux deux bornes. Une lettre absente
-- (NULL) : depuis le début ou jusqu'à la fin de la semaine.
CREATE TABLE IF NOT EXISTS rangements (
  id              SERIAL PRIMARY KEY,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nom             VARCHAR(60) NOT NULL,        -- « Armoire 3 »
  lieu            VARCHAR(120),                -- « Couloir des toilettes »
  ordre           INTEGER NOT NULL DEFAULT 0,
  debut_semaine   DATE NOT NULL,               -- vendredi
  debut_lettre    CHAR(1),
  fin_semaine     DATE NOT NULL,
  fin_lettre      CHAR(1),
  cree_par        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CHECK (fin_semaine >= debut_semaine)
);
CREATE INDEX IF NOT EXISTS idx_rangements_tenant ON rangements (tenant_id, debut_semaine, fin_semaine);
