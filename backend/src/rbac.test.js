// ============================================================================
// rbac.test.js — cohérence du dispositif de rôles et permissions.
//
// Sans base ni réseau : le catalogue et la migration sont vérifiés l'un
// contre l'autre (la migration doit provisionner exactement ce que le code
// définit), le middleware est éprouvé en interceptant le cache de require
// (technique des tests de licence), et les replis pré-migration sont couverts.
// Exécution : npm run test:rbac (ou npm test).
// ============================================================================
const { execFileSync } = require('child_process');
const path = require('path');

const { CATALOGUE, TOUTES, PAR_CLE, ROLES_SYSTEME, accorde, estValide, filtrerValides } = require('./config/permissions');

let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => {
  verifs += 1;
  if (cond) {
    console.log(`  ok   ${nom}`);
  } else {
    echecs += 1;
    console.error(`  ÉCHEC ${nom}`);
  }
};

console.log('\n1. Intégrité du catalogue');
{
  const cles = CATALOGUE.flatMap((m) => m.permissions.map((p) => p.key));
  ok(new Set(cles).size === cles.length, 'aucune clé dupliquée dans le catalogue');
  ok(cles.every((c) => PAR_CLE[c]), 'chaque clé est indexée');
  ok(cles.every((c) => /^[a-z]+\.[a-z_]+$/.test(c)), 'format module.ressource_action respecté');
  ok(CATALOGUE.every((m) => m.permissions.length > 0 && m.titre), 'chaque module a un titre et des permissions');
  ok(CATALOGUE.every((m) => m.permissions.every((p) => p.label && p.description)), 'chaque permission a libellé et description (interface)');
}

console.log('\n2. Rôles système — permissions connues du catalogue');
{
  for (const role of ROLES_SYSTEME) {
    const inconnues = role.permissions.filter((p) => p !== '*' && !estValide(p));
    ok(inconnues.length === 0, `${role.key} : ${inconnues.length ? `inconnues (${inconnues.join(', ')})` : 'toutes les permissions sont au catalogue'}`);
  }
  ok(ROLES_SYSTEME.filter((r) => r.key === 'superadmin').length === 1 && ROLES_SYSTEME.find((r) => r.key === 'superadmin').permissions.includes('*'),
    'seul superadmin porte le joker *');
  // Les 4 rôles historiques doivent exister : les utilisateurs en place les portent.
  for (const legacy of ['superadmin', 'admin', 'archiviste', 'demandeur']) {
    ok(ROLES_SYSTEME.some((r) => r.key === legacy), `rôle historique « ${legacy} » conservé`);
  }
  // Les rôles nouveaux de la vision.
  for (const nouveau of ['responsable', 'agent', 'lecteur']) {
    ok(ROLES_SYSTEME.some((r) => r.key === nouveau), `rôle « ${nouveau} » défini`);
  }
}

console.log('\n3. Sémantique des rôles — calque des pouvoirs d\'avant le RBAC');
{
  const par = (k) => ROLES_SYSTEME.find((r) => r.key === k).permissions;
  ok(!par('demandeur').includes('documents.view'), 'demandeur : pas d\'accès GED par défaut (réglage historique « archiviste »)');
  ok(par('archiviste').includes('documents.upload') && par('archiviste').includes('folders.create'), 'archiviste : gestion documentaire');
  ok(!par('archiviste').includes('users.create') && !par('archiviste').includes('settings.manage'), 'archiviste : pas d\'administration système');
  ok(par('responsable').includes('requests.validate') && par('responsable').includes('requests.assign'), 'responsable : supervision des demandes');
  ok(!par('responsable').includes('documents.upload'), 'responsable : lecture documentaire seule');
  ok(par('agent').includes('requests.process') && par('agent').includes('documents.upload'), 'agent : traiter et verser');
  ok(!par('lecteur').includes('documents.upload') && !par('lecteur').includes('requests.create'), 'lecteur : consultation seule');
  ok(par('admin').includes('users.create') && par('admin').includes('roles.edit') && par('admin').includes('settings.manage'),
    'admin : administration complète de l\'organisation');
}

console.log('\n4. Migration 019 — provisionne exactement les définitions du code');
{
  const sql = require('fs').readFileSync(path.join(__dirname, '..', '..', 'docs', 'migrations', '019_rbac.sql'), 'utf8');
  for (const role of ROLES_SYSTEME) {
    // La section SQL du rôle : de sa clé à la clé du rôle suivant (ou la fin
    // du bloc DO pour le dernier).
    const debut = sql.indexOf(`'${role.key}', '`);
    ok(debut > -1, `migration : rôle « ${role.key} » provisionné`);
    if (debut === -1) continue;
    const fin = sql.indexOf("(t.id, '", debut + 10);
    const section = sql.slice(debut, fin === -1 ? undefined : fin);
    if (role.permissions.includes('*')) {
      ok(section.includes("ARRAY['*']"), `migration : ${role.key} porte le joker`);
    } else {
      const manquantes = role.permissions.filter((p) => !section.includes(`'${p}'`));
      const journal = section.match(/'[^']*'/g) || [];
      // Les permissions présentes dans le SQL mais pas dans le code sont un
      // désappariement tout aussi grave (la migration accorderait un droit que
      // l'interface ne montre pas).
      const dansSql = journal
        .map((q) => q.slice(1, -1))
        .filter((v) => estValide(v));
      const surnumeraires = dansSql.filter((v) => !role.permissions.includes(v));
      ok(manquantes.length === 0, `migration : ${role.key} ne manque aucune permission du code${manquantes.length ? ` (${manquantes.join(', ')})` : ''}`);
      ok(surnumeraires.length === 0, `migration : ${role.key} n'accorde rien d'inconnu du code${surnumeraires.length ? ` (${surnumeraires.join(', ')})` : ''}`);
    }
  }
  ok(sql.includes('token_version'), 'migration : colonne token_version posée');
  ok(sql.includes('ALTER COLUMN role TYPE VARCHAR(50)'), 'migration : users.role élargi (clés personnalisées)');
}

console.log('\n5. accorde() et filtrerValides()');
{
  ok(accorde(['*'], 'nimporte.quoi'), 'le joker accorde tout');
  ok(accorde(['documents.view'], 'documents.view'), 'permission accordée');
  ok(!accorde(['documents.view'], 'documents.delete'), 'permission absente refusée');
  ok(!accorde(null, 'documents.view'), 'permissions nulles refusées');
  ok(JSON.stringify(filtrerValides(['documents.view', 'bidon.xxx', 'documents.view'])) === JSON.stringify(['documents.view']),
    'filtrerValides : inconnues écartées, doublons dédoublonnés');
  ok(filtrerValides(['*']).includes('*'), 'le joker reste filtrable (superadmin)');
}

console.log('\n6. requirePermission — avec roleService détourné (cache de require)');
{
  // Détourner roleService AVANT que requirePermission ne le capture : on
  // charge requirePermission APRÈS avoir injecté notre doublure dans le cache.
  const cheminRoleService = path.join(__dirname, 'services', 'roleService.js');
  const doublure = {
    possede: async (tenantId, roleKey, permission) => {
      if (roleKey === 'superadmin') return true; // joker
      if (roleKey === 'archiviste') return permission === 'documents.view' || permission === 'documents.upload';
      if (roleKey === 'desactive' ) return permission === 'documents.view';
      throw new Error('rôle inconnu du test');
    },
  };
  const cacheOriginal = require.cache[require.resolve(cheminRoleService)];
  require.cache[require.resolve(cheminRoleService)] = { id: cheminRoleService, filename: cheminRoleService, loaded: true, exports: doublure };
  const { requirePermission } = require('./middlewares/requirePermission');

  const appel = (middleware, req) => new Promise((resolve) => {
    const res = {
      status(code) { this.code = code; return this; },
      json(body) { resolve({ code: this.code, body }); },
    };
    middleware(req, res, () => resolve({ code: 'next' }));
  });

  (async () => {
    const garde = requirePermission('documents.view');

    let r = await appel(garde, { user: { id: 1, tenant_id: 5, role: 'archiviste' } });
    ok(r.code === 'next', 'archiviste + documents.view → passe');

    r = await appel(garde, { user: { id: 1, tenant_id: 5, role: 'archiviste' } });
    ok(r.code === 'next', 'garde réutilisable (pas d\'état)');

    const gardeDelete = requirePermission('documents.delete');
    r = await appel(gardeDelete, { user: { id: 1, tenant_id: 5, role: 'archiviste' } });
    ok(r.code === 403 && r.body.code === 'PERMISSION_REFUSEE' && r.body.permission === 'documents.delete',
      'archiviste + documents.delete → 403 avec permission nommée');

    r = await appel(garde, { user: { id: 1, tenant_id: 5, role: 'superadmin' } });
    ok(r.code === 'next', 'superadmin → passe (joker)');

    r = await appel(garde, {});
    ok(r.code === 401, 'sans req.user → 401');

    r = await appel(garde, { user: { id: 1, tenant_id: 5, role: 'role-inconnu' } });
    ok(r.code === 403, 'erreur de résolution → 403 (fail-closed)');

    // Restaurer le vrai service pour la suite éventuelle.
    if (cacheOriginal) require.cache[require.resolve(cheminRoleService)] = cacheOriginal;

    console.log(`\n${echecs === 0 ? '✅' : '❌'} Dispositif RBAC cohérent — ${verifs} vérifications${echecs ? `, ${echecs} échec(s)` : ''}.`);
    if (echecs > 0) process.exit(1);
  })();
}
