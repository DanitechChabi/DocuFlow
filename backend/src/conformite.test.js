// ============================================================================
// conformite.test.js — analyse des documents et contrôle de conformité
// (fonctionnalités reprises du projet DocFlow, réécrites pour DocuFlow).
// 1. SANS BASE : les règles d'incohérence (cas de test de DocFlow), la
//    lecture par règles, le modèle de langage (réseau simulé), les
//    fournisseurs, le registre officiel (réseau simulé).
// 2. AVEC BASE (DB_HOST ou DATABASE_URL) : analyse → alertes enregistrées,
//    statut traité conservé, résolution automatique, classe qui fait foi,
//    périmètre des dossiers, isolement entre organisations, fournisseurs.
// Exécution : npm run test:conformite
// ============================================================================
const { detecterIncoherences } = require('./services/conformiteService');
const { extraireParRegles, parseMontant } = require('./services/extractionRegles');
const llmService = require('./services/llmService');
const { fusionner } = require('./services/analyseService');
const fournisseurService = require('./services/fournisseurService');
const registre = require('./services/registreOfficielService');
const { extraireObjetJson } = require('./helpers/jsonLlm');
const { referentiel } = require('./config/conformite');

let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };

const FR = referentiel('fr');
const BJ = referentiel('bj');
let n = 0;
/** Un document analysé, comme les fixtures de DocFlow (make_silver). */
const doc = (nature, d = {}) => ({
  id: ++n,
  nom: `${nature}_test.pdf`,
  nature,
  donnees: {
    identifiant: '123456789', identifiant_declare: '123456789',
    etablissement: '12345678901234', etablissement_declare: '12345678901234',
    emetteur_nom: 'Acme SARL', montant_ttc: null, date_emission: null, ...d,
  },
});
const deType = (alertes, type) => alertes.filter((a) => a.type === type);

(async () => {
  console.log('\n1. Règles d\'incohérence (cas de DocFlow)');
  ok(deType(detecterIncoherences([doc('facture')], { referentiel: FR }), 'identifiant_format').length === 0, 'SIREN valide : pas d\'alerte');
  let a = deType(detecterIncoherences([doc('facture', { identifiant: null, identifiant_declare: '12345' })], { referentiel: FR }), 'identifiant_format');
  ok(a.length === 1 && a[0].severite === 'haute', 'SIREN trop court (5 chiffres) : alerte haute');

  a = deType(detecterIncoherences([doc('facture'), doc('attestation')], { referentiel: FR }), 'identifiant_incoherent');
  ok(a.length === 0, 'SIRET identiques sur facture et attestation : pas d\'alerte');
  a = deType(detecterIncoherences([doc('facture'), doc('attestation', { etablissement: '98765432109876', etablissement_declare: '98765432109876' })], { referentiel: FR }), 'identifiant_incoherent');
  ok(a.length === 1 && a[0].severite === 'critique' && new Set([a[0].valeurA, a[0].valeurB]).has('98765432109876') && new Set([a[0].valeurA, a[0].valeurB]).has('12345678901234'),
    'SIRET différents facture / attestation : alerte critique avec les deux valeurs');

  ok(deType(detecterIncoherences([doc('devis', { montant_ttc: 1000, emetteur_nom: 'Acme' }), doc('facture', { montant_ttc: 1040, emetteur_nom: 'Acme' })]), 'montant_incoherent').length === 0,
    'écart de 4 % (< 5 %) : pas d\'alerte');
  a = deType(detecterIncoherences([doc('devis', { montant_ttc: 1000, emetteur_nom: 'Acme' }), doc('facture', { montant_ttc: 1200, emetteur_nom: 'Acme' })]), 'montant_incoherent');
  ok(a.length === 1 && a[0].severite === 'haute', 'écart de 20 % : alerte haute');
  ok(deType(detecterIncoherences([doc('devis', { montant_ttc: 1000, emetteur_nom: 'Acme' }), doc('facture', { montant_ttc: 1200, emetteur_nom: 'Acme' })], { tolerance: 25 }), 'montant_incoherent').length === 0,
    'tolérance réglable : 25 % accepte l\'écart de 20 %');
  ok(deType(detecterIncoherences([doc('devis', { montant_ttc: 1000, emetteur_nom: 'Acme' }), doc('facture', { montant_ttc: 5000, emetteur_nom: 'AutreEntreprise' })]), 'montant_incoherent').length === 0,
    'émetteurs différents : pas de comparaison');
  ok(deType(detecterIncoherences([doc('devis', { montant_ttc: 1000, destinataire_nom: 'Client A' }), doc('facture', { montant_ttc: 9000, destinataire_nom: 'Client B' })]), 'montant_incoherent').length === 0,
    'destinataires différents : pas de comparaison (autre affaire)');

  a = deType(detecterIncoherences([doc('devis', { date_emission: '2024-06-01', emetteur_nom: 'Acme' }), doc('facture', { date_emission: '2024-05-01', emetteur_nom: 'Acme' })]), 'date_incoherente');
  ok(a.length === 1 && a[0].severite === 'moyenne', 'facture antérieure au devis : alerte moyenne');
  ok(deType(detecterIncoherences([doc('devis', { date_emission: '2024-04-01', emetteur_nom: 'Acme' }), doc('facture', { date_emission: '2024-05-01', emetteur_nom: 'Acme' })]), 'date_incoherente').length === 0,
    'facture postérieure au devis : pas d\'alerte');

  a = deType(detecterIncoherences([doc('attestation', { date_echeance: '2025-12-31' })], { aujourdhui: '2026-10-26' }), 'attestation_expiree');
  ok(a.length === 1 && a[0].severite === 'haute', 'attestation expirée : alerte haute');
  ok(deType(detecterIncoherences([doc('attestation', { date_echeance: '2027-01-31' })], { aujourdhui: '2026-10-26' }), 'attestation_expiree').length === 0, 'attestation valable : pas d\'alerte');

  a = detecterIncoherences([
    doc('devis', { montant_ttc: 1000, date_emission: '2024-06-01' }),
    doc('facture', { etablissement: '98765432109876', etablissement_declare: '98765432109876', montant_ttc: 2000, date_emission: '2024-05-01' }),
  ], { referentiel: FR });
  ok(a.length >= 3 && a[0].severite === 'critique', 'plusieurs incohérences à la fois : toutes détectées, les plus graves d\'abord');

  ok(deType(detecterIncoherences([doc('facture', { identifiant: null, identifiant_declare: '320171000123' })], { referentiel: BJ }), 'identifiant_format').length === 1,
    'Bénin : IFU de 12 chiffres (13 attendus) : alerte');
  ok(detecterIncoherences([doc('facture', { identifiant_declare: '1' }), doc('attestation', { etablissement: '9' })], { referentiel: referentiel('aucun') }).length === 0,
    'référentiel « aucun » : pas de contrôle d\'identifiant');
  const e1 = detecterIncoherences([doc('devis', { id: 0, montant_ttc: 1000 }), doc('facture', { montant_ttc: 1500 })])[0];
  const memes = detecterIncoherences([{ ...doc('devis'), id: 501, donnees: { emetteur_nom: 'X', montant_ttc: 1 } }, { ...doc('facture'), id: 502, donnees: { emetteur_nom: 'X', montant_ttc: 3 } }]);
  const inverses = detecterIncoherences([{ ...doc('facture'), id: 502, donnees: { emetteur_nom: 'X', montant_ttc: 3 } }, { ...doc('devis'), id: 501, donnees: { emetteur_nom: 'X', montant_ttc: 1 } }]);
  ok(e1 && memes[0].empreinte === inverses[0].empreinte, 'empreinte stable, quel que soit l\'ordre des documents');

  console.log('\n2. Lecture par règles');
  ok(JSON.stringify(['2 891 000', '1.500,00', '1,500.50', '1500,5', '1.500', 'abc'].map(parseMontant)) === JSON.stringify([2891000, 1500, 1500.5, 1500.5, 1500, null]),
    'montants : espaces, virgule ou point décimal, séparateurs de milliers');
  const facture = extraireParRegles(`FACTURE\nN° de facture : F2026-1182\nFournisseur : LUMINA ÉNERGIE\nIFU : 3201710001234\nClient : Mairie de Vallée-Verte\nDate de facture : 30 septembre 2026\nMontant HT : 2 450 000 FCFA\nTVA (18 %) : 441 000 FCFA\nMontant TTC : 2 891 000 FCFA\nDate d'échéance : 31 octobre 2026`, { referentiel: BJ });
  const f = facture.donnees;
  ok(facture.nature === 'facture' && f.numero_document === 'F2026-1182' && f.emetteur_nom === 'LUMINA ÉNERGIE' && f.destinataire_nom === 'Mairie de Vallée-Verte',
    'facture : nature, numéro, émetteur, destinataire');
  ok(f.montant_ht === 2450000 && f.montant_tva === 441000 && f.montant_ttc === 2891000 && f.devise === 'FCFA', 'facture : HT, TVA (le taux n\'est pas pris pour le montant), TTC, devise');
  ok(f.date_emission === '2026-09-30' && f.date_echeance === '2026-10-31' && f.identifiant === '3201710001234', 'facture : dates et IFU');
  const devis = extraireParRegles('BÂTIR PLUS SA\nDEVIS N° D-2026-014\nMontant HT : 1 000,00 €\nTVA : 200,00 €\nDate du devis : 12/03/2026\nValable jusqu\'au 12/04/2026', { referentiel: BJ });
  ok(devis.nature === 'devis' && devis.donnees.emetteur_nom === 'BÂTIR PLUS SA' && devis.donnees.montant_ttc === 1200 && devis.donnees.devise === 'EUR' && devis.donnees.date_echeance === '2026-04-12',
    'devis : émetteur d\'en-tête, TTC déduit de HT + TVA, euros, validité');
  ok(extraireParRegles('FACTURE PROFORMA n° P-12\nMontant TTC : 100').nature === 'devis', 'facture proforma : un devis');
  ok(extraireParRegles('Demande d\'attestation de conformité\nDemandeur : Cabinet Lefort').nature === 'autre', 'demande d\'attestation : pas une attestation');
  const att = extraireParRegles('Attestation de régularité fiscale\nSIREN : 123 456 78\nSIRET : 12345678901234\nValable jusqu\'au 31/12/2025', { referentiel: FR }).donnees;
  ok(att.identifiant_declare === '12345678' && att.identifiant === '123456789' && att.etablissement === '12345678901234' && att.date_echeance === '2025-12-31',
    'attestation (France) : SIREN déclaré gardé tel quel, SIREN déduit du SIRET, validité');
  const pro = extraireParRegles('COMMUNE DE VALLÉE-VERTE\nDécision de prorogation\nBénéficiaire : AGRO-SAVANE SARL', { referentiel: BJ }).donnees;
  ok(pro.emetteur_nom === null && pro.destinataire_nom === 'AGRO-SAVANE SARL', 'ligne « Bénéficiaire : … » : destinataire, pas émetteur');

  console.log('\n3. Modèle de langage (réseau simulé)');
  ok(extraireObjetJson('Réponse :\n```json\n{"nature":"facture","confiance":0.91}\n```').nature === 'facture', 'JSON dans un bloc de code');
  ok(extraireObjetJson('Voici les données : {"a":"{x}","b":1} merci').b === 1, 'JSON précédé et suivi de texte, accolades dans une chaîne');
  ok(extraireObjetJson('pas de json') === null, 'réponse sans JSON : null');
  const lu = llmService.interpreter('Voici les donnees extraites:\n{"siren":"123-456","siret":"38012986648625","emetteur_nom":"BAD SIREN ENT","montant_ttc":"100.00"}', FR);
  ok(lu.donnees.etablissement === '38012986648625' && lu.donnees.identifiant === '380129866' && lu.donnees.identifiant_declare === '123456'
    && lu.donnees.emetteur_nom === 'BAD SIREN ENT' && lu.donnees.montant_ttc === 100, 'cas DocFlow : SIREN invalide écarté (mais déclaré), SIRET gardé, montant');
  ok(llmService.interpreter('{"nature":"Facture","confiance":7,"date_emission":"2026-02-30"}', BJ).confiance === 1
    && llmService.interpreter('{"date_emission":"2026-02-30"}', BJ).donnees.date_emission === null, 'confiance bornée, date impossible rejetée');

  const appels = [];
  const postOrigine = llmService.http.post;
  llmService.http.post = async (url, corps, opts) => {
    appels.push({ url, corps, opts });
    const contenu = '{"nature":"devis","confiance":0.8,"emetteur_nom":"Acme","montant_ttc":"1 200,00"}';
    return { data: url.includes('groq') ? { choices: [{ message: { content: contenu } }] } : { message: { content: contenu } } };
  };
  const rOllama = await llmService.analyser(1, 'texte', { referentiel: BJ, cfg: { provider: 'ollama', modele: 'gpt-oss:20b', baseUrl: 'http://poste:11434', pret: true } });
  ok(appels[0].url === 'http://poste:11434/api/chat' && appels[0].corps.format === 'json' && rOllama.modele === 'ollama/gpt-oss:20b' && rOllama.donnees.montant_ttc === 1200,
    'fournisseur Ollama : appel local, format JSON');
  const rGroq = await llmService.analyser(1, 'texte', { referentiel: BJ, cfg: { provider: 'groq', modele: 'llama-3.3-70b-versatile', cleGroq: 'clef', pret: true } });
  ok(appels[1].url.includes('api.groq.com') && appels[1].opts.headers.Authorization === 'Bearer clef' && rGroq.nature === 'devis',
    'fournisseur Groq : API Groq, clé en en-tête');
  ok(appels[1].corps.messages[0].content.length < 6000, 'texte envoyé tronqué (pas le document entier)');
  llmService.http.post = async () => ({ data: { message: { content: 'désolé' } } });
  let refus = null;
  try { await llmService.analyser(1, 't', { referentiel: BJ, cfg: { provider: 'ollama', modele: 'm', baseUrl: 'http://x', pret: true } }); } catch (err) { refus = err.message; }
  ok(refus && /illisible/.test(refus), 'réponse sans JSON : erreur claire (les règles prendront le relais)');
  refus = null;
  try { await llmService.analyser(1, 't', { cfg: { provider: 'aucun', pret: false, raison: 'Aucun modèle' } }); } catch (err) { refus = err.message; }
  ok(refus === 'Aucun modèle', 'aucun fournisseur : pas d\'appel réseau');
  llmService.http.post = postOrigine;

  const fus = fusionner({ nature: 'facture', confiance: 0.6, donnees: { emetteur_nom: 'Règles', montant_ttc: 10, date_emission: '2026-01-01', identifiant_declare: '123' } },
    { nature: 'facture', confiance: 0.9, donnees: { emetteur_nom: 'Modèle', montant_ttc: null, date_emission: '2026-01-02', identifiant_declare: '999' } });
  ok(fus.donnees.emetteur_nom === 'Modèle' && fus.donnees.montant_ttc === 10 && fus.donnees.date_emission === '2026-01-02' && fus.donnees.identifiant_declare === '123',
    'fusion : le modèle prime, les règles comblent ses trous, le numéro déclaré reste celui lu dans le texte');

  console.log('\n4. Fournisseurs');
  ok(fournisseurService.cleFournisseur({ identifiant: '3201710001234', emetteur_nom: 'X' }) === 'id:3201710001234'
    && fournisseurService.cleFournisseur({ emetteur_nom: 'S.B.E.É.  SA' }) === 'nom:s b e e sa'
    && fournisseurService.cleFournisseur({}) === 'inconnu', 'clé : identifiant, sinon nom normalisé, sinon inconnu');
  ok(fournisseurService.cleFournisseur({ destinataire_nom: 'AGRO-SAVANE SARL' }) === 'nom:agro savane sarl', 'sans émetteur : le destinataire est le tiers');
  const cles = fournisseurService.resoudreCles([
    { id: 1, donnees: { identifiant: '3202400056781', emetteur_nom: 'BÂTIR PLUS SA' } },
    { id: 2, donnees: { emetteur_nom: 'Batir Plus SA' } },
    { id: 3, donnees: { identifiant: '1111111111111', emetteur_nom: 'LUMINA' } },
    { id: 4, donnees: { identifiant: '2222222222222', emetteur_nom: 'LUMINA' } },
    { id: 5, donnees: { emetteur_nom: 'Lumina' } },
  ]);
  ok(cles.get(2) === 'id:3202400056781' && cles.get(5) === 'nom:lumina',
    'un document sans identifiant rejoint le seul fournisseur de même nom ; avec deux numéros pour ce nom, rien n\'est tranché');
  const csv = fournisseurService.versCsv([{ cle: 'nom:a', groupe: 'nom', identifiant: null, nom: 'Dupont "et fils"', nombre_documents: 2, total_ttc: 10.5, devise: 'EUR', nombre_alertes: 1, natures: ['facture', 'devis'] }]);
  ok(csv.startsWith('﻿') && csv.includes('"Dupont ""et fils"""') && csv.includes(';"10.5";'), 'export CSV : BOM, guillemets échappés, séparateur « ; »');

  console.log('\n5. Registre officiel (réseau simulé)');
  const reponses = {
    '/siret/12345678901234': { status: 404 },
    '/siret/11111111111111': { status: 200, data: { etablissement: { periodesEtablissement: [{ etatAdministratifEtablissement: 'F' }], adresseEtablissement: { codePostalEtablissement: '75011', libelleCommuneEtablissement: 'PARIS', libelleVoieEtablissement: 'DES LILAS', typeVoieEtablissement: 'RUE', numeroVoieEtablissement: '12' }, uniteLegale: { periodesUniteLegale: [{ etatAdministratifUniteLegale: 'A', denominationUniteLegale: 'ORANGE' }] } } } },
  };
  const client = { get: async (url) => { const k = Object.keys(reponses).find((x) => url.endsWith(x)); if (!k) throw new Error('réseau'); return reponses[k]; } };
  const regAlertes = await registre.controler([
    { id: 1, nom: 'facture_fake.pdf', donnees: { etablissement: '12345678901234' } },
    { id: 2, nom: 'facture_orange.pdf', donnees: { etablissement: '11111111111111', emetteur_nom: 'ACME FAUX', emetteur_adresse: '3 avenue Foch 69001 Lyon' } },
    { id: 3, nom: 'reseau.pdf', donnees: { etablissement: '22222222222222' } },
  ], { cleApi: 'k', client });
  ok(regAlertes.some((x) => x.type === 'registre_introuvable' && x.severite === 'critique' && x.documentIds[0] === 1), 'SIRET inconnu du registre : alerte critique');
  ok(regAlertes.some((x) => x.type === 'registre_ferme' && x.documentIds[0] === 2), 'établissement fermé : alerte');
  ok(regAlertes.some((x) => x.type === 'nom_incoherent' && x.valeurB === 'ORANGE') && regAlertes.some((x) => x.type === 'adresse_incoherente'), 'nom et adresse différents du registre : alertes');
  ok(!regAlertes.some((x) => x.documentIds[0] === 3), 'registre injoignable : aucune alerte (le doute ne vaut pas accusation)');
  refus = null;
  try { await registre.controler([], { cleApi: '' }); } catch (err) { refus = err.message; }
  ok(/INSEE_API_KEY/.test(refus || ''), 'sans clé INSEE : refus explicite');

  if (!(process.env.DB_HOST || process.env.DATABASE_URL)) {
    console.log('\n6. Sur PostgreSQL — SAUTÉ (ni DB_HOST ni DATABASE_URL)');
  } else {
    console.log('\n6. Sur PostgreSQL');
    const db = require('./config/db');
    const analyseService = require('./services/analyseService');
    const conformiteService = require('./services/conformiteService');
    const settingsService = require('./services/settingsService');
    const aclService = require('./services/aclService');
    const s = Date.now();
    const tenant = async (nom) => (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`${nom} ${s}`, `${nom.toLowerCase()}-${s}`])).rows[0].id;
    const t = await tenant('Conf');
    const t2 = await tenant('Autre');
    const utilisateur = async (tid, role, nom) => (await db.query(
      "INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', $3, $4, $5) RETURNING id, tenant_id, role",
      [tid, `${nom}${s}`, nom, `${nom}${s}@exemple.test`, role])).rows[0];
    const archiviste = await utilisateur(t, 'archiviste', 'archi');
    const agent = await utilisateur(t, 'agent', 'agent');
    const autre = await utilisateur(t2, 'archiviste', 'autre');
    const versement = async (tid, texte, extra = {}) => (await db.query(
      `INSERT INTO documents (tenant_id, reference_mfile, num_dossier, num_acte, nom_entreprise, annee, statut, contenu_texte, dossier_id, classe_id)
       VALUES ($1, $2, 'x', 'x', 'x', 2026, 'disponible', $3, $4, $5) RETURNING id`,
      [tid, `C-${s}-${Math.random()}`, texte, extra.dossier || null, extra.classe || null])).rows[0].id;

    const dDevis = await versement(t, 'DEVIS N° D-1\nFournisseur : BÂTIR PLUS SA\nMontant TTC : 1 000 000 FCFA\nDate du devis : 10/09/2026');
    const dFacture = await versement(t, 'FACTURE N° F-9\nFournisseur : BÂTIR PLUS SA\nMontant TTC : 1 400 000 FCFA\nDate de facture : 01/09/2026');
    const dAtt = await versement(t, 'Attestation de régularité fiscale\nFournisseur : BÂTIR PLUS SA\nValable jusqu\'au 31/12/2025');
    for (const id of [dDevis, dFacture, dAtt]) await analyseService.analyserDocument(t, id, { recalculer: false });
    ok((await analyseService.extractionDe(t, dFacture)).donnees.montant_ttc === 1400000, 'analyse enregistrée (étage argent)');
    let bilan = await conformiteService.recalculer(t);
    let alertes = await conformiteService.listerAlertes(t, archiviste, {});
    const types = alertes.map((x) => x.type).sort().join(',');
    ok(bilan.documents === 3 && types === 'attestation_expiree,date_incoherente,montant_incoherent', `alertes enregistrées (étage or) : ${types}`);
    const tb = await conformiteService.tableauDeBord(t, archiviste);
    ok(tb.total_documents === 3 && tb.documents_non_conformes === 3 && tb.alertes_hautes === 2 && tb.alertes_moyennes === 1 && tb.taux_conformite === 0, 'tableau de bord : taux, alertes par sévérité');

    const montant = alertes.find((x) => x.type === 'montant_incoherent');
    await conformiteService.changerStatut(t, montant.id, archiviste, { statut: 'ignoree', note: 'avenant n° 2' });
    await conformiteService.recalculer(t);
    alertes = await conformiteService.listerAlertes(t, archiviste, { statut: 'toutes' });
    ok(alertes.find((x) => x.id === montant.id).statut === 'ignoree' && alertes.find((x) => x.id === montant.id).note === 'avenant n° 2', 'alerte ignorée : le reste après recalcul, avec sa note');

    await db.query("UPDATE documents SET contenu_texte = 'FACTURE N° F-9\nFournisseur : BÂTIR PLUS SA\nMontant TTC : 1 400 000 FCFA\nDate de facture : 20/09/2026' WHERE id = $1", [dFacture]);
    await analyseService.analyserDocument(t, dFacture, { recalculer: false });
    await conformiteService.recalculer(t);
    alertes = await conformiteService.listerAlertes(t, archiviste, { statut: 'toutes' });
    ok(alertes.find((x) => x.type === 'date_incoherente').statut === 'resolue', 'facture corrigée : l\'alerte de chronologie passe d\'elle-même à « résolue »');

    let refusStatut = null;
    try { await conformiteService.changerStatut(t, montant.id, archiviste, { statut: 'supprimee' }); } catch (err) { refusStatut = err.statut; }
    ok(refusStatut === 400, 'statut inconnu refusé (400)');

    // La classe fait foi : une classe sans rôle de conformité sort des contrôles.
    const classe = (await db.query("INSERT INTO metadata_schemas (tenant_id, name, is_default) VALUES ($1, 'Demande d''attestation', FALSE) RETURNING id", [t])).rows[0].id;
    await db.query('UPDATE documents SET classe_id = $1 WHERE id = $2', [classe, dAtt]);
    await analyseService.analyserDocument(t, dAtt, { recalculer: false });
    await conformiteService.recalculer(t);
    ok((await conformiteService.listerAlertes(t, archiviste, {})).every((x) => x.type !== 'attestation_expiree'), 'document classé « Demande d\'attestation » : plus contrôlé comme une attestation');

    // Périmètre : un dossier restreint à l'archiviste.
    const dossier = (await db.query("INSERT INTO document_folders (tenant_id, name) VALUES ($1, 'Marchés') RETURNING id", [t])).rows[0].id;
    await db.query("INSERT INTO folder_acls (tenant_id, folder_id, subject_type, subject_id, level) VALUES ($1, $2, 'user', $3, 'manage')", [t, dossier, String(archiviste.id)]);
    await db.query('UPDATE documents SET dossier_id = $1 WHERE id = $2', [dossier, dDevis]);
    aclService.invalidate();
    ok((await conformiteService.listerAlertes(t, archiviste, { statut: 'toutes' })).some((x) => x.type === 'montant_incoherent'), 'l\'archiviste du dossier voit l\'alerte du devis');
    ok(!(await conformiteService.listerAlertes(t, agent, { statut: 'toutes' })).some((x) => x.type === 'montant_incoherent'), 'hors périmètre : l\'alerte qui cite le devis est masquée');
    ok((await fournisseurService.lister(t, agent)).every((x) => x.nombre_documents <= 2), 'fournisseurs : le devis hors périmètre n\'est pas compté');
    ok((await conformiteService.listerAlertes(t2, autre, { statut: 'toutes' })).length === 0
      && (await conformiteService.tableauDeBord(t2, autre)).total_documents === 0, 'autre organisation : rien de visible');

    const fiches = await fournisseurService.lister(t, archiviste);
    const batir = fiches.find((x) => x.nom === 'BÂTIR PLUS SA');
    ok(batir && batir.nombre_documents === 3 && batir.total_ttc === 1400000 && !batir.a_des_alertes,
      'fournisseur : 3 documents, total TTC hors devis, plus d\'alerte ouverte (l\'écart de montant a été ignoré)');
    ok((await fournisseurService.documentsDe(t, archiviste, batir.cle)).length === 3, 'documents du fournisseur');

    // Registre injecté : ses alertes s'ajoutent quand le réglage est actif.
    await db.query("INSERT INTO settings (tenant_id, key, value) VALUES ($1, 'conformite_verifier_registre', 'true'), ($1, 'conformite_pays', 'fr') ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value", [t]);
    settingsService.invalidate(t);
    const { alerte: fabrique } = require('./services/alerteFabrique');
    await conformiteService.recalculer(t, { registre: async (enregs) => [fabrique('registre_introuvable', 'critique', 'SIRET inconnu', [enregs[0].id], 'etablissement', '1', null, 's')] });
    ok((await conformiteService.listerAlertes(t, archiviste, {})).some((x) => x.type === 'registre_introuvable'), 'registre officiel activé : ses alertes rejoignent les autres');
    await conformiteService.recalculer(t, { registre: async () => { throw new Error('quota'); } });
    ok((await conformiteService.listerAlertes(t, archiviste, {})).some((x) => x.type === 'registre_introuvable'), 'registre en panne : ses alertes ne sont pas résolues à tort');

    await db.pool.end();
  }
  console.log(`\n${echecs === 0 ? '✅' : '❌'} Conformité cohérente — ${verifs} vérifications${echecs ? `, ${echecs} échec(s)` : ''}.`);
  process.exit(echecs ? 1 : 0);
})();
