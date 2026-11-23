// ============================================================================
// docubot-capacites.test.js — ce que DocuBot sait faire (docubotCapacites).
// 1. Sans base : fautes de frappe, routage des tournures.
// 2. Avec base : une organisation fictive ; DocuBot propose les actions, et
//    chaque bouton, exécuté par l'API comme le ferait l'écran, aboutit.
// Exécution : npm run test:docubot-capacites
// ============================================================================
let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };
process.env.IA_LOCALE = 'non';
const avecBase = Boolean(process.env.DB_HOST || process.env.DATABASE_URL);

(async () => {
  console.log('\n1. Sans base');
  const cap = require('./services/docubotCapacites');
  const bot = require('./services/docubotService');
  const k = (s) => cap.clePhonetique(s).join(' ');
  ok(k('mawuli negosse') === k('Ets Mawuli Négoce'), 'clé phonétique : « negosse » = « Négoce », sans la forme juridique');
  ok(k('Tokpa Logistik') === k('Sarl Tokpa Logistique') && k('Kanvo') === k('Kanvô'), 'clé phonétique : « Logistik », accents');
  ok(cap.distance('kanvo', 'kanvo') === 0 && cap.distance('chat', 'chats') === 1 && cap.distance('abc', 'xyz') === 3, 'distance d\'édition');
  ok(bot.regleSure('combien de temps garder les contrats de travail') === 'conservation', '« combien de temps garder les contrats » → conservation');
  ok(bot.regleSure('Combien de temps puis-je garder un dossier ?') !== 'conservation', '« garder un dossier » reste le délai de prêt');
  ok(bot.regleSure('comment importer le point du jour') === 'aide', '« comment importer le point du jour » → aide');
  ok(bot.regleSure('dossiers non retirés de Kanvô') === 'ou_est', '« dossiers non retirés de X » → la fiche');

  if (!avecBase) { console.log('\n2. Avec base — SAUTÉ (pas de base)'); } else {
    console.log('\n2. Avec base');
    process.env.PORT = '0';
    process.env.HOST = '127.0.0.1';
    const { server } = require('./app');
    await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const db = require('./config/db');
    const bcrypt = require('bcryptjs');
    const s = Date.now();
    const slug = `test-bot-${s}`;
    const tid = (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Test DocuBot ${s}`, slug])).rows[0].id;
    await require('./services/roleService').provisionRoles(tid);
    const motifs = ['Consultation', 'Prorogation', 'Remboursement', 'Authentification'].map((m) => ({ value: m, label: m }));
    await db.query("INSERT INTO settings (tenant_id, key, value) VALUES ($1, 'request_motifs', $2) ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value", [tid, JSON.stringify(motifs)]);
    const mdp = 'Phrase-de-test-2026';
    const hash = await bcrypt.hash(mdp, 10);
    const compte = async (ident, nom, role) => (await db.query(
      'INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [tid, `${ident}${s}`, hash, nom, `${ident}${s}@exemple.test`, role])).rows[0];
    const arch = await compte('a.', 'Alice Fictive', 'archiviste');
    const ag = await compte('b.', 'Bruno Essai', 'demandeur');
    const ag2 = await compte('c.', 'Chantal Exemple', 'demandeur');
    const entree = (nom, acte, jours) => db.query(
      `INSERT INTO dossiers_entres (tenant_id, date_point, semaine, num_actes, actes, denomination, lettre, type_garantie, empreinte)
       VALUES ($1, CURRENT_DATE - $4::int, CURRENT_DATE - $4::int - 2, $2::varchar, ARRAY[$5::int], $3::varchar, 'K', 'Bonne exécution (CBE)', md5($6))`, [tid, acte, nom, jours, Number(acte), nom + acte]);
    await entree('Sarl Fictive Négoce', '81001', 10);
    await entree('Ets Imaginaire Bâtiment', '81002', 12);
    const demande = async (u, nom, acte, motif = 'Consultation') => (await db.query(
      "INSERT INTO requests (tenant_id, id_user, nom_entreprise, num_acte, motif, statut) VALUES ($1, $2, $3, $4, $5, 'en attente') RETURNING id", [tid, u.id, nom, acte, motif])).rows[0].id;
    const dEnRetard = await demande(ag, 'Ets Imaginaire Bâtiment', '81002');
    await db.query('INSERT INTO request_loans (tenant_id, request_id, emprunteur_id, date_retour_prevue) VALUES ($1, $2, $3, CURRENT_DATE - 3)', [tid, dEnRetard, ag.id]);
    await db.query("UPDATE requests SET statut = 'livré' WHERE id = $1", [dEnRetard]);
    const dAttente = await demande(ag2, 'Sarl Fictive Négoce', '81001', 'Remboursement');

    const connexion = async (u) => (await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u.username, password: mdp, tenant_slug: slug }) })).json()).token;
    const jetons = { [arch.id]: await connexion(arch), [ag.id]: await connexion(ag), [ag2.id]: await connexion(ag2) };
    // Exécute un bouton « appel » comme l'écran : même méthode, même adresse, même corps.
    const cliquer = async (u, act) => {
      const r = await fetch(base + act.url, { method: act.methode.toUpperCase(), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jetons[u.id]}` }, body: JSON.stringify(act.corps || {}) });
      return r.status;
    };
    const dire = (u, q, contexte = {}) => bot.repondre(u, q, contexte);

    // Fautes de frappe.
    const r1 = await dire(arch, 'fictive negosse');
    ok(/Sarl Fictive Négoce/.test(r1.texte), 'faute de frappe : « fictive negosse » → Sarl Fictive Négoce');

    // Suite de conversation.
    const r2 = await dire(arch, 'où est le dossier Imaginaire Bâtiment');
    const r3 = await dire(arch, 'il devait le rendre quand ?', r2.contexte);
    ok(r3.intention === 'date_retour' && /Bruno Essai/.test(r3.texte) && /en retard/.test(r3.texte), 'suite : « il devait le rendre quand ? » sur le dossier dont on parlait');
    const r4 = await dire(arch, 'et son point d\'entrée ?', r2.contexte);
    ok(r4.intention === 'point' && /lettre \*\*K\*\*/.test(r4.texte), 'suite : « et son point d\'entrée ? »');

    // Personnes, classement, demandes en attente.
    const r5 = await dire(arch, 'qui a le plus de dossiers en retard ?');
    ok(r5.intention === 'classement' && /Bruno Essai/.test(r5.texte), 'classement des retards par agent');
    const r6 = await dire(arch, 'les dossiers chez Bruno Essai');
    ok(r6.intention === 'personne' && /1 dossier/.test(r6.texte) && /en retard/.test(r6.texte), 'les dossiers d\'un agent');
    const r6b = await dire(ag, 'les dossiers de Chantal Exemple');
    ok(/Seule l'archive/.test(r6b.texte), 'un agent ne voit pas les dossiers d\'un autre');
    const r7 = await dire(arch, 'demandes en attente');
    ok(r7.intention === 'en_attente' && r7.actions.some((x) => x.type === 'appel' && x.url === `/requests/${dAttente}/loan`), 'demandes en attente, avec « Transmettre »');
    const r8 = await dire(arch, 'combien de demandes de remboursement');
    ok(/1 demande/.test(r8.texte) && /Remboursement/.test(r8.texte), 'les chiffres filtrés par motif');

    // Actions : proposées, puis exécutées par l'API.
    const t = await dire(arch, 'transmets le dossier Fictive Négoce à Chantal');
    const bt = t.actions.find((x) => x.type === 'appel');
    ok(t.intention === 'action_transmettre' && bt?.url === `/requests/${dAttente}/loan`, 'transmettre : le bouton vise la demande de Chantal');
    ok(await cliquer(arch, bt) < 300 && (await db.query('SELECT count(*)::int n FROM request_loans WHERE request_id = $1 AND retourne_at IS NULL', [dAttente])).rows[0].n === 1, 'transmettre : le dossier est sorti chez Chantal');
    const rp = await dire(ag2, 'j\'ai rapporté le dossier Fictive Négoce');
    const brp = rp.actions.find((x) => x.type === 'appel');
    ok(rp.intention === 'action_rapporte' && await cliquer(ag2, brp) < 300, 'l\'agent annonce son retour');
    ok((await db.query('SELECT rapporte_annonce_at FROM request_loans WHERE request_id = $1', [dAttente])).rows[0].rapporte_annonce_at, 'le retour annoncé est noté');
    const rr = await dire(arch, 'marque le dossier Fictive Négoce comme retourné');
    const brr = rr.actions.find((x) => x.type === 'appel');
    ok(rr.intention === 'action_retour' && brr?.methode === 'patch' && await cliquer(arch, brr) < 300, 'l\'archive enregistre le retour');
    ok((await db.query('SELECT retourne_at FROM request_loans WHERE request_id = $1', [dAttente])).rows[0].retourne_at, 'le dossier est rentré');
    ok(await cliquer(ag2, { methode: 'patch', url: `/requests/${dEnRetard}/loan/return`, corps: {} }) === 403, 'un agent ne peut pas enregistrer un retour : le serveur refuse');

    const rd = await dire(ag, 'je veux le dossier Fictive Négoce pour une prorogation');
    const brd = rd.actions.find((x) => x.type === 'appel');
    ok(rd.intention === 'action_demander' && brd?.corps.motif === 'Prorogation' && brd.corps.nom_entreprise === 'Sarl Fictive Négoce', 'demander : le motif et le nom enregistré sont repris');
    ok(await cliquer(ag, brd) < 300, 'demander : la demande est créée');
    const deja = await dire(ag, 'demande le dossier Fictive Négoce');
    ok(/déjà demandé/.test(deja.texte), 'demander deux fois : DocuBot le dit');
    const ra = await dire(ag, 'annule ma demande Fictive Négoce');
    const bra = ra.actions.find((x) => x.type === 'appel');
    ok(ra.intention === 'action_annuler' && bra?.corps.status === 'annulé' && await cliquer(ag, bra) < 300, 'annuler sa demande');
    ok((await db.query("SELECT count(*)::int n FROM requests WHERE tenant_id = $1 AND id_user = $2 AND statut = 'annulé'", [tid, ag.id])).rows[0].n === 1, 'la demande est annulée');
    const hors = await dire(arch, 'quelle heure est-il', r2.contexte);
    ok(!['fiche', 'point', 'date_retour'].includes(hors.intention), '« quelle heure est-il » n\'est pas une suite');

    await db.query('DELETE FROM tenants WHERE id = $1', [tid]).catch(() => {});
    server.close();
  }
  console.log(`\n${verifs - echecs}/${verifs} vérifications réussies.`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
