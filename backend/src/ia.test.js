// ============================================================================
// ia.test.js — aide automatique (055) : choix des modèles, lecture d'une
// demande, noms proches. Les vrais modèles sont remplacés par des faux,
// rapides et prévisibles : on vérifie le branchement, pas le modèle.
// Exécution : node src/ia.test.js
// ============================================================================
let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };
const avecBase = Boolean(process.env.DB_HOST || process.env.DATABASE_URL);
// Jamais de vrai modèle ici : seulement les faux substitués plus bas.
process.env.IA_LOCALE = 'non';

// Faux modèle de vecteurs : même nom une fois espaces et points retirés → même vecteur.
const DIM = 64;
function fauxVecteurs(textes) {
  const data = new Float32Array(textes.length * DIM);
  textes.forEach((t, i) => {
    const cle = String(t).replace(/^query: /, '').replace(/[^a-z0-9]/g, '');
    let h = 0;
    for (const c of cle) h = (h * 31 + c.charCodeAt(0)) % 100003;
    data[i * DIM + (h % DIM)] = 1;
  });
  return Promise.resolve({ dims: [textes.length, DIM], data });
}

(async () => {
  const ia = require('./services/iaService');

  console.log('\n1. Choix des modèles');
  const env = (v, extra = {}) => ({ IA_LOCALE: v, ...extra });
  ok(ia.modelesActifs(env('non')).length === 0, 'IA_LOCALE=non : aucun modèle');
  ok(ia.modelesActifs(env('oui')).join() === 'recherche,entites,typologie', 'IA_LOCALE=oui : les trois');
  ok(ia.modelesActifs(env('recherche, typologie')).join() === 'recherche,typologie', 'liste choisie');
  ok(ia.modelesActifs({}, () => 512).length === 0, 'serveur de 512 Mo : aucun modèle');
  ok(ia.modelesActifs({}, () => 1536).join() === 'recherche,entites', 'serveur de 1,5 Go : recherche et entités');
  ok(ia.modelesActifs({}, () => 8192).length === 3, 'serveur de 8 Go : les trois');
  ok(ia.modelesActifs({ NODE_ENV: 'test' }, () => 8192).length === 0, 'tests : aucun vrai modèle sans le demander');

  console.log('\n2. Lecture d\'une demande');
  ok(ia.acteDans('acte 2024/1234 du 12 mars') === '2024/1234' && ia.acteDans('acte n° 1963') === '1963' && ia.acteDans('Agro Fictive') === null, 'n° d\'acte dans la phrase');
  const phrase = 'Je voudrais le dossier de bonne exécution de la société Agro Fictive du Zou, du 12 mars 2024';
  const jetons = [
    { word: 'Agro', entity: 'I-ORG', score: 0.93, index: 12 }, { word: 'Fi', entity: 'I-ORG', score: 0.94, index: 13 },
    { word: 'ctive', entity: 'I-ORG', score: 0.93, index: 14 }, { word: 'du', entity: 'I-ORG', score: 0.92, index: 15 },
    { word: 'Zou', entity: 'I-ORG', score: 0.92, index: 16 },
    { word: '12', entity: 'I-DATE', score: 0.98, index: 19 }, { word: 'mars', entity: 'I-DATE', score: 0.99, index: 20 },
    { word: '20', entity: 'I-DATE', score: 0.99, index: 21 }, { word: '24', entity: 'I-DATE', score: 0.99, index: 22 },
  ];
  const groupes = ia.regrouper(phrase, jetons);
  ok(groupes[0].valeur === 'Agro Fictive du Zou' && groupes[1].valeur === '12 mars 2024', 'jetons regroupés et retrouvés tels qu\'écrits');
  const types = [{ value: 'ATT', label: 'Attestation (ATT)' }, { value: 'CBE', label: 'Bonne exécution (CBE)' }, { value: 'AD', label: 'Avance de démarrage (AD)' }];
  ok(ia.typeNomme(phrase, types)?.value === 'CBE', 'typologie nommée dans la phrase : sans modèle');
  ok(ia.typeNomme('le dossier CBE de Zenith', types)?.value === 'CBE' && ia.typeNomme('Zenith Fictif', types) === null, 'par son sigle ; un nom seul : rien');

  ia._substituer('entites', async () => jetons);
  ia._substituer('typologie', async (texte, libelles) => ({ labels: ['Avance de démarrage', 'Attestation', 'Bonne exécution'].filter((l) => libelles.includes(l)), scores: [0.55, 0.2, 0.1] }));
  const lu = await ia.lireDemande(phrase, types);
  ok(lu.entreprise === 'Agro Fictive du Zou' && lu.dates[0] === '12 mars 2024' && lu.annee === 2024, 'entreprise, date et année lues');
  ok(lu.typologie?.value === 'CBE' && lu.typologie.source === 'texte', 'typologie écrite : elle prime sur le modèle');
  const lu2 = await ia.lireDemande('Merci de me sortir le dossier de la société Agro Fictive du Zou pour son actualisation', types);
  ok(lu2.typologie?.value === 'AD' && lu2.typologie.source === 'modele', 'typologie proposée par le modèle quand elle se détache');
  ia._substituer('typologie', async (texte, libelles) => ({ labels: libelles, scores: [0.3, 0.25, 0.2] }));
  const lu3 = await ia.lireDemande('Merci de me sortir le dossier de la société Agro Fictive du Zou', types);
  ok(lu3.typologie === null, 'modèle hésitant : pas de proposition');
  const court = await ia.lireDemande('Agro Fictive', types);
  ok(court.entreprise === null && court.typologie === null, 'un simple nom : rien n\'est deviné');
  ia._substituer('entites', null);
  ia._substituer('typologie', null);
  const sans = await ia.lireDemande(phrase, types);
  ok(sans.entreprise === 'Agro Fictive du Zou' && sans.typologie?.value === 'CBE' && sans.acte === null, 'sans modèle : les règles seules');
  ok(ia.entrepriseNommee("le dossier de l'avance de démarrage de la société Credo B.T.P du 12 mars 2025") === 'Credo B.T.P', 'entreprise après « société », sans modèle');
  ok(ia.entrepriseNommee('qui a le dossier société fictive des travaux') === 'fictive des travaux', '« des » dans le nom : gardé');
  ok(ia.entrepriseNommee('le dossier des Ets Kpadonou et Fils, acte 12') === 'Kpadonou et Fils' && ia.entrepriseNommee('le dossier de caution') === null, 'après « Ets » ; rien sans mot d\'entreprise');
  const np0 = require('./services/nomsProchesService');
  ok(np0.mots('credo b t p').join() === 'credo,btp', 'lettres isolées rejointes : « b t p » → « btp »');
  ok(np0.garde('credo btp', 'credo btp sarl') && np0.garde('zenit services', 'zenith services'), 'garde-fou : même nom, à une faute près');
  ok(!np0.garde('kouassi et freres', 'valdes et freres') && !np0.garde('kouassi et freres', 'auto koubaisi'), 'garde-fou : « … et frères » d\'un autre nom écarté');
  ok(!np0.garde('entreprise generale', 'entreprise generale du sud'), 'garde-fou : rien de distinctif cherché, rien proposé');
  const routes = require('./routes/iaRoutes');
  ok(routes.stack.some((l) => l.route?.path === '/lire-demande') && routes.stack.some((l) => l.route?.path === '/etat'), 'routes déclarées');

  if (!avecBase) {
    console.log('\n3. Noms proches sur PostgreSQL — SAUTÉ');
  } else {
    console.log('\n3. Noms proches sur PostgreSQL');
    const db = require('./config/db');
    const e = require('./services/entreeService');
    const np = require('./services/nomsProchesService');
    const s = Date.now();
    const t = (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Test IA ${s}`, `test-ia-${s}`])).rows[0].id;
    const u = (await db.query("INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', 'Archiviste', $3, 'archiviste') RETURNING id, full_name", [t, `ia-${s}`, `ia-${s}@exemple.test`])).rows[0];
    await e.importer(t, u, { fichier: 'point.xlsx', lignes: [
      { date: '2026-01-05', ordre: 1, actes: '101', denomination: 'CREDO BTP SARL', type: 'CBE' },
      { date: '2026-01-06', ordre: 2, actes: '102', denomination: 'Zénith Fictif', type: 'ATT' },
    ] });
    ok((await np.proches(t, 'credo b t p')).length === 0, 'sans modèle : aucun nom proche, rien n\'est indexé');
    const avant = await e.presence(t, { nom_entreprise: 'Crédo B.T.P' });
    ok(avant.total === 0, 'sans modèle : « Crédo B.T.P » pas trouvé (comme avant)');

    ia._substituer('recherche', fauxVecteurs);
    ok(await np.indexer(t) === 2, 'deux noms indexés');
    ok((await db.query('SELECT count(*)::int AS n FROM ia_noms WHERE tenant_id = $1', [t])).rows[0].n === 2, 'vecteurs gardés en base');
    ok(await np.indexer(t) === 0, 'réindexer : rien de nouveau');
    const pr = await np.proches(t, 'credo b t p');
    ok(pr.length === 1 && pr[0].nom === 'credo btp sarl', 'nom proche trouvé par le vecteur');
    const p1 = await e.presence(t, { nom_entreprise: 'Crédo B.T.P' });
    ok(p1.total === 1 && p1.entrees[0].approche === true && p1.entrees[0].nom_concorde === false && p1.entrees[0].denomination === 'CREDO BTP SARL', 'présence : nom proche, signalé à vérifier');
    const p2 = await e.presence(t, { nom_entreprise: 'Zenith Fictif' });
    ok(p2.total === 1 && !p2.entrees[0].approche && p2.entrees[0].nom_concorde, 'nom bien écrit : réponse habituelle, sans « à vérifier »');
    const p3 = await e.presence(t, { nom_entreprise: 'Crédo B.T.P', annee: 2020 });
    ok(p3.total === 0, 'nom proche mais hors de l\'année demandée : rien');
    const r1 = await e.rechercher(t, { q: 'Crédo B.T.P' });
    ok(r1.length === 1 && r1[0].approche === true && r1[0].denomination === 'CREDO BTP SARL', 'recherche de l\'archive : noms proches à défaut de nom exact');
    const r2 = await e.rechercher(t, { q: 'Crédo B.T.P', type: 'ATT' });
    ok(r2.length === 0, 'les autres filtres s\'appliquent aux noms proches');
    ok((await e.rechercher(t, { q: 'credo' })).every((x) => !x.approche), 'nom trouvé par les lettres : pas de repli');
    await e.supprimerFichier(t, u, { fichier: 'point.xlsx' });
    await new Promise((r) => setTimeout(r, 200));
    await np.indexer(t);
    ok((await db.query('SELECT count(*)::int AS n FROM ia_noms WHERE tenant_id = $1', [t])).rows[0].n === 0, 'classeur supprimé : ses noms quittent l\'index');
    ia._substituer('recherche', null);
  }
  console.log(`\n${verifs - echecs}/${verifs} vérifications réussies`);
  process.exit(echecs ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
