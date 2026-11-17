-- 055 — Index des noms d'entreprise pour la recherche approchée.
-- Un vecteur par nom simplifié des dossiers entrés, calculé sur le serveur
-- (modèle multilingual-e5-small). Il sert à retrouver « Crédo B.T.P » quand
-- la dénomination saisie n'est pas écrite comme dans le classeur.
CREATE TABLE IF NOT EXISTS ia_noms (
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nom TEXT NOT NULL,
  modele VARCHAR(120) NOT NULL,
  vecteur REAL[] NOT NULL,
  cree_le TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, nom)
);
