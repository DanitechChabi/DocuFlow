// ============================================================================
// acl.test.js — périmètres d'accès par dossier (jalon J5).
//
// SANS BASE : l'arbitrage (héritage du niveau, héritage de la restriction,
// cumul des canaux, défaut ouvert / défaut fermé) vit dans deux fonctions
// pures du service — resoudrePerimetres et niveauDepuis — éprouvées ici sur
// une arborescence synthétique. Les parcours HTTP (pose d'ACL par
// l'administration, bornage des listes, refus 403) sont éprouvés sur la base
// locale de développement.
// Exécution : npm run test:acl (ou npm test).
// ============================================================================
const acl = require('./services/aclService');
const { ROLES_SYSTEME, estValide } = require('./config/permissions');

let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => {
  verifs += 1;
  console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`);
  if (!cond) echecs += 1;
};

// L'arborescence de référence — celle de la demande fondatrice : « l'agent RH
// voit Ressources humaines, pas Finance, pas Direction ».
//   1 RH           2 RH/Paie (enfant de 1)
//   3 Finance      4 Finance/Comptabilité (enfant de 3)
//   5 Divers (racine ouverte, aucune ACL nulle part)
//   6 orphelin (parent 99 inconnu — donnée héritée)
const ARBRE = [
  { id: 1, parent_id: null },
  { id: 2, parent_id: 1 },
  { id: 3, parent_id: null },
  { id: 4, parent_id: 3 },
  { id: 5, parent_id: null },
  { id: 6, parent_id: 99 },
];

const resoudre = (acls, sujet) => acl.resoudrePerimetres(ARBRE, acls, sujet);

console.log('\n1. Défaut ouvert — aucune ACL nulle part');
{
  const p = resoudre([], { role: 'agent', groupes: [], userId: 42 });
  for (const id of [1, 2, 3, 4, 5, 6]) {
    ok(p.get(id).restricted === false, `dossier ${id} non restreint`);
    ok(acl.niveauDepuis(p.get(id)) === 'libre', `dossier ${id} : niveau 'libre' (le RBAC seul décide)`);
  }
  // C'est la garantie de non-régression : sans cette sémantique, toute garde
  // d'écriture exigeant 'write' verrouillait la GED entière tant qu'aucune
  // ACL n'existait — seul l'administrateur passait.
  ok(acl.niveauDepuis(p.get(1)) !== 'write', "un dossier sans ACL n'accorde pas 'write' par erreur");
}

console.log('\n2. Héritage du niveau — read sur RH vaut pour RH/Paie');
{
  const acls = [{ folder_id: 1, subject_type: 'role', subject_id: 'agent', level: 'read' }];
  const p = resoudre(acls, { role: 'agent', groupes: [], userId: 42 });
  ok(acl.niveauDepuis(p.get(1)) === 'read', 'agent : read sur RH');
  ok(acl.niveauDepuis(p.get(2)) === 'read', 'agent : read hérité sur RH/Paie');
  ok(p.get(2).restricted === true, 'RH/Paie restreint par héritage (aucune ACL directe)');
}

console.log('\n3. Défaut fermé — le non-sujet ne voit rien, même à côté');
{
  const acls = [{ folder_id: 1, subject_type: 'role', subject_id: 'agent', level: 'read' }];
  const p = resoudre(acls, { role: 'lecteur', groupes: [], userId: 7 });
  ok(acl.niveauDepuis(p.get(1)) === 'none', 'lecteur : aucun accès sur RH');
  ok(acl.niveauDepuis(p.get(2)) === 'none', 'lecteur : aucun accès hérité sur RH/Paie');
  ok(acl.niveauDepuis(p.get(3)) === 'libre', 'lecteur : Finance suit le RBAC seul (aucune ACL dessus)');
  ok(acl.niveauDepuis(p.get(5)) === 'libre', 'lecteur : Divers ouvert');
}

console.log('\n4. Cumul des canaux — le plus fort l\'emporte');
{
  // role write + group read → write ; role read + user direct manage → manage.
  const acls = [
    { folder_id: 1, subject_type: 'role', subject_id: 'agent', level: 'write' },
    { folder_id: 1, subject_type: 'group', subject_id: '7', level: 'read' },
  ];
  const p1 = resoudre(acls, { role: 'agent', groupes: ['7'], userId: 42 });
  ok(acl.niveauDepuis(p1.get(1)) === 'write', 'role write + group read → write');

  const acls2 = [
    { folder_id: 3, subject_type: 'role', subject_id: 'agent', level: 'read' },
    { folder_id: 3, subject_type: 'user', subject_id: '42', level: 'manage' },
  ];
  const p2 = resoudre(acls2, { role: 'agent', groupes: [], userId: 42 });
  ok(acl.niveauDepuis(p2.get(3)) === 'manage', 'role read + user manage → manage');
  // Le manage direct se propage au sous-arbre comme les autres niveaux.
  ok(acl.niveauDepuis(p2.get(4)) === 'manage', 'le manage hérite sur Finance/Comptabilité');
}

console.log('\n5. Renforcement en profondeur — un sous-dossier peut resserrer');
{
  // RH read pour agent, mais RH/Paie write pour le groupe 7 seul.
  const acls = [
    { folder_id: 1, subject_type: 'role', subject_id: 'agent', level: 'read' },
    { folder_id: 2, subject_type: 'group', subject_id: '7', level: 'write' },
  ];
  const p = resoudre(acls, { role: 'agent', groupes: [], userId: 42 });
  ok(acl.niveauDepuis(p.get(1)) === 'read', 'agent : read sur RH');
  ok(acl.niveauDepuis(p.get(2)) === 'read', 'agent : read conservé sur RH/Paie (write visait le groupe 7, pas lui)');
  const pGroupe = resoudre(acls, { role: 'lecteur', groupes: ['7'], userId: 9 });
  ok(acl.niveauDepuis(pGroupe.get(1)) === 'none', 'hors sujet sur RH : aucun accès');
  ok(acl.niveauDepuis(pGroupe.get(2)) === 'write', 'sujet direct sur RH/Paie : write — sans accès au parent');
  // Un dossier visible PAR-DESSUS son parent invisible : c'est la sémantique
  // attendue (l'accès au sous-dossier ne donne pas le parent), l'arbre ne
  // montrera que ce qui est visible.
}

console.log('\n6. Sujets et niveaux inconnus — inertie, pas d\'effet');
{
  const acls = [
    { folder_id: 1, subject_type: 'machine', subject_id: 'x', level: 'manage' },
    { folder_id: 3, subject_type: 'role', subject_id: 'agent', level: 'root' },
  ];
  const p = resoudre(acls, { role: 'agent', groupes: [], userId: 42 });
  ok(p.get(1).restricted === true, 'une ACL au type inconnu restreint quand même le dossier');
  ok(acl.niveauDepuis(p.get(1)) === 'none', 'mais n\'accorde rien (canal inconnu)');
  ok(acl.niveauDepuis(p.get(3)) === 'none', 'niveau inconnu (ni read/write/manage) : rien accordé');
}

console.log('\n7. Orphelins — la restriction ne les fait pas disparaître');
{
  const acls = [{ folder_id: 1, subject_type: 'role', subject_id: 'agent', level: 'read' }];
  const p = resoudre(acls, { role: 'lecteur', groupes: [], userId: 7 });
  ok(p.has(6), 'le dossier orphelin est résolu malgré tout');
  ok(acl.niveauDepuis(p.get(6)) === 'libre', 'orphelin : libre (le RBAC seul), même privé d\'accès à RH');
}

console.log('\n8. Registre RBAC — la permission d\'administrer existe et est attribuée');
{
  ok(estValide('folders.manage_permissions'), 'folders.manage_permissions connue du catalogue');
  const roles = Object.fromEntries(ROLES_SYSTEME.map((r) => [r.key, r.permissions]));
  ok(roles.admin.includes('folders.manage_permissions'), 'admin administre les périmètres');
  ok(roles.archiviste.includes('folders.manage_permissions'), 'archiviste administre les périmètres (gestion documentaire)');
  ok(!roles.agent.includes('folders.manage_permissions'), 'agent ne les administre pas');
  ok(!roles.demandeur.includes('folders.manage_permissions'), 'demandeur ne les administre pas');
  ok(roles.superadmin.includes('*'), 'superadmin : joker');
}

console.log(`\n${verifs} vérifications, ${echecs} échec(s)`);
process.exit(echecs ? 1 : 0);
