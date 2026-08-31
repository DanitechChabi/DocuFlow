-- 022_folder_acls.sql — périmètres d'accès par dossier.
--
-- LA DEMANDE FONDATRICE : « l'agent RH voit Ressources humaines, pas Finance,
-- pas Direction ». Une permission (documents.view) ne suffit pas : elle dit
-- CE QU'ON peut faire, pas SUR QUOI. Les ACL ajoutent la seconde dimension.
--
-- MODÈLE :
--   folder_acls (folder_id, subject_type, subject_id, level)
--     subject_type : 'role' | 'group' | 'user'  (qui reçoit l'accès)
--     level        : 'read'  (consulter, télécharger)
--                  | 'write' (read + modifier, verser, déplacer dedans)
--                  | 'manage' (write + administrer les ACL du sous-arbre)
--
-- HÉRITAGE : une ACL posée sur un dossier vaut pour TOUT son sous-arbre —
-- c'est la sémantique attendue d'une arborescence (« RH » couvre ses
-- sous-dossiers). La résolution (quel niveau effectif sur CE dossier ?)
-- est applicative (aclService) : elle cumule rôle + groupes + utilisateur
-- direct et retient le niveau le plus fort.
--
-- SÉMANTIQUE DU DÉFAUT : un dossier SANS aucune ACL est accessible à tous
-- ceux qui détiennent les permissions GED — restreindre est un geste exprès.
-- Un dossier AVEC au moins une ACL n'ouvre plus qu'à ses sujets (et les
-- manageurs du dessus). L'administrateur (rôle admin, joker superadmin)
-- passe toujours.
--
-- Idempotent : rejouable sur une base neuve ou déjà migrée.

CREATE TABLE IF NOT EXISTS folder_acls (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    folder_id INTEGER NOT NULL REFERENCES document_folders(id) ON DELETE CASCADE,
    subject_type VARCHAR(10) NOT NULL CHECK (subject_type IN ('role', 'group', 'user')),
    -- subject_id : clé users.id pour 'user', groups.id pour 'group',
    -- et la CLÉ du rôle (roles.key, ex. 'agent') pour 'role' — pas son id :
    -- la clé est ce que portent users.role et l'interface d'administration.
    subject_id VARCHAR(50) NOT NULL,
    level VARCHAR(10) NOT NULL CHECK (level IN ('read', 'write', 'manage')),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (folder_id, subject_type, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_folder_acls_folder ON folder_acls(folder_id);
CREATE INDEX IF NOT EXISTS idx_folder_acls_tenant ON folder_acls(tenant_id);

-- L'héritage parcourt l'arborescence à chaque résolution : index sur le lien
-- parent (déjà utilisé par les CTE récursives existantes).
CREATE INDEX IF NOT EXISTS idx_document_folders_parent ON document_folders(parent_id);

-- L'ADMINISTRATION des ACL est gardée par une permission dédiée. Les tenants
-- existants ont leurs rôles système provisionnés par la migration 019 (qui
-- ne rejoue pas) : on accorde ici la permission aux rôles qui géraient déjà
-- la structure des dossiers — admin (l'organisation) et archiviste (le
-- référentiel documentaire). Idempotent : la concession s'ajoute si absente.
UPDATE roles
   SET permissions = array_append(permissions, 'folders.manage_permissions')
 WHERE is_system
   AND key IN ('admin', 'archiviste')
   AND NOT ('folders.manage_permissions' = ANY (permissions));
