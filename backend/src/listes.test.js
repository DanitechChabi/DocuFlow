// ============================================================================
// listes.test.js — demandes groupées en listes et cadre des sorties (047).
//
// 1. SANS BASE : lecture des lignes d'un classeur, avancement d'un dossier,
//    gardes des routes.
// 2. AVEC BASE (si DB_HOST ou DATABASE_URL est défini) : une liste déposée
//    d'un coup, transmise puis retournée en partie, retrouvée par cadre, par
//    liste et par entreprise ; visibilité limitée au demandeur et à l'archive.
//    Une organisation jetable est créée à chaque exécution — à lancer sur une
//    base de TEST, jamais de production.
//
// Exécution : npm run test:listes
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
    return err;
  }
  return null;
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

const listes = require('./services/listeService');

const appel = (handler, req) => new Promise((resolve) => {
  const res = { code: 200, status(c) { this.code = c; return this; }, json(body) { resolve({ code: this.code, body }); } };
  Promise.resolve(handler(req, res, () => resolve({ code: 'next' })));
});

(async () => {
  console.log('\n1. Lignes d\'un classeur et avancement (sans base)');
  {
    const { valeurs, erreurs } = listes.lireLignes([
      { nom_entreprise: '  Société Fictive A  ', num_dossier: 'CL-1' },
      { annee: '2024' },
      { num_acte: 'CS-2025-0001', annee: '2025' },
      { description: 'Dossier du client B', annee: '20' },
    ]);
    ok(valeurs.length === 2 && valeurs[0].nom_entreprise === 'Société Fictive A', 'lignes valides retenues, espaces retirés');
    ok(erreurs.length === 2 && erreurs[0].ligne === 2 && erreurs[1].ligne === 4, 'lignes fautives signalées par leur numéro (sans référence ; année invalide)');
    ok(listes.lireLignes(null).valeurs.length === 0, 'aucune ligne : liste vide, sans plantage');
    ok(listes.etatDossier({ statut: 'en attente' }) === 'demande', 'sans prêt : demandé');
    ok(listes.etatDossier({ statut: 'livré', remis_at: new Date() }) === 'transmis', 'prêt ouvert : transmis');
    ok(listes.etatDossier({ statut: 'livré', remis_at: new Date(), retourne_at: new Date() }) === 'retourne', 'prêt clos : retourné');
    ok(listes.etatDossier({ statut: 'annulé' }) === 'annule', 'annulé');
    ok(listes.etatDossier({ statut: 'livré' }) === 'servi', 'servi autrement (copie numérique) : rien ne sort');
  }

  console.log('\n2. Gardes des routes');
  {
    const router = require('./routes/requestRoutes');
    const garde = (methode, chemin) => router.stack.find((l) => l.route && l.route.path === chemin && l.route.methods[methode]).route.stack[0].handle;
    const u = (role) => ({ user: { id: 1, tenant_id: 1, role } });
    ok((await appel(garde('post', '/listes'), u('demandeur'))).code === 'next', 'déposer une liste : demandeur admis');
    ok((await appel(garde('post', '/listes'), u('lecteur'))).code === 'next', 'déposer une liste : lecteur admis (il peut demander)');
    ok((await appel(garde('post', '/listes/:listeId/transmission'), u('demandeur'))).code === 403, 'transmettre : demandeur refusé (403)');
    ok((await appel(garde('post', '/listes/:listeId/retour'), u('demandeur'))).code === 403, 'retour : demandeur refusé (403)');
    ok((await appel(garde('post', '/listes/:listeId/transmission'), u('archiviste'))).code === 'next', 'transmettre : archiviste admis');
    ok((await appel(garde('get', '/dossiers-connus'), u('demandeur'))).code === 'next', 'dossiers connus : qui peut demander');
    const couches = router.stack.filter((l) => l.route).map((l) => l.route.path);
    const premierId = couches.findIndex((p) => p.startsWith('/:id'));
    ok(['/listes', '/listes/:listeId', '/dossiers-connus', '/cadres', '/demandeurs', '/pour-agent'].every((p) => couches.indexOf(p) >= 0 && couches.indexOf(p) < premierId),
      'routes des listes déclarées avant /:id/…');
    ok((await appel(garde('post', '/pour-agent'), u('demandeur'))).code === 403, 'demande au nom d\'un agent : demandeur refusé (403)');
    ok((await appel(garde('get', '/demandeurs'), u('demandeur'))).code === 403, 'liste des agents : demandeur refusé (403)');
    ok((await appel(garde('post', '/pour-agent'), u('archiviste'))).code === 'next', 'demande au nom d\'un agent : archiviste admis');
  }

  if (!avecBase) {
    console.log('\n3. Circuit complet sur PostgreSQL — SAUTÉ (ni DB_HOST ni DATABASE_URL)');
  } else {
    console.log('\n3. Circuit complet sur PostgreSQL');
    const db = require('./config/db');
    const loan = require('./services/loanService');
    const suffixe = Date.now();
    const t = (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Test listes ${suffixe}`, `test-listes-${suffixe}`])).rows[0].id;
    await require('./services/roleService').provisionRoles(t);
    await db.query(
      `INSERT INTO settings (tenant_id, key, value) VALUES ($1, 'request_motifs', $2)
       ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [t, JSON.stringify([{ value: 'Consultation', label: 'Consultation' }, { value: 'Soldes créditeurs', label: 'Soldes créditeurs' }, { value: 'Commissaire aux comptes', label: 'Commissaire aux comptes' }])]
    );
    const nouvelUtilisateur = async (role, nom, cle) => (await db.query(
      `INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', $3, $4, $5) RETURNING id, full_name, role, tenant_id`,
      [t, `${cle}-${suffixe}`, nom, `${cle}-${suffixe}@exemple.test`, role]
    )).rows[0];
    const archiviste = await nouvelUtilisateur('archiviste', 'Arnaud Archiviste', 'arch');
    const finances = await nouvelUtilisateur('demandeur', 'Fanny Finances', 'fin');
    const juridique = await nouvelUtilisateur('demandeur', 'Jules Juridique', 'jur');

    // --- Dépôt ---
    const lignes = [
      { nom_entreprise: 'Société Fictive du Littoral', num_dossier: 'CL-0412', num_acte: 'CS-2025-0147', annee: 2025 },
      { nom_entreprise: 'Transit Imaginaire SA', num_dossier: 'CL-0275' },
      { nom_entreprise: 'Agro Fictive du Zou', num_dossier: 'CL-0503', description: 'Solde 1 250 000 F' },
    ];
    await rejette(listes.creer(t, finances, { libelle: 'Liste 1', cadre: 'Radiation', lignes }), 400, 'cadre non proposé : 400');
    await rejette(listes.creer(t, finances, { libelle: '  ', cadre: 'Soldes créditeurs', lignes }), 400, 'liste sans nom : 400');
    await rejette(listes.creer(t, finances, { libelle: 'Liste 1', cadre: 'Soldes créditeurs', lignes: [] }), 400, 'liste vide : 400');
    const e422 = await rejette(listes.creer(t, finances, { libelle: 'Liste 1', cadre: 'Soldes créditeurs', lignes: [lignes[0], { annee: 2024 }] }), 422, 'ligne sans référence : 422');
    ok(e422 && e422.code === 'LIGNES_INVALIDES' && e422.details[0].ligne === 2, '422 : le numéro de la ligne fautive est rendu');
    ok((await db.query('SELECT count(*)::int AS n FROM request_lots WHERE tenant_id = $1', [t])).rows[0].n === 0, 'refus : rien n\'est enregistré');
    await rejette(listes.creer(t, finances, { libelle: 'Liste 1', cadre: 'Soldes créditeurs', lignes, demandeur_id: juridique.id }), 403,
      'déposer au nom d\'un autre agent sans être l\'archive : 403');

    const l1 = await listes.creer(t, finances, { libelle: 'Liste 1', cadre: 'Soldes créditeurs', fichier: 'soldes-novembre.xlsx', lignes });
    ok(l1.dossiers.length === 3 && l1.dossiers.every((d) => d.etat === 'demande'), 'liste déposée : 3 dossiers « demandé »');
    const dem = (await db.query('SELECT id_user, motif, statut, lot_id FROM requests WHERE lot_id = $1', [l1.id])).rows;
    ok(dem.every((d) => d.id_user === finances.id && d.motif === 'Soldes créditeurs' && d.statut === 'en attente'),
      'chaque dossier est une demande : emprunteur, cadre (motif), statut');
    const hist = (await db.query('SELECT count(*)::int AS n FROM request_history WHERE request_id IN (SELECT id FROM requests WHERE lot_id = $1)', [l1.id])).rows[0].n;
    ok(hist === 3, 'une étape d\'historique par dossier');
    const audit = (await db.query("SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND action LIKE 'A déposé la liste « Liste 1 »%'", [t])).rows[0].n;
    ok(audit === 1, 'une ligne d\'audit pour le dépôt de la liste');
    const avisArchive = (await db.query("SELECT count(*)::int AS n FROM notifications WHERE id_user = $1 AND title = 'Nouvelle liste de dossiers'", [archiviste.id])).rows[0].n;
    ok(avisArchive === 1, 'l\'archive reçoit UN avis pour toute la liste');

    const l2 = await listes.creer(t, archiviste, { libelle: 'Liste 2', cadre: 'Commissaire aux comptes', lignes: [{ nom_entreprise: 'Cabinet Fictif', num_dossier: 'CL-0199' }], demandeur_id: juridique.id });
    ok((await db.query('SELECT id_user FROM requests WHERE lot_id = $1', [l2.id])).rows[0].id_user === juridique.id,
      'l\'archive dépose une liste reçue d\'un service : l\'emprunteur est l\'agent désigné');

    // --- Visibilité ---
    ok((await listes.lister(t, finances)).map((l) => l.libelle).join() === 'Liste 1', 'un agent ne voit que ses listes');
    ok((await listes.lister(t, archiviste)).length === 2, 'l\'archive voit toutes les listes');
    ok((await listes.lister(t, archiviste, { cadre: 'Commissaire aux comptes' })).map((l) => l.libelle).join() === 'Liste 2', 'filtre par cadre');
    ok((await listes.lister(t, archiviste, { q: 'imaginaire' })).map((l) => l.libelle).join() === 'Liste 1', 'recherche d\'une entreprise dans les listes');
    await rejette(listes.detail(t, l1.id, juridique), 404, 'liste d\'un autre agent : 404');
    await rejette(listes.detail(t + 99999, l1.id, archiviste), 404, 'autre organisation : 404');

    // --- Transmission ---
    const [d1, d2, d3] = l1.dossiers.map((d) => d.id);
    const tr = await listes.transmettre(t, l1.id, archiviste, { ids: [d1, d2] });
    ok(tr.transmis === 2 && tr.liste.dossiers.filter((d) => d.etat === 'transmis').length === 2, 'transmission de 2 dossiers cochés');
    const prets = (await db.query('SELECT observation_remise, emprunteur_id FROM request_loans WHERE request_id = ANY($1::int[])', [[d1, d2]])).rows;
    ok(prets.length === 2 && prets.every((p) => p.emprunteur_id === finances.id && /Liste « Liste 1 »/.test(p.observation_remise)), 'un prêt par dossier, la liste en observation');
    const avisRemise = (await db.query("SELECT count(*)::int AS n FROM notifications WHERE id_user = $1 AND type = 'loan_handover'", [finances.id])).rows[0].n;
    ok(avisRemise === 1, 'l\'emprunteur reçoit UN avis pour les dossiers transmis');
    await rejette(listes.transmettre(t, l1.id, archiviste, { ids: [d1] }), 409, 'dossier déjà transmis : 409');
    ok((await listes.transmettre(t, l1.id, archiviste, {})).transmis === 1, 'sans sélection : le reste de la liste est transmis');

    // --- Traçabilité : registre par cadre, par liste, par entreprise ---
    ok((await loan.registre(t, { cadre: 'Soldes créditeurs' })).length === 3, 'registre : sorties du cadre « Soldes créditeurs »');
    ok((await loan.registre(t, { liste: l1.id })).every((p) => p.liste_libelle === 'Liste 1' && p.cadre === 'Soldes créditeurs'), 'registre : sorties de la Liste 1, avec cadre et liste');
    ok((await loan.registre(t, { q: 'zou' })).map((p) => p.nom_entreprise).join() === 'Agro Fictive du Zou', 'registre : recherche par entreprise');
    ok((await loan.registre(t, { q: 'Fanny' })).length === 3, 'registre : recherche par emprunteur');
    await rejette(loan.registre(t, { liste: 'abc' }), 400, 'registre : liste invalide → 400');
    const jour = require('./helpers/requestInput').aujourdhui();
    ok((await loan.registre(t, { cadre: 'Soldes créditeurs', du: jour, au: jour })).length === 3, 'registre : sorties du jour (bornes comprises)');
    ok((await loan.registre(t, { du: '2020-01-01', au: '2020-12-31' })).length === 0, 'registre : période sans sortie');
    await rejette(loan.registre(t, { du: '2026-02-30' }), 400, 'registre : date impossible → 400');

    // --- Retour ---
    const rt = await listes.retourner(t, l1.id, archiviste, { ids: [d1, d3] });
    ok(rt.retournes === 2 && rt.liste.dossiers.find((d) => d.id === d2).etat === 'transmis', 'retour de 2 dossiers, le 3e reste sorti');
    ok((await db.query("SELECT count(*)::int AS n FROM notifications WHERE id_user = $1 AND type = 'loan_returned'", [finances.id])).rows[0].n === 1,
      'l\'emprunteur reçoit UN avis de décharge');
    await rejette(listes.retourner(t, l1.id, archiviste, { ids: [d1] }), 409, 'déjà retourné : 409');
    const resume = (await listes.lister(t, archiviste, { q: 'Liste 1' }))[0];
    ok(resume.total === 3 && resume.transmis === 1 && resume.retournes === 2 && resume.a_transmettre === 0, 'avancement de la liste : 1 transmis, 2 retournés');

    // --- Demande en un clic : dossiers connus ---
    const connus = await listes.dossiersConnus(t, finances, 'transit');
    ok(connus.length === 1 && connus[0].num_dossier === 'CL-0275' && connus[0].sorti_jusqu_au, 'dossier connu, signalé comme sorti avec sa date de retour');
    ok((await listes.dossiersConnus(t, finances, 'littoral'))[0].sorti_jusqu_au === null, 'dossier revenu : disponible');
    ok((await listes.dossiersConnus(t, juridique, 'transit')).length === 0, 'un agent ne voit pas les dossiers demandés par un autre');
    ok((await listes.dossiersConnus(t, finances, 'CL-0')).length === 3, 'un agent : ses 3 dossiers');
    ok((await listes.dossiersConnus(t, archiviste, 'CL-0')).length === 4, 'l\'archive voit les dossiers de toute l\'organisation (4)');
    ok((await listes.dossiersConnus(t, finances, 'x')).length === 0, 'saisie d\'un caractère : rien');
    ok((await listes.dossiersConnus(t, finances, '%')).length === 0, 'caractère « % » cherché tel quel');

    // --- Demande reçue par l'archive (téléphone) ---
    const rapide = require('./services/demandeRapideService');
    const agents = await rapide.demandeurs(t);
    ok(agents.length === 3 && agents.every((a) => a.full_name && !('email' in a) && !('role' in a)), 'liste des agents : nom et service seulement');
    await rejette(rapide.pourAgent(t, archiviste, { nom_entreprise: 'X' }), 400, 'sans agent : 400');
    const autreOrg = (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Autre ${suffixe}`, `autre-${suffixe}`])).rows[0].id;
    const etranger = (await db.query(`INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', 'Étranger', $3, 'demandeur') RETURNING id`, [autreOrg, `etr-${suffixe}`, `etr-${suffixe}@exemple.test`])).rows[0];
    await rejette(rapide.pourAgent(t, archiviste, { pour_user_id: etranger.id, nom_entreprise: 'X' }), 404, 'agent d\'une autre organisation : 404');
    await rejette(rapide.pourAgent(t, archiviste, { pour_user_id: juridique.id }), 400, 'sans référence ni description : 400');
    await rejette(rapide.pourAgent(t, archiviste, { pour_user_id: juridique.id, nom_entreprise: 'X', motif: 'Radiation' }), 400, 'cadre non proposé : 400');
    const tel = await rapide.pourAgent(t, archiviste, { pour_user_id: juridique.id, nom_entreprise: 'Garage Fictif du Centre', num_dossier: 'CL-0900' });
    ok(tel.request.id_user === juridique.id && tel.request.motif === 'Consultation' && tel.pret === null, 'demande enregistrée au nom de l\'agent, cadre par défaut');
    ok((await db.query("SELECT 1 FROM notifications WHERE request_id = $1 AND id_user = $2 AND title = 'Demande enregistrée'", [tel.request.id, juridique.id])).rows.length === 1,
      'l\'agent est prévenu que l\'archive a enregistré sa demande');
    ok((await db.query("SELECT 1 FROM audit_logs WHERE request_id = $1 AND action LIKE 'A enregistré la demande de Jules Juridique%'", [tel.request.id])).rows.length === 1,
      'journal d\'audit : qui a enregistré la demande, pour qui');
    const tel2 = await rapide.pourAgent(t, archiviste, { pour_user_id: juridique.id, nom_entreprise: 'Garage Fictif du Centre', motif: 'Commissaire aux comptes', transmettre: true });
    ok(tel2.pret && tel2.pret.emprunteur_id === juridique.id && tel2.request.statut === 'livré', 'enregistrée et transmise d\'un geste : prêt à l\'agent');
    await rejette(rapide.pourAgent(t, archiviste, { pour_user_id: juridique.id, nom_entreprise: 'Y', transmettre: true, date_retour_prevue: '2020-01-01' }), 400,
      'transmission avec date de retour passée : 400');
    ok((await db.query("SELECT count(*)::int AS n FROM requests WHERE tenant_id = $1 AND nom_entreprise = 'Y'", [t])).rows[0].n === 0,
      'refus de la transmission : la demande n\'est pas créée non plus (tout ou rien)');
  }

  console.log(`\n${verifs - echecs}/${verifs} vérifications réussies`);
  process.exit(echecs ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
