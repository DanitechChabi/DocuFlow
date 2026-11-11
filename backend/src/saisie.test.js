// ============================================================================
// saisie.test.js — saisie en tableau des dossiers papier.
// Lecture des cellules (nombres, dates, listes, dates extrêmes), fiche déduite
// des propriétés, contrôle de TOUTES les lignes avant la moindre création,
// doublons, boîtes désignées par leur code, fiches créées (titre de la charte,
// boîte, cote, « rangé par »), archivage à la saisie, départ de la durée de
// conservation à la clôture du dossier, cloisonnement entre organisations.
// Exécution : npm run test:saisie
// ============================================================================
const saisie = require('./services/saisieService');
const archivage = require('./services/archivageService');
const communicabilite = require('./services/communicabiliteService');

let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };
const attendreErreur = async (fn) => { try { await fn(); return null; } catch (err) { return err; } };

(async () => {
  console.log('\n1. Sans base');
  const n = saisie.lireNombre;
  ok(n('57 000 000') === 57000000 && n('1 234,5') === 1234.5 && n('57.000.000') === 57000000 && n('12 500 FCFA') === 12500,
    'nombres copiés d\'un tableur : espaces, virgule décimale, points de milliers, FCFA');
  ok(n('57.000') === 57000 && n('1.5') === 1.5 && n('57,000,000.00') === 57000000 && n('1.234,56') === 1234.56, 'séparateurs : à la française comme à l\'anglaise');
  ok(n('abc') === null && n('1e5') === null && n('') === null && n(12) === 12, 'ce qui n\'est pas un nombre n\'est pas lu');
  const d = saisie.lireDate;
  ok(d('2021-03-15') === '2021-03-15' && d('15/03/2021') === '2021-03-15' && d('15.3.2021') === '2021-03-15' && d('1er août 2020') === '2020-08-01' && d('3 févr. 2019') === '2019-02-03',
    'dates : AAAA-MM-JJ, JJ/MM/AAAA, « 1er août 2020 »');
  ok(d('31/02/2021') === null && d('15/03/21') === null && d('2021') === null, 'date impossible, année sur deux chiffres, année seule : refusées');
  const dx = saisie.lireDates;
  ok(dx('2019').debut === 2019 && dx('2019').fin === 2019 && dx('2019-2021').fin === 2021 && dx('de 2019 à 2021').debut === 2019 && dx('2019 – 2021').fin === 2021,
    'dates extrêmes : 2019, 2019-2021, « de 2019 à 2021 »');
  ok(dx('2019-21').erreur && dx('2021-2019').erreur && dx('vers 2019').erreur && dx('').debut === null, 'dates extrêmes douteuses : refusées, jamais devinées');
  const liste = { type: 'select', options_json: [{ value: 'dao', label: 'DAO — Dossier d\'appel d\'offres' }, { value: 'drp', label: 'DRP — Demande de renseignements et de prix' }, { value: 'dc', label: 'DC — Demande de cotation' }, { value: 'autre', label: 'Autre' }] };
  const v = (champ, brut) => saisie.lireValeur(champ, brut);
  ok(v(liste, 'DAO').valeur === 'dao' && v(liste, 'dao').valeur === 'dao' && v(liste, 'Demande de cotation').valeur === 'dc' && v(liste, ' autre ').valeur === 'autre' && v(liste, 'drp').valeur === 'drp',
    'liste : la valeur, le libellé, le sigle seul ou l\'intitulé seul');
  ok(v(liste, 'D').erreur && v(liste, 'Demande').erreur && v(liste, 'XYZ').erreur, 'liste : une désignation ambiguë ou inconnue est une erreur');
  ok(v({ type: 'multiselect', options_json: liste.options_json }, 'DAO ; DC').valeur.join() === 'dao,dc' && v({ type: 'multiselect', options_json: liste.options_json }, 'DAO ; ZZ').erreur,
    'liste à choix multiples : séparée par des points-virgules');
  ok(v({ type: 'boolean' }, 'oui').valeur === true && v({ type: 'boolean' }, 'Non').valeur === false && v({ type: 'boolean' }, 'x').valeur === true && v({ type: 'boolean' }, 'peut-être').erreur,
    'oui / non');
  ok(v({ type: 'text' }, '  Pistes rurales ').valeur === 'Pistes rurales' && v({ type: 'number' }, '  ').valeur === null, 'texte rogné ; cellule vide : aucune valeur');
  const colonnes = [
    { id: 1, libelle: 'Référence du dossier', type: 'text' }, { id: 2, libelle: 'Objet du marché', type: 'text' }, { id: 3, libelle: 'Attributaire', type: 'text' },
    { id: 4, libelle: 'N° de contrat', type: 'text' }, { id: 5, libelle: 'Date d\'expiration', type: 'date' }, { id: 6, libelle: 'Date de signature', type: 'date' },
  ];
  const f = saisie.ficheDe(colonnes, new Map([[1, 'AOO-012'], [2, 'Pistes'], [3, 'SOGEMA SARL'], [4, 'C-77'], [5, '2030-01-01'], [6, '2019-04-02']]), { debut: 2018, fin: 2021 });
  ok(f.nom_entreprise === 'SOGEMA SARL' && f.num_dossier === 'AOO-012' && f.num_acte === 'C-77' && f.annee === 2018 && f.date_document === '2019-04-02',
    'fiche déduite : attributaire, référence, n° de contrat, année d\'ouverture, date du document (pas l\'expiration)');
  const f2 = saisie.ficheDe(colonnes, new Map([[2, 'Pistes']]), {}, new Date('2026-05-05'));
  ok(f2.nom_entreprise === 'À indexer' && f2.num_dossier === 'À indexer' && f2.annee === 2026 && f2.date_document === null, 'fiche sans tiers ni numéro : repli « À indexer », année courante');
  const boites = [{ id: 1, code: 'B0001', cote: 'D1-M1-B0001' }, { id: 2, code: 'B0001', cote: 'D1-M2-B0001' }, { id: 3, code: 'B0002', cote: 'D1-M1-B0002' }];
  ok(saisie.trouverBoite(boites, 'b0002').boite.id === 3 && saisie.trouverBoite(boites, 'd1-m2-b0001').boite.id === 2 && /cote complète/.test(saisie.trouverBoite(boites, 'B0001').erreur)
    && saisie.trouverBoite(boites, 'B0099').inconnue === 'B0099', 'boîte désignée par son code, sa cote complète si le code est porté deux fois ; inconnue : signalée');

  // Départ de la durée de conservation : la clôture du dossier.
  ok(archivage.departDua({ date_document: null, created_at: '2026-01-10T10:00:00Z', annee_debut: 2012, annee_fin: 2014 }).depart === '2014-12-31'
    && archivage.departDua({ date_document: null, created_at: '2026-01-10T10:00:00Z', annee_debut: 2012, annee_fin: 2014 }).estime === false,
    'DUA d\'un dossier sans date : court de sa clôture (31 décembre de l\'année de fin), sans estimation');
  ok(archivage.departDua({ date_document: '2012-03-15', annee_debut: 2012, annee_fin: 2014 }).depart === '2014-12-31'
    && archivage.departDua({ date_document: '2014-03-15', annee_debut: 2014, annee_fin: 2014 }).depart === '2014-03-15', 'DUA : la clôture l\'emporte sur une date antérieure ; même année : la date du document');
  ok(archivage.departDua({ archive_at: '2026-02-01T08:00:00Z', annee_fin: 2014 }, 'archivage').depart === '2014-12-31'
    && String(archivage.departDua({ archive_at: '2026-02-01T08:00:00Z' }, 'archivage').depart).startsWith('2026-0')
    && !archivage.departDua({ archive_at: null, annee_fin: 2014 }, 'archivage').depart, 'DUA au départ de l\'archivage : un dossier clos avant d\'entrer se compte de sa clôture ; non archivé : pas de départ');
  const instruction = communicabilite.calculer({ categorie: 'judiciaire', date_document: null, created_at: '2026-01-10', annee_debut: 1958, annee_fin: 1960 }, '2026-11-01');
  ok(instruction.a_partir_du === '2020-12-31' && instruction.communicable === true
    && communicabilite.calculer({ categorie: 'judiciaire', date_document: '1990-05-02', created_at: '2026-01-10' }, '2026-11-01').a_partir_du === '2050-05-02',
    'communicabilité : le délai court de la clôture du dossier (60 ans après 1960), sinon de la date du document');

  if (!(process.env.DB_HOST || process.env.DATABASE_URL)) {
    console.log('\n2. Sur PostgreSQL — SAUTÉ (ni DB_HOST ni DATABASE_URL)');
  } else {
    console.log('\n2. Sur PostgreSQL');
    const db = require('./config/db');
    const roleService = require('./services/roleService');
    const classeService = require('./services/classeService');
    const physique = require('./services/physiqueService');
    const s = Date.now();
    const t = (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Saisie ${s}`, `saisie-${s}`])).rows[0].id;
    const t2 = (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Ailleurs ${s}`, `saisie-ailleurs-${s}`])).rows[0].id;
    await roleService.provisionRoles(t);
    await roleService.provisionRoles(t2);
    const utilisateur = async (tenant, role, nom) => (await db.query(
      "INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', $3, $4, $5) RETURNING id, tenant_id, role, username, full_name",
      [tenant, `${nom.toLowerCase()}${s}`, nom, `${nom}${s}@exemple.test`, role])).rows[0];
    const archi = await utilisateur(t, 'archiviste', 'Archi');
    const agent = await utilisateur(t, 'agent', 'Agent');
    const autre = await utilisateur(t2, 'archiviste', 'Autre');

    await classeService.installerClasses(t, ['MP', 'SMP']);
    await classeService.installerClasses(t2, ['MP']);
    await classeService.appliquerReferentiel(t, archi);
    const depot = await physique.creer(t, { type: 'depot', code: 'D1' }, archi);
    const magasin = await physique.creer(t, { type: 'magasin', code: 'M1', parent_id: depot.id }, archi);
    const travee = await physique.creer(t, { type: 'travee', code: 'T1', parent_id: magasin.id }, archi);
    const tablette = await physique.creer(t, { type: 'tablette', code: 'E1', parent_id: travee.id }, archi);
    const tablette2 = await physique.creer(t, { type: 'tablette', code: 'E2', parent_id: travee.id }, archi);
    const b1 = await physique.creer(t, { type: 'boite', code: 'B0001', parent_id: tablette.id, fonds: 'PRMP' }, archi);
    const b2 = await physique.creer(t, { type: 'boite', code: 'B0002', parent_id: tablette.id }, archi);
    await physique.creer(t, { type: 'boite', code: 'B0001', parent_id: tablette2.id }, archi);
    const depot2 = await physique.creer(t2, { type: 'depot', code: 'D1' }, autre);
    const tab2 = await physique.creer(t2, { type: 'tablette', code: 'E1', parent_id: (await physique.creer(t2, { type: 'travee', code: 'T1', parent_id: (await physique.creer(t2, { type: 'magasin', code: 'M1', parent_id: depot2.id }, autre)).id }, autre)).id }, autre);
    const boiteAilleurs = await physique.creer(t2, { type: 'boite', code: 'B0900', parent_id: tab2.id }, autre);

    // --- Modèle de la grille ---------------------------------------------------
    const m = await saisie.modele(t, archi);
    const mp = m.classes.find((c) => c.code === 'MP');
    const smp = m.classes.find((c) => c.code === 'SMP');
    const col = (classe, libelle) => classe.colonnes.find((c) => c.libelle === libelle).id;
    ok(mp && mp.colonnes.length === 9 && mp.colonnes[0].libelle === 'Référence du dossier' && mp.colonnes[0].obligatoire && mp.colonnes.find((c) => c.libelle === 'Mode de passation').choix.length >= 6,
      'modèle : la classe « Dossier de marché public » et ses 9 colonnes, listes comprises');
    ok(m.boites.length === 5 && m.boites.some((b) => b.cote === 'D1-M1-T1-E1-B0001' && b.fonds === 'PRMP') && m.peut_archiver === true && m.limite === 200,
      'modèle : boîtes et tablettes de l\'organisation avec leur cote');
    ok((await saisie.modele(t, agent)).peut_archiver === false && !(await saisie.modele(t2, autre)).boites.some((b) => b.cote.includes('B0001')), 'modèle : droits de l\'utilisateur ; aucune boîte d\'une autre organisation');

    const ligne = (ref, objet, plus = {}, hors = {}) => ({
      valeurs: { [col(mp, 'Référence du dossier')]: ref, [col(mp, 'Objet du marché')]: objet, ...plus }, ...hors,
    });
    const nbDocs = async () => (await db.query('SELECT count(*)::int AS n FROM documents WHERE tenant_id = $1', [t])).rows[0].n;

    // --- Contrôle : tout ou rien -------------------------------------------------
    const fautif = {
      classe_id: mp.id, emplacement_id: b1.id,
      lignes: [
        ligne('AOO-001', 'Pistes rurales', { [col(mp, 'Montant TTC')]: '57 000 000' }, { dates: '2019-2021', cote: '1' }),
        ligne('', 'Sans référence', { [col(mp, 'Montant TTC')]: 'beaucoup', [col(mp, 'Mode de passation')]: 'Gré à gré' }, { dates: '2019-21' }),
        {},
        ligne('AOO-003', 'Forages', {}, { boite: 'B0099', cote: 'x'.repeat(61) }),
      ],
    };
    const refus = await attendreErreur(() => saisie.creerLot(t, fautif, archi));
    const cellules = (refus?.details?.erreurs || []).map((e) => `${e.ligne}:${e.colonne}`).sort().join(' ');
    ok(refus?.status === 422 && refus.code === 'LIGNES_INVALIDES' && (await nbDocs()) === 0, 'une cellule fautive : rien n\'est créé, pas même les lignes justes');
    ok(cellules === [`1:c${col(mp, 'Montant TTC')}`, `1:c${col(mp, 'Mode de passation')}`, `1:c${col(mp, 'Référence du dossier')}`, '1:dates', '3:boite', '3:cote'].sort().join(' '),
      `chaque erreur désigne sa ligne et sa colonne ; la ligne vide garde son rang (${cellules})`);
    ok(refus.details.boites_inconnues.join() === 'B0099', 'boîtes inconnues : listées, pour les créer d\'un geste');
    ok((await attendreErreur(() => saisie.creerLot(t, { classe_id: mp.id, lignes: [{}, { valeurs: {} }] }, archi)))?.status === 400, 'aucune ligne remplie : refusé');
    ok((await attendreErreur(() => saisie.creerLot(t, { classe_id: 999999999, lignes: [ligne('A', 'B')] }, archi)))?.status === 400
      && (await attendreErreur(() => saisie.creerLot(t2, { classe_id: mp.id, lignes: [ligne('A', 'B')] }, autre)))?.status === 400, 'classe inconnue ou d\'une autre organisation : refusée');
    ok((await attendreErreur(() => saisie.creerLot(t, { classe_id: mp.id, emplacement_id: boiteAilleurs.id, lignes: [ligne('A', 'B')] }, archi)))?.status === 400
      && (await attendreErreur(() => saisie.creerLot(t, { classe_id: mp.id, emplacement_id: magasin.id, lignes: [ligne('A', 'B')] }, archi)))?.status === 400,
      'boîte d\'une autre organisation, ou magasin pris pour une boîte : refusés');
    ok((await attendreErreur(() => saisie.creerLot(t, { classe_id: mp.id, lignes: Array.from({ length: 201 }, (_, i) => ligne(`R-${i}`, 'O')) }, archi)))?.status === 400, 'plus de 200 lignes : à enregistrer en plusieurs fois');
    ok((await attendreErreur(() => saisie.creerLot(t, { classe_id: mp.id, archiver: true, lignes: [ligne('A', 'B')] }, agent)))?.status === 403, 'archiver à la saisie sans la permission d\'archiver : refusé');

    // --- Création ------------------------------------------------------------------
    const lot = await saisie.creerLot(t, {
      classe_id: mp.id, emplacement_id: b1.id,
      lignes: [
        ligne('AOO-001', 'Pistes rurales', {
          [col(mp, 'Montant TTC')]: '57 000 000', [col(mp, 'Mode de passation')]: 'DAO', [col(mp, 'Type de marché')]: 'travaux',
          [col(mp, 'Attributaire')]: 'ENTREPRISE FICTIVE BTP', [col(mp, 'N° de contrat')]: 'C-2019-044',
        }, { dates: '2019-2021', cote: '1' }),
        {},
        ligne('DRP-014', 'Fournitures de bureau', {}, { dates: '2020', cote: '2', boite: 'B0002' }),
      ],
    }, archi, { ip: '127.0.0.1' });
    ok(lot.crees.length === 2 && lot.crees[0].ligne === 0 && lot.crees[1].ligne === 2 && !lot.interrompu, 'deux dossiers créés ; la ligne vide est ignorée, les rangs sont ceux de la grille');
    const fiche = async (id) => (await db.query('SELECT * FROM documents WHERE id = $1 AND tenant_id = $2', [id, t])).rows[0];
    const d1 = await fiche(lot.crees[0].id);
    const d2 = await fiche(lot.crees[1].id);
    ok(d1.description === 'MP-2019-AOO-001 — Pistes rurales' && lot.crees[0].titre === d1.description && d1.type_document === 'Dossier de marché public' && d1.reference_mfile === `DOC-${t}-${d1.id}`,
      `titre calculé par la charte de nommage, à l'année d'ouverture (${d1.description})`);
    ok(d1.support === 'papier' && d1.emplacement_id === b1.id && d1.cote_physique === '1' && d1.annee_debut === 2019 && d1.annee_fin === 2021 && d1.range_par === archi.id && d1.range_par_nom === 'Archi' && d1.range_at,
      'dossier papier rangé : boîte, cote dans la boîte, dates extrêmes, « rangé par »');
    ok(d1.nom_entreprise === 'ENTREPRISE FICTIVE BTP' && d1.num_dossier === 'AOO-001' && d1.num_acte === 'C-2019-044' && d1.annee === 2019 && d1.statut === 'disponible' && d1.created_by === archi.id,
      'fiche : attributaire, référence et n° de contrat repris des propriétés');
    ok(d2.emplacement_id === b2.id && lot.crees[1].boite === 'D1-M1-T1-E1-B0002' && d2.nom_entreprise === 'À indexer', 'boîte de la ligne (désignée par son code) plutôt que celle du lot');
    const valeurs = (await db.query('SELECT field_id, value_json FROM metadata_values WHERE document_id = $1', [d1.id])).rows;
    const val = (libelle) => valeurs.find((x) => x.field_id === col(mp, libelle))?.value_json;
    ok(val('Montant TTC') === 57000000 && val('Mode de passation') === mp.colonnes.find((c) => c.libelle === 'Mode de passation').choix.find((o) => o.label.startsWith('DAO')).value && valeurs.length === 7,
      'propriétés enregistrées dans leur type : le montant est un nombre, « DAO » est le choix de la liste');
    const histo = (await db.query('SELECT action FROM document_history WHERE document_id = $1 ORDER BY id', [d1.id])).rows.map((r) => r.action);
    const journal = (await db.query("SELECT action FROM audit_logs WHERE tenant_id = $1 AND action IN ('DOCUMENT_SAISI', 'DOCUMENT_PLACE', 'SAISIE_TABLEAU')", [t])).rows.map((r) => r.action);
    ok(histo[0] === 'Saisie en tableau' && histo.some((a) => a.startsWith('Rangé en D1-M1-T1-E1-B0001')) && journal.filter((a) => a === 'DOCUMENT_SAISI').length === 2 && journal.includes('SAISIE_TABLEAU'),
      'historique du dossier et journal d\'audit : saisie, rangement, lot');
    const rep = await physique.repertoire(t, b1.id, archi);
    ok(rep.boites[0].dossiers.length === 1 && rep.boites[0].dossiers[0].dates_extremes === '2019-2021', 'le répertoire de la boîte décrit aussitôt le dossier saisi');

    // --- Doublons --------------------------------------------------------------------
    const redite = { classe_id: mp.id, emplacement_id: b1.id, lignes: [ligne('aoo-001', 'pistes rurales '), ligne('NEUF-1', 'Inédit'), ligne('NEUF-1', 'Inédit')] };
    const dbl = await attendreErreur(() => saisie.creerLot(t, redite, archi));
    ok(dbl?.status === 409 && dbl.code === 'DOUBLONS' && dbl.details.doublons.length === 2 && dbl.details.doublons[0].ligne === 0 && dbl.details.doublons[0].document_id === d1.id
      && dbl.details.doublons[1].ligne === 2 && (await nbDocs()) === 2, 'doublons : dossier déjà saisi (casse et espaces ignorés) et ligne répétée — rien n\'est créé sans accord');
    const force = await saisie.creerLot(t, { ...redite, accepter_doublons: true }, archi);
    ok(force.crees.length === 3 && (await nbDocs()) === 5, 'doublons acceptés : les lignes sont enregistrées');

    // --- Conservation : la clôture du dossier ------------------------------------------
    const lotClos = await saisie.creerLot(t, {
      classe_id: mp.id, emplacement_id: b2.id, archiver: true,
      lignes: [ligne('AOO-2012-07', 'Marché ancien', {}, { dates: '2012-2014' })],
    }, archi);
    const clos = await fiche(lotClos.crees[0].id);
    const echeance = await archivage.echeanceDocument(t, clos.id);
    ok(clos.statut === 'archivé' && clos.archive_at && echeance.depart === '2014-12-31' && echeance.echeance === '2024-12-31' && echeance.echu === true,
      `dossier clos archivé à la saisie : sa durée de conservation court de 2014, pas du jour de la saisie (échéance ${echeance.echeance})`);
    const lotSmp = await saisie.creerLot(t, {
      classe_id: smp.id, emplacement_id: b2.id,
      lignes: [
        { valeurs: { [col(smp, 'Référence du dossier')]: 'AOO-001', [col(smp, 'Soumissionnaire')]: 'SOCIÉTÉ FICTIVE A', [col(smp, 'Date de soumission')]: '15/03/2019', [col(smp, 'Montant')]: '12.500.000' }, dates: '2019-2020' },
        { valeurs: { [col(smp, 'Référence du dossier')]: 'AOO-001', [col(smp, 'Soumissionnaire')]: 'SOCIÉTÉ FICTIVE B', [col(smp, 'Date de soumission')]: '2019-03-16' } },
      ],
    }, archi);
    const [o1, o2] = await Promise.all(lotSmp.crees.map((c) => fiche(c.id)));
    const [e1, e2] = await Promise.all([archivage.echeanceDocument(t, o1.id), archivage.echeanceDocument(t, o2.id)]);
    ok(o1.nom_entreprise === 'SOCIÉTÉ FICTIVE A' && String(o1.date_document.getFullYear()) === '2019' && e1.depart === '2020-12-31' && e2.depart === '2019-03-16' && e1.depart_estime === false,
      'offres : la date de soumission date le document ; des dates extrêmes plus tardives repoussent le départ à la clôture');
    ok(o1.description === 'SMP-2019-AOO-001 — SOCIÉTÉ FICTIVE A', `charte de nommage d'une autre classe (${o1.description})`);

    // --- Propriétés communes obligatoires ----------------------------------------------
    const commun = (await db.query("INSERT INTO metadata_schemas (tenant_id, name, is_default) VALUES ($1, 'Document standard', true) RETURNING id", [t])).rows[0].id;
    const niveau = (await db.query(
      `INSERT INTO metadata_fields (schema_id, name, label, type, required, options_json, display_order)
       VALUES ($1, 'confidentialite', 'Niveau de confidentialité', 'select', true, $2, 1) RETURNING id`,
      [commun, JSON.stringify([{ value: 'public', label: 'Public' }, { value: 'interne', label: 'Interne' }])])).rows[0].id;
    await db.query("INSERT INTO metadata_fields (schema_id, name, label, type, required, display_order) VALUES ($1, 'responsable', 'Responsable', 'user', true, 2)", [commun]);
    const m2 = await saisie.modele(t, archi);
    ok(m2.communes.length === 1 && m2.communes[0].libelle === 'Niveau de confidentialité' && m2.communes[0].obligatoire && m2.communes[0].commune,
      'propriétés communes : celles que la grille sait saisir (une propriété « utilisateur » n\'y figure pas)');
    const sansNiveau = await attendreErreur(() => saisie.creerLot(t, { classe_id: mp.id, lignes: [ligne('COM-1', 'Commune manquante')] }, archi));
    ok(sansNiveau?.status === 422 && sansNiveau.details.erreurs.length === 1 && sansNiveau.details.erreurs[0].colonne === `c${niveau}`, 'propriété commune obligatoire laissée vide : refusée, comme au poste d\'indexation');
    const avecNiveau = await saisie.creerLot(t, { classe_id: mp.id, lignes: [ligne('COM-1', 'Commune fournie', { [niveau]: 'Interne' })] }, archi);
    ok((await db.query('SELECT value_json FROM metadata_values WHERE document_id = $1 AND field_id = $2', [avecNiveau.crees[0].id, niveau])).rows[0]?.value_json === 'interne',
      'propriété commune enregistrée avec le dossier');

    const cx = await db.pool.connect();
    try {
      await cx.query('BEGIN');
      await cx.query("SET LOCAL docuflow.audit_override = 'on'");
      await cx.query('DELETE FROM tenants WHERE id = ANY($1)', [[t, t2]]);
      await cx.query('COMMIT');
    } catch (err) { await cx.query('ROLLBACK'); console.error('nettoyage :', err.message); } finally { cx.release(); }
    await db.pool.end();
  }
  console.log(`\n${echecs === 0 ? '✅' : '❌'} Saisie en tableau cohérente — ${verifs} vérifications${echecs ? `, ${echecs} échec(s)` : ''}.`);
  process.exit(echecs ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
