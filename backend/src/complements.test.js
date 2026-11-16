// ============================================================================
// complements.test.js — l'archive renvoie une demande insuffisante (051).
// 1. Sans base : machine à états, routes.
// 2. Avec base (DB_HOST/DATABASE_URL) : renvoi par l'archiviste, complément
//    par le demandeur, gardes (auteur seul, dossier sorti, rien à compléter,
//    exigences de la typologie). Organisation jetable.
// Exécution : npm run test:complements
// ============================================================================
let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };
const rejette = async (promesse, statut, nom) => {
  try { await promesse; ok(false, `${nom} (aucune erreur)`); } catch (err) {
    ok(err.statut === statut, `${nom}${err.statut === statut ? '' : ` (obtenu ${err.statut || err.message})`}`);
  }
};
const avecBase = Boolean(process.env.DB_HOST || process.env.DATABASE_URL);

(async () => {
  console.log('\n1. Règles (sans base)');
  const sm = require('./services/requestStateMachine');
  ok(sm.canTransition({ from: 'en attente', to: 'a completer', role: 'archiviste' }).ok
    && sm.canTransition({ from: 'a traiter', to: 'a completer', role: 'archiviste' }).ok, 'en attente / à traiter → à compléter');
  ok(!sm.canTransition({ from: 'transmis', to: 'a completer', role: 'archiviste' }).ok, 'un dossier transmis ne repart pas à compléter');
  ok(sm.canTransition({ from: 'a completer', to: 'annulé', role: 'demandeur', isOwner: true }).ok, 'à compléter : le demandeur peut encore annuler');
  ok(sm.label('a completer') === 'À compléter' && !sm.isTerminal('a completer'), 'libellé, état non final');
  const routes = require('./routes/requestRoutes');
  ok(['/:id/complement', '/:id/completer'].every((p) => routes.stack.some((l) => l.route?.path === p && l.route.methods.post)), 'routes déclarées');
  ok(require('./services/listeService').etatDossier({ statut: 'a completer' }) === 'a_completer', 'dossier de liste : « à compléter »');

  if (!avecBase) {
    console.log('\n2. Sur PostgreSQL — SAUTÉ');
  } else {
    console.log('\n2. Sur PostgreSQL');
    const db = require('./config/db');
    const c = require('./services/complementService');
    const s = Date.now();
    const t = (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Test compléments ${s}`, `test-compl-${s}`])).rows[0].id;
    await require('./services/roleService').provisionRoles(t);
    const compte = async (role, nom) => (await db.query(
      "INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', $3, $4, $5) RETURNING id, full_name, role, tenant_id",
      [t, `${role}-${nom}-${s}`, nom, `${role}-${nom}-${s}@exemple.test`, role])).rows[0];
    const archiviste = await compte('archiviste', 'Archiviste');
    const agent = await compte('demandeur', 'Agent');
    const autre = await compte('demandeur', 'Autre');
    const demande = async (champs) => (await db.query(
      `INSERT INTO requests (id_user, nom_entreprise, num_acte, annee, motif, statut, tenant_id)
       VALUES ($1, $2, $3, $4, 'Consultation', 'en attente', $5) RETURNING *`,
      [agent.id, champs.nom_entreprise || null, champs.num_acte || null, champs.annee || null, t])).rows[0];

    const d = await demande({ nom_entreprise: 'Agro Fictive' });
    await rejette(c.demander(t, agent, d.id, { champs: ['num_acte'] }), 403, 'un demandeur ne peut pas renvoyer une demande');
    await rejette(c.demander(t, archiviste, d.id, {}), 400, 'renvoi sans motif : 400');
    const r1 = await c.demander(t, archiviste, d.id, { champs: ['num_acte', 'annee', 'inconnu'], message: 'Il y a trois cautions à ce nom.' });
    ok(r1.statut === 'a completer' && r1.complement_champs.join() === 'num_acte,annee', 'renvoyée « à compléter », champs inconnus ignorés');
    const notif = (await db.query("SELECT message FROM notifications WHERE id_user = $1 AND type = 'complement'", [agent.id])).rows[0];
    ok(notif && /n° d'acte et l'année/.test(notif.message) && /trois cautions/.test(notif.message), 'le demandeur est prévenu : ce qui manque et le mot de l\'archive');
    const h = (await db.query('SELECT new_status FROM request_history WHERE request_id = $1', [d.id])).rows;
    ok(h.some((x) => x.new_status === 'a completer'), 'historique : compléments demandés');

    await rejette(c.completer(t, autre, d.id, { num_acte: '2026/58', annee: '2026' }), 403, 'seul l\'auteur complète');
    await rejette(c.completer(t, agent, d.id, { num_acte: '2026/58' }), 400, 'il manque encore l\'année : 400');
    await rejette(c.completer(t, agent, d.id, { num_acte: '2026/58', annee: '20' }), 400, 'année invalide : 400');
    const r2 = await c.completer(t, agent, d.id, { num_acte: '2026/58', annee: '2026', reponse: 'C\'est la CBE de mars.' });
    ok(r2.statut === 'en attente', 'complétée : de retour « en attente »');
    const lue = (await db.query('SELECT * FROM requests WHERE id = $1', [d.id])).rows[0];
    ok(lue.num_acte === '2026/58' && lue.annee === 2026 && lue.nom_entreprise === 'Agro Fictive' && lue.complement_reponse === 'C\'est la CBE de mars.' && lue.complement_fourni_at,
      'références ajoutées, le nom gardé, réponse et date notées');
    ok((await db.query("SELECT 1 FROM notifications WHERE id_user = $1 AND type = 'complement'", [archiviste.id])).rowCount === 1, 'l\'archive est prévenue');
    await rejette(c.completer(t, agent, d.id, { annee: '2025' }), 409, 'plus rien à compléter : 409');

    // Typologie : une caution exige le n° d'acte (édition AFGC seulement) — ici, pas d'exigence : la précision demandée suffit.
    const d2 = await demande({ nom_entreprise: 'Bâtiments Fictifs' });
    await c.demander(t, archiviste, d2.id, { champs: ['description'] });
    await rejette(c.completer(t, agent, d2.id, {}), 400, 'précisions demandées mais absentes : 400');
    ok((await c.completer(t, agent, d2.id, { reponse: 'Le dossier de 2019, agence de Parakou.' })).statut === 'en attente', 'précisions données dans le mot pour l\'archive');

    // Dossier déjà sorti : rien à compléter.
    const d3 = await demande({ nom_entreprise: 'Cabinet Fictif', num_acte: '12' });
    await require('./services/loanService').remettre(t, d3.id, archiviste, {});
    await rejette(c.demander(t, archiviste, d3.id, { champs: ['annee'] }), 409, 'dossier déjà sorti : 409');
    // Et un dossier à compléter ne sort pas.
    const d4 = await demande({ nom_entreprise: 'Zénith Fictif' });
    await c.demander(t, archiviste, d4.id, { message: 'Quel dossier ?' });
    await rejette(require('./services/loanService').remettre(t, d4.id, archiviste, {}), 409, 'demande à compléter : elle ne peut pas être transmise');
    // Le demandeur peut aussi y renoncer.
    const reqCtrl = require('./controllers/requestController');
    const appel = (handler, req) => new Promise((resolve) => {
      const res = { code: 200, status(x) { this.code = x; return this; }, json(body) { resolve({ code: this.code, body }); } };
      handler(req, res);
    });
    const raccourci = await appel(reqCtrl.updateRequestStatus, { params: { id: d4.id }, body: { status: 'en attente' }, user: { ...archiviste, tenant_id: t } });
    ok(raccourci.code === 400, 'pas de retour « en attente » sans les compléments');
    const annule = await appel(reqCtrl.updateRequestStatus, { params: { id: d4.id }, body: { status: 'annulé' }, user: { ...agent, tenant_id: t } });
    ok(annule.code === 200, 'le demandeur peut annuler une demande à compléter');
  }
  console.log(`\n${verifs - echecs}/${verifs} vérifications réussies`);
  process.exit(echecs ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
