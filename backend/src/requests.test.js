// ============================================================================
// requests.test.js — qui voit quelle demande.
//
// SANS BASE : roleService est détourné par le cache de require (technique de
// rbac.test.js) et répond d'après les rôles système du catalogue ; config/db
// est remplacé par une doublure qui sert une demande synthétique. On éprouve
// la règle (requestAccessService), la garde de GET /api/requests/all, et la
// fiche détaillée (accès + masquage des notes internes).
// Exécution : npm run test:requests (ou npm test).
// ============================================================================
const path = require('path');
const { ROLES_SYSTEME, accorde } = require('./config/permissions');

let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => {
  verifs += 1;
  console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`);
  if (!cond) echecs += 1;
};

const doubler = (relatif, exports) => {
  const chemin = require.resolve(path.join(__dirname, relatif));
  require.cache[chemin] = { id: chemin, filename: chemin, loaded: true, exports };
};

// roleService : les permissions des rôles système, telles que la migration 019
// les provisionne. Rôle inconnu → refus (fail-closed, comme le vrai).
doubler('services/roleService.js', {
  possede: async (tenantId, roleKey, permission) => {
    const role = ROLES_SYSTEME.find((r) => r.key === roleKey);
    return !!role && accorde(role.permissions, permission);
  },
});

// config/db : une seule demande (id 10, tenant 1), auteur 100, assigné 200.
const DEMANDE = { id: 10, tenant_id: 1, id_user: 100, assignee_id: 200, statut: 'a traiter', notes_internes: 'pièce manquante — voir greffe' };
doubler('config/db.js', {
  query: async (sql, params = []) => {
    if (/FROM requests r/.test(sql) && /WHERE r\.id = \$1/.test(sql)) {
      return { rows: Number(params[0]) === DEMANDE.id && params[1] === DEMANDE.tenant_id ? [{ ...DEMANDE }] : [] };
    }
    if (/FROM request_history/.test(sql)) {
      return { rows: [{ id: 1, request_id: 10, new_status: 'a traiter', comment: 'note interne de transition' }] };
    }
    return { rows: [] };
  },
});
doubler('services/requestFieldService.js', { getValues: async () => [] });

const access = require('./services/requestAccessService');
const utilisateur = (id, role) => ({ id, tenant_id: 1, role });

const appel = (handler, req) => new Promise((resolve) => {
  const res = {
    code: 200,
    status(c) { this.code = c; return this; },
    json(body) { resolve({ code: this.code, body }); },
  };
  Promise.resolve(handler(req, res, () => resolve({ code: 'next' })));
});

(async () => {
  console.log('\n1. Vue globale — traiter ou affecter, jamais requests.view seul');
  {
    const attendu = { superadmin: true, admin: true, responsable: true, archiviste: true, agent: true, demandeur: false, lecteur: false };
    for (const [role, voit] of Object.entries(attendu)) {
      ok(await access.peutVoirToutes(utilisateur(1, role)) === voit, `${role} ${voit ? 'voit' : 'ne voit pas'} toutes les demandes`);
    }
    ok(await access.peutVoirToutes(utilisateur(1, 'role-inconnu')) === false, 'rôle inconnu : refus (fail-closed)');
    ok(await access.peutVoirToutes(null) === false, 'sans utilisateur : refus');
  }

  console.log('\n2. Une demande — auteur, assigné, ou personnel');
  {
    ok(await access.peutConsulter(utilisateur(100, 'demandeur'), DEMANDE), 'l\'auteur (demandeur) consulte sa demande');
    ok(await access.peutConsulter(utilisateur(200, 'lecteur'), DEMANDE), 'l\'assigné consulte la demande, même sans vue globale');
    ok(!(await access.peutConsulter(utilisateur(300, 'demandeur'), DEMANDE)), 'un autre demandeur : refus');
    ok(!(await access.peutConsulter(utilisateur(300, 'lecteur'), DEMANDE)), 'un lecteur étranger à la demande : refus');
    ok(await access.peutConsulter(utilisateur(300, 'agent'), DEMANDE), 'un agent (requests.process) consulte');
    ok(await access.peutConsulter(utilisateur(300, 'responsable'), DEMANDE), 'un responsable consulte (autrefois refusé : liste en dur)');
    ok(!(await access.peutConsulter(utilisateur(300, 'demandeur'), { id_user: 100, assignee_id: null })), 'assigné nul : ne correspond à personne');
  }

  console.log('\n3. GET /api/requests/all — la garde de la route');
  {
    const router = require('./routes/requestRoutes');
    const couche = router.stack.find((l) => l.route && l.route.path === '/all' && l.route.methods.get);
    ok(!!couche, 'route /all déclarée');
    const garde = couche.route.stack[0].handle;
    let r = await appel(garde, { user: utilisateur(100, 'demandeur') });
    ok(r.code === 403, 'demandeur → 403 (la fuite est fermée)');
    r = await appel(garde, { user: utilisateur(100, 'lecteur') });
    ok(r.code === 403, 'lecteur → 403');
    r = await appel(garde, { user: utilisateur(1, 'archiviste') });
    ok(r.code === 'next', 'archiviste → passe');
    r = await appel(garde, { user: utilisateur(1, 'responsable') });
    ok(r.code === 'next', 'responsable → passe');
    r = await appel(garde, {});
    ok(r.code === 401, 'sans session → 401');
  }

  console.log('\n4. Fiche détaillée — accès et notes internes');
  {
    const { getRequestDetails } = require('./controllers/requestDetailsController');
    const fiche = (user, id = '10') => appel(getRequestDetails, { params: { id }, user });

    let r = await fiche(utilisateur(100, 'demandeur'));
    ok(r.code === 200, 'auteur : fiche servie');
    ok(r.body.request && !('notes_internes' in r.body.request), 'auteur : notes internes masquées');
    ok(r.body.stateHistory.every((h) => h.comment === null), 'auteur : commentaires de transition masqués');

    r = await fiche(utilisateur(300, 'demandeur'));
    ok(r.code === 403, 'autre demandeur : 403');

    r = await fiche(utilisateur(300, 'archiviste'));
    ok(r.code === 200 && r.body.request.notes_internes === DEMANDE.notes_internes, 'archiviste : fiche et notes internes');
    ok(r.body.stateHistory[0].comment === 'note interne de transition', 'archiviste : commentaires de transition');

    r = await fiche(utilisateur(200, 'lecteur'));
    ok(r.code === 200 && r.body.request.notes_internes === DEMANDE.notes_internes, 'assigné : il traite, il voit les notes');

    r = await fiche(utilisateur(300, 'archiviste'), '999');
    ok(r.code === 404, 'demande inexistante (ou d\'un autre tenant) : 404');
  }

  console.log(`\n${echecs === 0 ? '✅' : '❌'} Accès aux demandes cohérent — ${verifs} vérifications${echecs ? `, ${echecs} échec(s)` : ''}.`);
  process.exit(echecs > 0 ? 1 : 0);
})();
