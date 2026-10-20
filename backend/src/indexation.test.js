// ============================================================================
// indexation.test.js — indexation assistée (propositions de métadonnées).
// 1. SANS BASE : le moteur sur des pièces réalistes (arrêté, attestation RH,
//    bail) et les métadonnées typées cherchées par leur libellé.
// 2. AVEC BASE (DB_HOST ou DATABASE_URL) : propositions d'un document versé,
//    champs typés de l'organisation, isolement entre organisations.
// Exécution : npm run test:indexation
// ============================================================================
const fs = require('fs');
const path = require('path');
const { proposer, propositionsPour } = require('./services/indexSuggestionService');

let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };
const val = (props, champ) => props.find((p) => p.champ === champ)?.valeur;

const ARRETE = `RÉPUBLIQUE DU BÉNIN
MAIRIE DE PORTO-NOVO
Arrêté municipal n° 2019/045 portant budget primitif
Vu la délibération du conseil municipal du 14 mars 2019,
Fait à Porto-Novo, le 2 avril 2019`;
const ATTESTATION = `DIRECTION DES RESSOURCES HUMAINES
Attestation de travail
Monsieur Houngbo Jean, Matricule : 4521, Service : Comptabilité,
Date d'effet : 1er mars 2022`;
const BAIL = `CONTRAT DE BAIL COMMERCIAL
Bailleur : SCI Akpakpa, et SOTRA SA, preneur.
Dossier n° RB/COT/2020 B 451
Signé à Cotonou le 12 mars 2022`;
const CHAMPS = [
  { id: 1, label: 'Matricule', type: 'text' },
  { id: 2, label: "Date d'effet", type: 'date' },
  { id: 3, label: 'Service', type: 'select', options: [{ value: 'compta', label: 'Comptabilité' }, { value: 'rh', label: 'Ressources humaines' }] },
  { id: 4, label: 'Montant', type: 'number' },
];
const TYPES = ['Arrêté', 'Attestation', 'Contrat', 'PV', 'Autre'];

(async () => {
  console.log('\n1. Moteur (sans base)');
  let p = proposer(ARRETE, { types: TYPES });
  ok(val(p, 'type_document') === 'Arrêté', 'arrêté : type reconnu');
  ok(val(p, 'description') === 'Arrêté municipal n° 2019/045 portant budget primitif', 'arrêté : titre (en-têtes institutionnels sautés)');
  ok(val(p, 'date_document') === '2019-04-02', 'arrêté : date de signature préférée à celle d\'une pièce citée');
  ok(val(p, 'annee') === 2019 && val(p, 'num_acte') === '2019/045', 'arrêté : année et n° d\'acte');
  p = proposer(ATTESTATION, { types: TYPES, champs: CHAMPS });
  ok(val(p, 'meta:1') === '4521', 'métadonnée texte trouvée par son libellé, coupée au séparateur');
  ok(val(p, 'meta:2') === '2022-03-01', 'métadonnée date : « 1er mars 2022 » lue');
  ok(val(p, 'meta:3') === 'compta' && p.find((x) => x.champ === 'meta:3').affichage === 'Comptabilité', 'métadonnée liste : choix reconnu par son libellé, proposé par sa valeur');
  ok(!p.some((x) => x.champ === 'meta:4'), 'libellé absent du texte : rien d\'inventé');
  p = proposer(BAIL, { types: TYPES });
  ok(val(p, 'num_dossier') === 'RB/COT/2020 B 451', 'n° RCCM complet (espaces internes)');
  ok(val(p, 'nom_entreprise') === 'SCI Akpakpa' && val(p, 'type_document') === 'Contrat', 'bail : nom derrière son libellé, type');
  ok(p.every((x) => x.extrait && ['haute', 'moyenne'].includes(x.confiance)), 'chaque proposition a son extrait et sa confiance');
  ok(proposer('', { types: TYPES }).length === 0, 'texte vide : aucune proposition');
  const jumeau = proposer(ARRETE, { types: TYPES, champs: [{ id: 9, label: 'Type de document', type: 'select', options: [{ value: 'contrat', label: 'Contrat' }, { value: 'arrete', label: 'Arrêté' }] }] });
  ok(val(jumeau, 'meta:9') === 'arrete', 'propriété « Type de document » : même proposition que la fiche, en valeur de liste');
  ok(val(proposer('', { types: TYPES, nomFichier: 'contrat_location_2021.pdf' }), 'type_document') === 'Contrat', 'sans texte : type tiré du nom du fichier');

  if (!(process.env.DB_HOST || process.env.DATABASE_URL)) {
    console.log('\n2. Sur PostgreSQL — SAUTÉ (ni DB_HOST ni DATABASE_URL)');
  } else {
    console.log('\n2. Sur PostgreSQL');
    const db = require('./config/db');
    const { addFileToDocument } = require('./services/documentIndexService');
    const { FILES_DIR } = require('./config/paths');
    const s = Date.now();
    const t = (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Test indexation ${s}`, `test-idx-${s}`])).rows[0].id;
    const schema = (await db.query("INSERT INTO metadata_schemas (tenant_id, name, is_default) VALUES ($1, 'RH', TRUE) RETURNING id", [t])).rows[0].id;
    const matricule = (await db.query("INSERT INTO metadata_fields (schema_id, name, label, type) VALUES ($1, 'matricule', 'Matricule', 'text') RETURNING id", [schema])).rows[0].id;
    const doc = (await db.query(
      "INSERT INTO documents (tenant_id, reference_mfile, num_dossier, num_acte, nom_entreprise, annee, statut) VALUES ($1, $2, 'À indexer', 'À indexer', 'À indexer', 2026, 'à indexer') RETURNING id",
      [t, `IDX-${s}`])).rows[0].id;
    const fichier = path.join(FILES_DIR, `test-idx-${s}.txt`);
    fs.writeFileSync(fichier, ATTESTATION);
    await addFileToDocument(t, doc, null, { path: fichier, filename: path.basename(fichier), originalname: 'attestation.txt', mimetype: 'text/plain', size: ATTESTATION.length });
    const r = await propositionsPour(t, doc);
    ok(r.texte === 'disponible', 'texte du document disponible');
    ok(val(r.propositions, `meta:${matricule}`) === '4521', 'champ typé de l\'organisation proposé');
    ok(val(r.propositions, 'type_document') === 'Attestation' || val(r.propositions, 'description') === 'Attestation de travail', 'type ou titre proposé');
    ok((await propositionsPour(t + 99999, doc)) === null, 'autre organisation : document introuvable');
    fs.rmSync(fichier, { force: true });
    await db.pool.end();
  }
  console.log(`\n${echecs === 0 ? '✅' : '❌'} Indexation assistée cohérente — ${verifs} vérifications${echecs ? `, ${echecs} échec(s)` : ''}.`);
  process.exit(echecs ? 1 : 0);
})();
