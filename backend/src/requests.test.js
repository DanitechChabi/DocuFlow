// ============================================================================
// requests.test.js — qui voit quelle demande.
//
// SANS BASE : roleService est détourné par le cache de require (technique de
// rbac.test.js) et répond d'après les rôles système du catalogue ; config/db
// est remplacé par une doublure qui sert une demande synthétique. On éprouve
// la règle (requestAccessService), la garde de GET /api/requests/all, la
// fiche détaillée (accès + masquage des notes internes), la saisie d'une
// demande rapide (migration 023) et l'annulation par l'auteur.
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
const journalSql = [];
let insertionsRefusees = false; // simule une base sans la migration 023
doubler('config/db.js', {
  query: async (sql, params = []) => {
    journalSql.push({ sql, params });
    if (/^\s*INSERT INTO requests/.test(sql)) {
      if (insertionsRefusees && /description/.test(sql)) {
        const e = new Error('column "description" does not exist'); e.code = '42703'; throw e;
      }
      const cols = sql.match(/\(([^)]*)\)/)[1].split(',').map((c) => c.trim());
      const row = { id: 77 };
      cols.forEach((c, i) => { row[c] = params[i]; });
      return { rows: [row] };
    }
    if (/^SELECT \* FROM requests WHERE id = \$1/.test(sql) || /SELECT id, id_user, assignee_id FROM requests WHERE id = \$1/.test(sql)) {
      return { rows: Number(params[0]) === DEMANDE.id && params[1] === DEMANDE.tenant_id ? [{ ...DEMANDE, statut: 'en attente' }] : [] };
    }
    if (/FROM requests r/.test(sql) && /WHERE r\.id = \$1/.test(sql)) {
      return { rows: Number(params[0]) === DEMANDE.id && params[1] === DEMANDE.tenant_id ? [{ ...DEMANDE }] : [] };
    }
    if (/SELECT email FROM users/.test(sql)) return { rows: [{ email: `u${params[0]}@exemple.test` }] };
    if (/FROM request_history/.test(sql)) {
      return { rows: [{ id: 1, request_id: 10, new_status: 'a traiter', comment: 'note interne de transition' }] };
    }
    return { rows: [] };
  },
});
const appelsChamps = [];
doubler('services/requestFieldService.js', {
  getValues: async () => [],
  isAvailable: async () => true,
  collectValues: async (tenantId, body, opts) => {
    appelsChamps.push(opts);
    // Formulaire complet : l'organisation exige le n° de dossier.
    return { customValues: [], missing: opts && opts.systemRequired && !body.num_dossier ? ['Le champ « Numéro de dossier » est obligatoire.'] : [] };
  },
  saveValues: async () => {},
});
doubler('services/settingsService.js', { getAll: async () => ({}) });
const mails = [];
doubler('services/mailService.js', { notify: async (m) => { mails.push(m); return { sent: true }; } });

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

  console.log('\n5. Saisie — règle « identifiable » (migration 023)');
  {
    const { lireSaisie, libelleDemande } = require('./helpers/requestInput');
    const now = new Date(2026, 9, 19);
    let r = lireSaisie({ description: '  Contrat de bail du local de Cotonou ' }, { now });
    ok(r.errors.length === 0 && r.values.description === 'Contrat de bail du local de Cotonou', 'description seule : recevable (texte nettoyé)');
    ok(r.values.num_dossier === null && r.values.annee === null, 'références absentes : null, pas chaîne vide');
    r = lireSaisie({ num_acte: 'ACT-1' }, { now });
    ok(r.errors.length === 0, 'une seule référence : recevable');
    r = lireSaisie({ annee: 2024, motif: 'x' }, { now });
    ok(r.errors.length === 1 && /Décrivez/.test(r.errors[0]), 'ni description ni référence : refus explicite');
    r = lireSaisie({ description: '   ' }, { now });
    ok(r.errors.length === 1, 'description faite d\'espaces : refus');
    r = lireSaisie({ description: 'x', annee: '20a4' }, { now });
    ok(r.errors.some((e) => /Année invalide/.test(e)), 'année non numérique : refus');
    r = lireSaisie({ description: 'x', annee: '1850' }, { now });
    ok(r.errors.some((e) => /Année invalide/.test(e)), 'année hors bornes : refus');
    r = lireSaisie({ description: 'x', date_souhaitee: '2026-10-18' }, { now });
    ok(r.errors.some((e) => /déjà passée/.test(e)), 'date souhaitée passée : refus');
    r = lireSaisie({ description: 'x', date_souhaitee: '2026-02-30' }, { now });
    ok(r.errors.some((e) => /invalide/.test(e)), 'date impossible (30 février) : refus');
    r = lireSaisie({ description: 'x', date_souhaitee: '2026-10-19' }, { now });
    ok(r.errors.length === 0 && r.values.date_souhaitee === '2026-10-19', 'date du jour : admise');
    r = lireSaisie({ description: 'x', source_request_id: 'abc' }, { now });
    ok(r.errors.some((e) => /origine/.test(e)), 'reprise d\'une demande à identifiant non entier : refus');
    r = lireSaisie({ num_dossier: 'D'.repeat(51) }, { now });
    ok(r.errors.some((e) => /dépasse 50/.test(e)), 'n° de dossier trop long : refus (au lieu d\'une erreur SQL)');
    ok(lireSaisie({ description: 'x', mode: 'rapide' }).mode === 'rapide' && lireSaisie({ description: 'x' }).mode === 'complet', 'mode : complet par défaut (clients existants)');
    ok(libelleDemande({ nom_entreprise: 'SOTRA' }) === 'SOTRA', 'libellé : l\'entreprise d\'abord');
    ok(libelleDemande({ description: 'a'.repeat(80) }).length === 58, 'libellé : description tronquée');
    ok(libelleDemande({ id: 5 }) === 'n° 5', 'libellé : jamais « null »');
  }

  console.log('\n6. Création — demande rapide et formulaire complet');
  {
    const { createRequest } = require('./controllers/requestController');
    const creer = (body, user = utilisateur(100, 'lecteur')) => appel(createRequest, { body, user });

    let r = await creer({ mode: 'rapide', description: 'Le PV de l\'AG 2023', beneficiaire: 'Mme Adjovi' });
    ok(r.code === 201, 'lecteur : demande rapide créée (201)');
    ok(r.body.request.description === 'Le PV de l\'AG 2023' && r.body.request.num_dossier === null, 'description enregistrée, références vides');
    ok(r.body.request.beneficiaire === 'Mme Adjovi', 'bénéficiaire enregistré');
    ok(appelsChamps.at(-1).systemRequired === false, 'rapide : champs système obligatoires non exigés');
    ok(mails.at(-1) && mails.at(-1).event === 'request_created', 'accusé de réception envoyé');

    r = await creer({ description: 'Le PV' });
    ok(r.code === 400 && /Numéro de dossier/.test(r.body.message), 'complet : champ système obligatoire de l\'organisation exigé');

    r = await creer({ mode: 'rapide', annee: 2024 });
    ok(r.code === 400 && /Décrivez/.test(r.body.message), 'rien d\'identifiable : 400');

    r = await creer({ mode: 'rapide', description: 'x', source_request_id: 10 }, utilisateur(300, 'demandeur'));
    ok(r.code === 400 && /origine/.test(r.body.message), 'reprise d\'une demande d\'autrui : refusée');
    r = await creer({ mode: 'rapide', description: 'x', source_request_id: 10 }, utilisateur(100, 'demandeur'));
    ok(r.code === 201 && r.body.request.source_request_id === 10, 'reprise de sa propre demande : acceptée');

    insertionsRefusees = true;
    r = await creer({ mode: 'rapide', description: 'x' });
    ok(r.code === 503 && r.body.code === 'MIGRATION_023_REQUISE', 'base non migrée : demande rapide refusée en clair');
    r = await creer({ nom_entreprise: 'SOTRA', num_dossier: 'D1', num_acte: 'A1', annee: 2020 });
    ok(r.code === 201 && !('description' in r.body.request), 'base non migrée : demande classique enregistrée comme avant');
    insertionsRefusees = false;
  }

  console.log('\n7. Annulation par l\'auteur');
  {
    const router = require('./routes/requestRoutes');
    const couche = router.stack.find((l) => l.route && l.route.path === '/:id/status');
    const garde = couche.route.stack[0].handle;
    ok((await appel(garde, { user: utilisateur(100, 'demandeur') })).code === 'next', 'route : un demandeur passe la garde');

    const { updateRequestStatus } = require('./controllers/requestController');
    const changer = (user, body) => appel(updateRequestStatus, { params: { id: '10' }, body, user });
    let r = await changer(utilisateur(300, 'demandeur'), { status: 'annulé' });
    ok(r.code === 400 && /vos propres/.test(r.body.message), 'annuler la demande d\'autrui : refus');
    r = await changer(utilisateur(100, 'lecteur'), { status: 'a traiter' });
    ok(r.code === 400 && /annuler/.test(r.body.message), 'l\'auteur ne fait pas avancer sa demande');
    const avant = journalSql.length;
    r = await changer(utilisateur(100, 'demandeur'), { status: 'annulé', notes_internes: 'tentative' });
    ok(r.code === 200, 'l\'auteur annule sa demande');
    const maj = journalSql.slice(avant).find((q) => /^UPDATE requests SET statut/.test(q.sql));
    ok(maj && !/notes_internes/.test(maj.sql), 'l\'auteur n\'écrit pas les notes internes');
  }

  console.log(`\n${echecs === 0 ? '✅' : '❌'} Accès aux demandes cohérent — ${verifs} vérifications${echecs ? `, ${echecs} échec(s)` : ''}.`);
  process.exit(echecs > 0 ? 1 : 0);
})();
