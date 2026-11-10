// ============================================================================
// courrier.test.js — gestion du courrier, bureau d'ordre (migration 041).
// Numéro chronologique, périmètre et confidentialité, affectation, réponse
// liée, clôture, accusé de réception, rappels d'échéance.
// Exécution : npm run test:courrier
// ============================================================================
const courrier = require('./services/courrierService');

let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };
const attendreErreur = async (fn) => { try { await fn(); return null; } catch (err) { return err; } };

const lettre = { sens: 'arrivee', objet: 'Demande de permis de construire', correspondant: 'M. Koffi Mensah', organisme: 'BÂTIR PLUS SA', date_courrier: '2026-01-05', reponse_attendue: true };

(async () => {
  console.log('\n1. Sans base');
  const s = courrier.lireSaisie(lettre, { delaiJours: 10 });
  ok(s.erreurs.length === 0 && s.valeurs.echeance === new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10), 'réponse attendue : échéance proposée au délai réglé');
  ok(courrier.lireSaisie({ ...lettre, objet: '' }).erreurs.length === 1, 'objet obligatoire');
  ok(courrier.lireSaisie({ ...lettre, sens: 'ailleurs' }).erreurs.length >= 1, 'sens inconnu : refusé');
  ok(courrier.lireSaisie({ ...lettre, date_courrier: '2999-01-01' }).erreurs.length === 1, 'date du courrier dans le futur : refusée');
  ok(courrier.lireSaisie({ ...lettre, sens: 'depart' }).valeurs.reponse_attendue === false, 'un départ n\'attend pas de réponse de notre part');
  ok(courrier.enRetard({ echeance: '2026-01-01', statut: 'affecte' }, '2026-01-02') && !courrier.enRetard({ echeance: '2026-01-01', statut: 'clos' }, '2026-01-02'), 'retard : échéance passée et courrier ouvert');

  if (!(process.env.DB_HOST || process.env.DATABASE_URL)) {
    console.log('\n2. Sur PostgreSQL — SAUTÉ (ni DB_HOST ni DATABASE_URL)');
  } else {
    console.log('\n2. Sur PostgreSQL');
    const db = require('./config/db');
    const roleService = require('./services/roleService');
    const t0 = Date.now();
    const t = (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Courrier ${t0}`, `courrier-${t0}`])).rows[0].id;
    await roleService.provisionRoles(t);
    const u = async (role, nom) => (await db.query(
      "INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', $3, $4, $5) RETURNING id, tenant_id, role, username, full_name",
      [t, `${nom.toLowerCase()}${t0}`, nom, `${nom}${t0}@exemple.test`, role])).rows[0];
    const chef = await u('responsable', 'Chef');
    const secretaire = await u('archiviste', 'Secretaire');
    const agent = await u('agent', 'Agent');
    const autre = await u('agent', 'Autre');
    const lecteur = await u('lecteur', 'Lecteur');
    const annee = new Date().getFullYear();

    // --- Enregistrement et numérotation -------------------------------------
    const a1 = await courrier.enregistrer(secretaire, lettre);
    const [a2, a3] = await Promise.all([courrier.enregistrer(secretaire, { ...lettre, objet: 'Deuxième' }), courrier.enregistrer(chef, { ...lettre, objet: 'Troisième' })]);
    ok(a1.numero === `A-${annee}-00001` && a1.statut === 'enregistre', `numéro chronologique : ${a1.numero}`);
    ok([a2.numero, a3.numero].sort().join() === `A-${annee}-00002,A-${annee}-00003`, 'deux enregistrements simultanés : numéros distincts et consécutifs');
    ok((await attendreErreur(() => courrier.enregistrer(agent, lettre)))?.status === 403, 'agent sans mail.register : enregistrement refusé');
    ok((await attendreErreur(() => courrier.enregistrer(secretaire, { ...lettre, assigne_a: lecteur.id })))?.status === 400, 'affectation à qui n\'a pas accès au courrier : refusée');

    // --- Périmètre ------------------------------------------------------------
    ok((await courrier.lister(chef, {})).total === 3, 'superviseur : tout le registre');
    ok((await courrier.lister(agent, {})).total === 0 && (await attendreErreur(() => courrier.lire(agent, a1.id)))?.status === 404, 'agent : rien tant que rien ne lui est affecté');
    const secret = await courrier.enregistrer(secretaire, { ...lettre, objet: 'Plainte nominative', confidentiel: true, assigne_a: agent.id });
    ok((await attendreErreur(() => courrier.lire(chef, secret.id)))?.status === 404 && (await courrier.lire(agent, secret.id)).confidentiel, 'confidentiel : invisible du superviseur, visible de l\'agent chargé');
    ok(!(await courrier.correspondants(chef, 'Koffi')).some((c) => c.n > 3), 'correspondants connus proposés, confidentiels exclus');

    // --- Affectation, prise en charge ---------------------------------------------
    let c = await courrier.affecter(chef, a1.id, { assigne_a: agent.id, instruction: 'Pour étude et avis', copies: [autre.id] });
    ok(c.statut === 'affecte' && c.assigne_nom === 'Agent' && c.instruction === 'Pour étude et avis', 'affecté avec l\'instruction du responsable');
    ok((await db.query("SELECT lien FROM notifications WHERE id_user = $1 AND type = 'courrier' ORDER BY id DESC LIMIT 1", [agent.id])).rows[0]?.lien === `/courrier/${a1.id}`, 'agent prévenu, la notification mène au courrier');
    ok((await courrier.lire(autre, a1.id)).actions.clore === false && (await courrier.lister(autre, { vue: 'copies' })).total === 1, 'en copie : lecture seule');
    ok((await attendreErreur(() => courrier.prendreEnCharge(autre, a1.id)))?.status === 409, 'prise en charge par un autre : refusée');
    c = await courrier.prendreEnCharge(agent, a1.id);
    ok(c.statut === 'en_traitement' && (await courrier.lister(agent, { vue: 'a_moi' })).total === 2, 'pris en charge ; « mes courriers » à jour');
    await courrier.annoter(autre, a1.id, { note: 'Voir aussi le dossier de 2024.' });
    ok((await courrier.lire(agent, a1.id)).evenements.some((e) => e.action === 'NOTE'), 'note d\'une personne en copie versée à l\'historique');

    // --- Réponse liée, expédition ---------------------------------------------------
    const rep = await courrier.repondre(agent, a1.id, {});
    ok(rep.numero === `D-${annee}-00001` && rep.statut === 'brouillon' && rep.origine.id === a1.id && rep.correspondant === lettre.correspondant, `réponse préparée par l'agent : départ ${rep.numero} lié à l'arrivée`);
    ok((await attendreErreur(() => courrier.expedier(autre, rep.id, {})))?.status === 404, 'départ invisible de qui n\'y a aucun rôle');
    // Lettre rédigée dans DocuFlow : PDF versé dans la GED, repris en nouvelle version.
    ok((await attendreErreur(() => courrier.rediger(agent, rep.id, { lettre: 'court' })))?.status === 400, 'lettre vide : refusée');
    const texteLettre = 'Monsieur,\n\nNous accusons réception de votre demande de permis de construire.\n\nElle est en cours d\'instruction par nos services.';
    let l = await courrier.rediger(agent, rep.id, { lettre: texteLettre, signataire: 'Le Maire', qualite: 'Le Maire de Vallée-Verte', lieu: 'Vallée-Verte' });
    const docLettre = (await db.query('SELECT d.statut, d.num_acte, (SELECT count(*)::int FROM document_files f WHERE f.document_id = d.id) AS n FROM documents d WHERE d.id = $1', [l.document_id])).rows[0];
    ok(l.document_id && docLettre.num_acte === rep.numero && docLettre.n === 1 && l.lettre === texteLettre, 'lettre rédigée : PDF versé dans la GED et lié au départ');
    const stocke = (await db.query('SELECT * FROM document_files WHERE document_id = $1', [l.document_id])).rows[0];
    const relu = await require('./services/paquetService').lireOctets(stocke);
    ok(relu && relu.subarray(0, 5).toString() === '%PDF-' && require('crypto').createHash('sha256').update(relu).digest('hex') === String(stocke.empreinte_sha256).trim(), 'le PDF existe dans le stockage et correspond à son empreinte');
    l = await courrier.rediger(agent, rep.id, { lettre: `${texteLettre}\n\nVeuillez agréer nos salutations.` });
    ok((await db.query('SELECT count(*)::int AS n FROM document_files WHERE document_id = $1', [l.document_id])).rows[0].n === 2, 'lettre reprise : nouvelle version du même document');
    const pdfLettre = await courrier.construireLettre({ numero: 'D-2026-00001', organisation: 'Mairie', date: new Date(), correspondant: 'M. X', objet: 'Objet', corps: 'Paragraphe. '.repeat(900) });
    ok(pdfLettre.subarray(0, 5).toString() === '%PDF-' && (await require('pdf-lib').PDFDocument.load(pdfLettre)).getPageCount() >= 2, 'lettre longue : le texte se poursuit sur une deuxième page');
    const exp = await courrier.expedier(agent, rep.id, { mode: 'Porteur' });
    c = await courrier.lire(agent, a1.id);
    ok(exp.statut === 'expedie' && c.statut === 'clos' && c.clos_motif === 'repondu' && c.reponses.length === 1, 'expédition constatée : l\'arrivée est close « répondu »');
    ok((await attendreErreur(() => courrier.affecter(chef, a1.id, { assigne_a: autre.id })))?.status === 409, 'courrier clos : plus d\'affectation');
    ok((await attendreErreur(() => courrier.rediger(agent, rep.id, { lettre: texteLettre })))?.status === 409, 'courrier expédié : la lettre ne se reprend plus');

    // --- Clôture -------------------------------------------------------------------
    ok((await attendreErreur(() => courrier.clore(chef, a2.id, { motif: 'sans_suite' })))?.status === 400, 'sans suite : explication obligatoire');
    ok((await courrier.clore(chef, a2.id, { motif: 'information' })).clos_motif === 'information', 'clos pour information');
    ok((await attendreErreur(() => courrier.modifier(chef, a2.id, { objet: 'Autre' })))?.status === 409, 'courrier clos : fiche figée');
    ok((await courrier.modifier(secretaire, a3.id, { objet: 'Troisième, corrigé' })).objet === 'Troisième, corrigé', 'fiche corrigée par le secrétariat, qui tient le registre');

    // --- Accusé de réception -----------------------------------------------------------
    const ar = await courrier.accuseReception(secretaire, a3.id);
    ok(ar.pdf.subarray(0, 5).toString() === '%PDF-' && (await courrier.lire(chef, a3.id)).accuse_reception_at, 'accusé de réception PDF délivré et tracé');
    ok((await attendreErreur(() => courrier.accuseReception(agent, secret.id)))?.status === 403, 'accusé de réception réservé au service du courrier');

    // --- Rappels ------------------------------------------------------------------------
    await courrier.affecter(chef, a3.id, { assigne_a: autre.id, echeance: new Date(Date.now() + 86400000).toISOString().slice(0, 10) });
    await db.query('UPDATE courriers SET echeance = CURRENT_DATE - 1 WHERE id = $1', [secret.id]);
    const avant = (await db.query("SELECT count(*)::int AS n FROM notifications WHERE tenant_id = $1 AND type = 'courrier'", [t])).rows[0].n;
    await courrier.relancer();
    await courrier.relancer();
    const apres = (await db.query("SELECT count(*)::int AS n FROM notifications WHERE tenant_id = $1 AND type = 'courrier'", [t])).rows[0].n;
    ok(apres - avant === 3, `rappels : échéance proche (1) et retard (agent + enregistreur), une seule fois (${apres - avant})`);
    const syn = await courrier.synthese(chef);
    ok(syn.en_cours === 1 && syn.en_retard === 0 && syn.delai_reponse_jours !== null && (await courrier.synthese(agent)).en_retard === 1, 'synthèse dans le périmètre de chacun');
    ok((await courrier.lister(secretaire, { q: 'corrigé' })).total === 1 && (await courrier.lister(chef, { sens: 'depart' })).total === 1, 'recherche et filtre par sens');

    const cx = await db.pool.connect();
    try {
      await cx.query('BEGIN');
      await cx.query("SET LOCAL docuflow.audit_override = 'on'");
      await cx.query('DELETE FROM tenants WHERE id = $1', [t]);
      await cx.query('COMMIT');
    } catch (err) { await cx.query('ROLLBACK'); console.error('nettoyage :', err.message); } finally { cx.release(); }
    await db.pool.end();
  }
  console.log(`\n${echecs === 0 ? '✅' : '❌'} Courrier cohérent — ${verifs} vérifications${echecs ? `, ${echecs} échec(s)` : ''}.`);
  process.exit(echecs ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
