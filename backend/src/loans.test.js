// ============================================================================
// loans.test.js — prêt des dossiers physiques (migration 025).
//
// 1. SANS BASE : état d'un prêt et lecture de la date de retour (fonctions
//    pures), gardes des routes.
// 2. AVEC BASE (si DB_HOST ou DATABASE_URL est défini) : le circuit complet
//    sur PostgreSQL — remise, refus (double remise, demande close, date
//    passée, geste d'un autre agent), signalement, confirmation, retour,
//    registre, relance unique. Une organisation jetable est créée à chaque
//    exécution : le journal d'audit est append-only, on ne nettoie pas
//    derrière soi — à lancer sur une base de TEST, jamais de production.
//
// Exécution : npm run test:loans
//   avec base : DB_HOST=… DB_PORT=… DB_USER=… DB_NAME=… npm run test:loans
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
const rejette = async (promesse, statut, nom) => {
  try {
    await promesse;
    ok(false, `${nom} (aucune erreur)`);
  } catch (err) {
    ok(err.statut === statut, `${nom}${err.statut === statut ? '' : ` (obtenu ${err.statut || err.message})`}`);
  }
};

const avecBase = Boolean(process.env.DB_HOST || process.env.DATABASE_URL);

// Sans base, roleService répond d'après le catalogue (gardes de routes).
if (!avecBase) {
  const chemin = require.resolve(path.join(__dirname, 'services', 'roleService.js'));
  require.cache[chemin] = {
    id: chemin, filename: chemin, loaded: true,
    exports: { possede: async (t, roleKey, p) => { const r = ROLES_SYSTEME.find((x) => x.key === roleKey); return !!r && accorde(r.permissions, p); } },
  };
}

const loan = require('./services/loanService');

const appel = (handler, req) => new Promise((resolve) => {
  const res = { code: 200, status(c) { this.code = c; return this; }, json(body) { resolve({ code: this.code, body }); } };
  Promise.resolve(handler(req, res, () => resolve({ code: 'next' })));
});

(async () => {
  console.log('\n1. État d\'un prêt et date de retour (sans base)');
  {
    const jour = '2026-10-19';
    ok(loan.etatPret({ date_retour_prevue: '2026-10-19' }, jour) === 'en_cours', 'retour prévu aujourd\'hui : en cours');
    ok(loan.etatPret({ date_retour_prevue: '2026-10-18' }, jour) === 'en_retard', 'retour prévu hier : en retard');
    ok(loan.etatPret({ date_retour_prevue: '2026-10-18', signale_at: new Date() }, jour) === 'signale', 'signalement prime sur le retard');
    ok(loan.etatPret({ date_retour_prevue: '2026-10-18', signale_at: new Date(), retourne_at: new Date() }, jour) === 'retourne', 'retourné prime sur tout');
    ok(loan.etatPret(null) === null, 'pas de prêt : null');
    const now = new Date(2026, 9, 19);
    ok(loan.lireDateRetour('', { defautJours: 7, now }).valeur === '2026-10-26', 'date absente : aujourd\'hui + durée par défaut');
    ok(loan.lireDateRetour(undefined, { defautJours: 30, now }).valeur === '2026-11-18', 'durée par défaut réglable');
    ok(/passée/.test(loan.lireDateRetour('2026-10-18', { now }).erreur), 'date passée : refus');
    ok(/invalide/.test(loan.lireDateRetour('2026-02-30', { now }).erreur), 'date impossible : refus');
    ok(loan.lireDateRetour('2026-10-19', { now }).valeur === '2026-10-19', 'retour le jour même : admis');
  }

  console.log('\n2. Gardes des routes');
  {
    const router = require('./routes/requestRoutes');
    const garde = (methode, chemin) => router.stack.find((l) => l.route && l.route.path === chemin && l.route.methods[methode]).route.stack[0].handle;
    const u = (role) => ({ user: { id: 1, tenant_id: 1, role } });
    ok((await appel(garde('post', '/:id/loan'), u('archiviste'))).code === 'next', 'remise : archiviste admis');
    ok((await appel(garde('post', '/:id/loan'), u('demandeur'))).code === 403, 'remise : demandeur refusé (403)');
    ok((await appel(garde('patch', '/:id/loan/return'), u('lecteur'))).code === 403, 'retour : lecteur refusé (403)');
    ok((await appel(garde('get', '/loans'), u('demandeur'))).code === 403, 'registre : demandeur refusé (403)');
    ok((await appel(garde('post', '/:id/loan/report'), u('demandeur'))).code === 'next', 'signalement : la porte est ouverte à l\'agent (le service vérifie l\'emprunteur)');
    const couches = router.stack.filter((l) => l.route).map((l) => l.route.path);
    ok(couches.indexOf('/loans') < couches.findIndex((p) => p.startsWith('/:id')), '/loans déclaré avant /:id/…');
  }

  if (!avecBase) {
    console.log('\n3. Circuit complet sur PostgreSQL — SAUTÉ (ni DB_HOST ni DATABASE_URL)');
  } else {
    console.log('\n3. Circuit complet sur PostgreSQL');
    const db = require('./config/db');
    const suffixe = Date.now();
    const t = (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Test prêts ${suffixe}`, `test-prets-${suffixe}`])).rows[0].id;
    const nouvelUtilisateur = async (role, nom) => (await db.query(
      `INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', $3, $4, $5) RETURNING id, full_name, role, tenant_id`,
      [t, `${role}-${suffixe}`, nom, `${role}-${suffixe}@exemple.test`, role]
    )).rows[0];
    const archiviste = await nouvelUtilisateur('archiviste', 'Arnaud Archiviste');
    const agent = await nouvelUtilisateur('agent', 'Awa Agent');
    const autre = await nouvelUtilisateur('demandeur', 'Didier Demandeur');
    const demande = async (statut = 'a traiter') => (await db.query(
      `INSERT INTO requests (tenant_id, id_user, description, motif, statut) VALUES ($1, $2, 'Dossier du personnel de M. Houngbo', 'Consultation', $3) RETURNING id`,
      [t, agent.id, statut]
    )).rows[0].id;

    const d1 = await demande();
    const { pret } = await loan.remettre(t, d1, archiviste, { observation: 'Boîte 12, rayon B' });
    ok(pret.emprunteur_id === agent.id && pret.remis_par === archiviste.id, 'remise : emprunteur = auteur, remis par l\'archiviste');
    const statut = (await db.query('SELECT statut, date_livraison FROM requests WHERE id = $1', [d1])).rows[0];
    ok(statut.statut === 'livré' && statut.date_livraison, 'remise : la demande passe « livré » (machine à états inchangée)');
    const hist = (await db.query('SELECT previous_status, new_status FROM request_history WHERE request_id = $1', [d1])).rows;
    ok(hist.some((h) => h.previous_status === 'a traiter' && h.new_status === 'livré'), 'remise : étape horodatée dans l\'historique');
    const notif = (await db.query("SELECT 1 FROM notifications WHERE request_id = $1 AND id_user = $2 AND type = 'loan_handover'", [d1, agent.id])).rows;
    ok(notif.length === 1, 'remise : l\'agent est notifié');
    const audit = (await db.query('SELECT action FROM audit_logs WHERE request_id = $1', [d1])).rows;
    ok(audit.some((a) => /A remis le dossier/.test(a.action)), 'remise : inscrite au journal d\'audit');

    await rejette(loan.remettre(t, d1, archiviste, {}), 409, 'double remise : 409');
    await rejette(loan.remettre(t, await demande('annulé'), archiviste, {}), 409, 'demande annulée : 409');
    await rejette(loan.remettre(t, await demande(), archiviste, { date_retour_prevue: '2020-01-01' }), 400, 'date de retour passée : 400');
    await rejette(loan.remettre(t + 99999, d1, archiviste, {}), 404, 'autre organisation : 404');

    await rejette(loan.signaler(t, d1, autre, { message: 'pas reçu' }), 403, 'signalement par un autre agent : 403');
    await rejette(loan.signaler(t, d1, agent, { message: '  ' }), 400, 'signalement vide : 400');
    await loan.signaler(t, d1, agent, { message: 'Je n\'ai pas reçu ce dossier' });
    const notifArchiviste = (await db.query("SELECT 1 FROM notifications WHERE request_id = $1 AND id_user = $2 AND type = 'loan_reported'", [d1, archiviste.id])).rows;
    ok(notifArchiviste.length === 1, 'signalement : l\'archiviste qui a remis est alerté');
    ok((await loan.registre(t, { etat: 'signale' })).some((p) => p.request_id === d1), 'registre : filtre « signalé »');

    await rejette(loan.confirmer(t, d1, autre), 403, 'confirmation par un autre agent : 403');
    const c1 = await loan.confirmer(t, d1, agent);
    const c2 = await loan.confirmer(t, d1, agent);
    ok(c1.pret.reception_confirmee_at && String(c1.pret.reception_confirmee_at) === String(c2.pret.reception_confirmee_at), 'confirmation : enregistrée, idempotente');

    await rejette(loan.retourner(t, await demande(), archiviste, {}), 404, 'retour sans prêt : 404');
    await rejette(loan.retourner(t, d1, agent, {}), 403, 'l\'emprunteur ne se décharge pas lui-même : 403');
    const r = await loan.retourner(t, d1, archiviste, { observation: 'Rangé boîte 12' });
    ok(r.pret.retourne_at && r.pret.retourne_par === archiviste.id, 'retour : enregistré par l\'archiviste');
    ok((await db.query("SELECT 1 FROM notifications WHERE request_id = $1 AND id_user = $2 AND type = 'loan_returned'", [d1, agent.id])).rows.length === 1,
      'retour : l\'agent reçoit sa décharge');
    await rejette(loan.retourner(t, d1, archiviste, {}), 409, 'double retour : 409');
    await rejette(loan.signaler(t, d1, agent, { message: 'x' }), 409, 'signaler un dossier déjà retourné : 409');

    // Retard et relance unique.
    const d2 = await demande();
    await loan.remettre(t, d2, archiviste, {});
    await db.query("UPDATE request_loans SET date_retour_prevue = CURRENT_DATE - 3 WHERE request_id = $1", [d2]);
    ok((await loan.registre(t, { etat: 'en_retard' })).map((p) => p.request_id).includes(d2), 'registre : filtre « en retard »');
    ok((await loan.registre(t, { etat: 'retourne' })).map((p) => p.request_id).join() === String(d1), 'registre : filtre « retourné »');
    const [n1, n2] = await Promise.all([loan.relancerRetards(t), loan.relancerRetards(t)]);
    ok(n1 + n2 === 1, 'relance : une seule, même sur deux appels simultanés');
    ok((await loan.relancerRetards(t)) === 0, 'relance : pas deux fois dans la journée');
    await rejette(loan.registre(t, { etat: 'nimporte' }), 400, 'registre : état inconnu → 400');

    const annotees = await loan.annoterListe(t, [{ id: d1 }, { id: d2 }, { id: 0 }]);
    ok(annotees[0].loan_etat === 'retourne' && annotees[1].loan_etat === 'en_retard' && !annotees[2].loan_etat, 'liste : badges des prêts');

    // Concurrence : deux remises simultanées — une seule passe.
    const d3 = await demande();
    const res = await Promise.allSettled([loan.remettre(t, d3, archiviste, {}), loan.remettre(t, d3, archiviste, {})]);
    ok(res.filter((x) => x.status === 'fulfilled').length === 1, 'remises simultanées : une seule aboutit');
    await db.pool.end();
  }

  console.log(`\n${echecs === 0 ? '✅' : '❌'} Prêts de dossiers cohérents — ${verifs} vérifications${echecs ? `, ${echecs} échec(s)` : ''}.`);
  process.exit(echecs > 0 ? 1 : 0);
})();
