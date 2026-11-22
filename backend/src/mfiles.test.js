// ============================================================================
// mfiles.test.js — API REST de M-Files et RAG (060).
// Un faux serveur M-Files (local) répond comme MFWS : jeton, recherche,
// propriétés, fichiers, contenu. Aucun appel réseau extérieur.
// Exécution : npm run test:mfiles
// ============================================================================
let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };
const avecBase = Boolean(process.env.DB_HOST || process.env.DATABASE_URL);
const http = require('http');

const OBJETS = [
  { Title: 'CBE Fictive Alpha 2025', ObjVer: { Type: 0, ID: 101, Version: 3 }, Class: 5, LastModifiedUtc: '2026-03-02T10:00:00Z', Files: [{ ID: 7, Name: 'CBE Fictive Alpha', Extension: 'txt', Size: 120 }] },
  { Title: 'CAD Fictive Beta 2026', ObjVer: { Type: 0, ID: 102, Version: 1 }, Class: 6, Files: [{ ID: 8, Name: 'scan', Extension: 'zip', Size: 10 }] },
];
const TEXTES = {
  '101-7': 'Caution de bonne exécution émise au profit de Fictive Alpha. La garantie est valable douze mois à compter de la réception provisoire des travaux. Le montant garanti est de cinq pour cent du marché.',
};
let jetonsDonnes = 0;
let refuserUneFois = true;

function fauxMfiles() {
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const json = (code, corps) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(corps)); };
    if (req.method === 'POST' && u.pathname === '/REST/server/authenticationtokens') {
      let corps = '';
      req.on('data', (c) => { corps += c; });
      req.on('end', () => {
        const b = JSON.parse(corps);
        if (b.Password !== 'secret-test') return json(403, { Message: 'Identifiants refusés' });
        jetonsDonnes += 1;
        return json(200, { Value: `jeton-${jetonsDonnes}` });
      });
      return;
    }
    if (!/^jeton-/.test(req.headers['x-authentication'] || '')) return json(401, { Message: 'Non authentifié' });
    if (u.pathname === '/REST/objects' && refuserUneFois) { refuserUneFois = false; return json(401, { Message: 'Jeton expiré' }); }
    if (u.pathname === '/REST/objects') {
      const q = (u.searchParams.get('q') || '').toLowerCase();
      return json(200, { Items: OBJETS.filter((o) => o.Title.toLowerCase().includes(q.split(' ')[0])), MoreResults: false });
    }
    let m = /^\/REST\/objects\/0\/(\d+)\/latest\/properties$/.exec(u.pathname);
    if (m) return json(200, [{ PropertyDef: 0, PropertyDefName: 'Nom ou titre', TypedValue: { DisplayValue: OBJETS.find((o) => o.ObjVer.ID === +m[1]).Title } }, { PropertyDef: 100, PropertyDefName: 'Classe', TypedValue: { DisplayValue: 'Garantie' } }, { PropertyDef: 1020, PropertyDefName: 'N° d\'acte', TypedValue: { DisplayValue: '14614' } }]);
    m = /^\/REST\/objects\/0\/(\d+)\/latest\/files$/.exec(u.pathname);
    if (m) return json(200, OBJETS.find((o) => o.ObjVer.ID === +m[1]).Files.map((f) => ({ ...f, Version: 1 })));
    m = /^\/REST\/objects\/0\/(\d+)\/latest\/files\/(\d+)\/content$/.exec(u.pathname);
    if (m) { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(TEXTES[`${m[1]}-${m[2]}`] || ''); }
    return json(404, { Message: 'Introuvable' });
  });
}

(async () => {
  const serveur = fauxMfiles();
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${serveur.address().port}/REST`;
  const mfiles = require('./services/mfilesApiService');
  const rag = require('./services/ragService');

  console.log('\n1. Sans base');
  ok(await mfiles.config(null, {}) === null, 'sans variables : M-Files non raccordé');
  Object.assign(process.env, { MFILES_REST_URL: base, MFILES_VAULT_GUID: 'C840BE1A-0000-0000-0000-000000000001', MFILES_USERNAME: 'docuflow', MFILES_PASSWORD: 'secret-test' });
  const c = await mfiles.config(null);
  ok(c && c.vault === '{C840BE1A-0000-0000-0000-000000000001}' && c.rest === base, 'configuration lue des variables, coffre entre accolades');
  const r = await mfiles.rechercher(null, 'cbe fictive');
  ok(r.resultats.length === 1 && r.resultats[0].titre === 'CBE Fictive Alpha 2025' && r.resultats[0].fichiers[0].nom === 'CBE Fictive Alpha.txt', 'recherche rapide : titre et fichiers');
  ok(jetonsDonnes === 2, 'jeton expiré (401) : redemandé une fois, sans erreur');
  ok(/\/vault\/%7BC840BE1A.*%7D\/show\/0-101$/.test(r.resultats[0].lien), 'lien vers M-Files Web');
  const o = await mfiles.objet(null, 0, 101);
  ok(o.titre === 'CBE Fictive Alpha 2025' && o.classe === 'Garantie' && o.proprietes.some((p) => p.nom === 'N° d\'acte' && p.valeur === '14614'), 'fiche : propriétés affichées');
  ok((await mfiles.contenu(null, 0, 101, 7)).buffer.toString().startsWith('Caution de bonne'), 'contenu d\'un fichier');
  let e1 = null; try { await mfiles.rechercher(null, 'x'); } catch (e) { e1 = e.statut; }
  ok(e1 === 400, 'recherche trop courte : 400');
  process.env.MFILES_PASSWORD = 'mauvais'; mfiles._jetons.clear();
  ok((await mfiles.etat(null)).joignable === false, 'mot de passe refusé : signalé, sans plantage');
  process.env.MFILES_PASSWORD = 'secret-test'; mfiles._jetons.clear();
  const morceaux = rag.decouper('Phrase. '.repeat(400));
  ok(morceaux.length > 2 && morceaux.every((m) => m.length <= 900), 'découpage en morceaux bornés');

  if (!avecBase) { console.log('\n2. Sur PostgreSQL — SAUTÉ'); } else {
    console.log('\n2. Sur PostgreSQL');
    const db = require('./config/db');
    const s = Date.now();
    const t = (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Test M-Files ${s}`, `test-mfiles-${s}`])).rows[0].id;
    await db.query("INSERT INTO documents (tenant_id, reference_mfile, num_dossier, num_acte, nom_entreprise, annee, type_document, contenu_texte) VALUES ($1, 'R1', 'D1', '200', 'Fictive Gamma', 2026, 'CAD', $2)",
      [t, 'Avance de démarrage accordée à Fictive Gamma. Le remboursement se fait par retenues de dix pour cent sur chaque décompte jusqu\'à apurement complet.']);
    ok(await rag.indexerGed(t) === 1 && await rag.indexerGed(t) === 0, 'GED : document indexé une fois, pas deux');
    const b = await rag.indexerRechercheMfiles(t, 'fictive');
    ok(b.trouves === 2 && b.indexes === 2, 'M-Files : résultats d\'une recherche indexés');
    ok((await rag.indexerRechercheMfiles(t, 'fictive')).deja === 2, 'version inchangée : pas relue');
    const p = await rag.retrouver(t, 'combien de mois est valable la garantie de bonne exécution ?');
    ok(p[0] && p[0].source === 'mfiles' && /douze mois/.test(p[0].texte), 'question : le bon passage M-Files remonte en premier');
    const p2 = await rag.retrouver(t, 'remboursement avance démarrage retenues');
    ok(p2[0] && p2[0].source === 'ged', 'question : le passage de la GED');
    const rep = await rag.repondre(t, 'durée de validité de la garantie de Fictive Alpha');
    ok(rep && /douze mois/.test(rep.texte) && rep.sources[0].source === 'M-Files' && /show\/0-101/.test(rep.sources[0].lien), 'réponse avec ses sources et le lien M-Files (sans Ollama : les passages)');
    ok(await rag.repondre(t, 'zzzz qqqq') === null, 'rien de pertinent : pas de réponse inventée');
    const bot = require('./services/docubotService');
    ok(bot.regleSure('que dit le contrat de Fictive Alpha sur la garantie ?') === 'documents' && bot.regleSure('cherche Fictive dans M-Files') === 'documents', 'DocuBot reconnaît les questions sur les documents');
    await require('./services/roleService').provisionRoles(t);
    const arch = (await db.query("INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', 'Archiviste', $3, 'archiviste') RETURNING id, tenant_id, role", [t, `a-${s}`, `a-${s}@exemple.test`])).rows[0];
    const dem = (await db.query("INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', 'Agent', $3, 'demandeur') RETURNING id, tenant_id, role", [t, `d-${s}`, `d-${s}@exemple.test`])).rows[0];
    const ra = await bot.repondre(arch, 'que dit le document sur la garantie de Fictive Alpha ?');
    ok(/douze mois/.test(ra.texte) && ra.elements.some((e) => /show\/0-101/.test(e.lien || '')), 'DocuBot (archive) : réponse, sources et résultats M-Files');
    ok(/réservée à l'archive/.test((await bot.repondre(dem, 'que dit le document sur la garantie de Fictive Alpha ?')).texte), 'DocuBot (demandeur) : réservé à l\'archive');
    await db.query('DELETE FROM tenants WHERE id = $1', [t]).catch(() => {});
  }
  serveur.close();
  console.log(`\n${verifs - echecs}/${verifs} vérifications réussies.`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
