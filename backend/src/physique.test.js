// ============================================================================
// physique.test.js — archives papier (migration 038).
// Emplacements (hiérarchie, cotes, unicité, suppression d'un emplacement
// vide seulement), documents placés et journalisés, récolement (instantané,
// prêts pré-remplis, constats, clôture, PV figé), prêts et art. 35 du décret
// n° 2007-532 (original versé aux archives publiques : ne sort pas),
// description des boîtes, dates extrêmes et répertoire (migration 043).
// Exécution : npm run test:physique
// ============================================================================
const physique = require('./services/physiqueService');

let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };
const attendreErreur = async (fn) => { try { await fn(); return null; } catch (err) { return err; } };

(async () => {
  console.log('\n1. Sans base');
  ok(physique.TYPES.join('>') === 'depot>magasin>travee>tablette>boite', 'hiérarchie : dépôt, magasin, travée, tablette, boîte');
  const corps = physique.corpsRecolement({ id: 1, intitule: 'R', perimetre_libelle: 'D1', ouvert_par_nom: 'A', ouvert_at: '2026-01-01T00:00:00Z' },
    [{ cote: 'D1-B1', libelle: 'Boîte', resultat: 'present' }]);
  ok(corps.lignes[0].resultat === 'present' && corps.clos_at === null, 'contenu canonique du procès-verbal de récolement');

  if (!(process.env.DB_HOST || process.env.DATABASE_URL)) {
    console.log('\n2. Sur PostgreSQL — SAUTÉ (ni DB_HOST ni DATABASE_URL)');
  } else {
    console.log('\n2. Sur PostgreSQL');
    const db = require('./config/db');
    const roleService = require('./services/roleService');
    const loanService = require('./services/loanService');
    const s = Date.now();
    const t = (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Physique ${s}`, `physique-${s}`])).rows[0].id;
    const t2 = (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Ailleurs ${s}`, `ailleurs-${s}`])).rows[0].id;
    await roleService.provisionRoles(t);
    const utilisateur = async (role, nom) => (await db.query(
      "INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', $3, $4, $5) RETURNING id, tenant_id, role, username, full_name",
      [t, `${nom.toLowerCase()}${s}`, nom, `${nom}${s}@exemple.test`, role])).rows[0];
    const archi = await utilisateur('archiviste', 'Archi');
    const agent = await utilisateur('agent', 'Agent');

    // --- Emplacements ---------------------------------------------------------
    const depot = await physique.creer(t, { type: 'depot', code: 'D1', libelle: 'Dépôt de la mairie' }, archi);
    const magasin = await physique.creer(t, { type: 'magasin', code: 'M2', parent_id: depot.id, capacite_ml: 120 }, archi);
    const travee = await physique.creer(t, { type: 'travee', code: 'T03', parent_id: magasin.id }, archi);
    const tablette = await physique.creer(t, { type: 'tablette', code: 'E4', parent_id: travee.id }, archi);
    const boite = await physique.creer(t, { type: 'boite', code: 'B0127', parent_id: tablette.id, libelle: 'Naissances 1998' }, archi);
    const boite2 = await physique.creer(t, { type: 'boite', code: 'B0128', parent_id: tablette.id }, archi);
    ok(boite.cote === 'D1-M2-T03-E4-B0127', `cote topographique calculée (${boite.cote})`);
    ok((await attendreErreur(() => physique.creer(t, { type: 'magasin', code: 'X', parent_id: boite.id }, archi)))?.status === 400, 'un magasin ne se range pas dans une boîte');
    ok((await attendreErreur(() => physique.creer(t, { type: 'boite', code: 'B9' }, archi)))?.status === 400, 'seul un dépôt se crée à la racine');
    ok((await attendreErreur(() => physique.creer(t, { type: 'boite', code: 'b0127', parent_id: tablette.id }, archi)))?.status === 409, 'code déjà pris au même endroit : refusé');
    ok((await attendreErreur(() => physique.creer(t, { type: 'magasin', code: 'M2', parent_id: boite.id }, archi))) !== null, 'contrôle de la hiérarchie avant l\'unicité');
    ok((await attendreErreur(() => physique.creer(t2, { type: 'magasin', code: 'M9', parent_id: depot.id }, archi)))?.status === 404, 'autre organisation : emplacement introuvable');

    // --- Documents placés -------------------------------------------------------
    const doc = async (ref) => (await db.query(
      "INSERT INTO documents (tenant_id, reference_mfile, num_dossier, num_acte, nom_entreprise, annee, statut, created_by, description) VALUES ($1, $2, 'D', 'A', 'X', 1998, 'archivé', $3, $4) RETURNING id",
      [t, `${ref}-${s}`, archi.id, ref])).rows[0].id;
    const acte1 = await doc('Acte 1');
    const acte2 = await doc('Acte 2');
    const place = await physique.placer(t, acte1, { support: 'papier', emplacement_id: boite.id, cote_physique: 'Pièce 12' }, archi);
    await physique.placer(t, acte2, { support: 'papier', emplacement_id: boite.id, cote_physique: 'Pièce 13' }, archi);
    ok(place.cote_topographique === 'D1-M2-T03-E4-B0127' && place.cote_physique === 'Pièce 12', 'document papier rangé : boîte et cote');
    ok((await attendreErreur(() => physique.placer(t, acte1, { emplacement_id: magasin.id }, archi)))?.status === 400, 'un document ne se range pas directement dans un magasin');
    ok((await db.query("SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND action = 'DOCUMENT_PLACE'", [t])).rows[0].n === 2, 'rangements journalisés');
    const c = await physique.contenu(t, boite.id, archi);
    ok(c.documents.length === 2 && c.emplacement.cote === boite.cote, 'contenu de la boîte');
    ok((await attendreErreur(() => physique.supprimer(t, boite.id, archi)))?.status === 409, 'boîte non vide : suppression refusée');
    ok((await physique.supprimer(t, boite2.id, archi)).supprime === boite2.id, 'boîte vide : supprimée');

    // --- Prêts et art. 35 ---------------------------------------------------------
    const demande = async () => (await db.query(
      "INSERT INTO requests (tenant_id, id_user, description, motif, statut) VALUES ($1, $2, 'Registre des naissances 1998', 'Consultation', 'a traiter') RETURNING id", [t, agent.id])).rows[0].id;
    const v = (await db.query(
      `INSERT INTO bordereaux_versement (tenant_id, numero, intitule, destination, statut) VALUES ($1, 'BV-T-1', 'Versement', 'archives_publiques', 'brouillon') RETURNING id`, [t])).rows[0].id;
    await db.query("UPDATE bordereaux_versement SET statut = 'pris_en_charge' WHERE id = $1", [v]);
    await db.query('UPDATE documents SET verse_at = now(), verse_versement_id = $2 WHERE id = $1', [acte2, v]);
    const refus = await attendreErreur(async () => loanService.remettre(t, await demande(), archi, { nature: 'original', document_id: acte2 }));
    ok(refus?.code === 'ART35_ORIGINAL', 'original versé aux archives publiques : ne sort pas (art. 35)');
    const copie = await loanService.remettre(t, await demande(), archi, { nature: 'copie', document_id: acte2 });
    ok(copie.pret.nature === 'copie' && copie.pret.emplacement_id === boite.id, 'copie remise ; la boîte d\'origine est notée');
    const original = await loanService.remettre(t, await demande(), archi, { nature: 'original', document_id: acte1 });
    ok(original.pret.nature === 'original', 'original non versé : prêt possible');
    ok((await attendreErreur(async () => loanService.remettre(t, await demande(), archi, { nature: 'emporte' })))?.statut === 400, 'nature de prêt inconnue : refusée');
    ok((await physique.localisation(t, acte1)).pret?.nature === 'original', 'fiche : le prêt en cours est affiché');

    // --- Récolement ------------------------------------------------------------------
    const r = await physique.ouvrirRecolement(t, { emplacement_id: magasin.id }, archi);
    let d = await physique.detailRecolement(t, r.id);
    ok(d.perimetre_libelle === 'D1-M2' && d.lignes.length === 3, `instantané : 1 boîte et ses 2 documents (${d.lignes.length} lignes)`);
    ok(d.lignes.find((l) => l.document_id === acte1)?.resultat === 'en_pret', 'document en prêt : constat pré-rempli par le registre');
    ok((await attendreErreur(() => physique.clore(t, r.id, {}, archi)))?.status === 409, 'clôture refusée tant que tout n\'est pas constaté');
    const boiteLigne = d.lignes.find((l) => !l.document_id);
    const acte2Ligne = d.lignes.find((l) => l.document_id === acte2);
    ok((await attendreErreur(() => physique.constater(t, r.id, [{ ligne_id: acte2Ligne.id, resultat: 'abime' }], archi)))?.status === 400, 'dommage sans description : refusé');
    d = await physique.constater(t, r.id, [{ ligne_id: boiteLigne.id, resultat: 'present' }, { ligne_id: acte2Ligne.id, resultat: 'abime', observation: 'Tache d\'humidité, coin déchiré' }], archi);
    ok(d.bilan.a_constater === 0 && d.bilan.abime === 1, 'constats enregistrés');
    await physique.clore(t, r.id, { observations: 'Magasin humide : alerter les services techniques.' }, archi);
    const pv = await physique.procesVerbal(t, r.id);
    ok(pv.statut === 'clos' && pv.empreinte && pv.empreinte_conforme === true, 'récolement clos : procès-verbal figé, empreinte conforme');
    ok((await attendreErreur(() => db.query("UPDATE recolement_lignes SET resultat = 'present' WHERE id = $1", [acte2Ligne.id]))) !== null, 'base : un récolement clos est inaltérable');
    ok((await db.query("SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND action IN ('RECOLEMENT_OUVERT', 'RECOLEMENT_CLOS')", [t])).rows[0].n === 2, 'récolement journalisé');

    // --- Description des boîtes, dates extrêmes, « rangé par » (043) ---------------
    const boite3 = await physique.creer(t, {
      type: 'boite', code: 'B0200', parent_id: tablette.id, libelle: 'Marchés de travaux', fonds: 'PRMP',
      type_boite: "Boîte d'archives (dos 10 cm)", couleur_etiquette: 'bleu',
    }, archi);
    ok(boite3.fonds === 'PRMP' && boite3.type_boite === "Boîte d'archives (dos 10 cm)" && boite3.couleur_etiquette === 'bleu', 'boîte décrite : fonds, type de boîte, couleur d\'étiquette');
    ok((await attendreErreur(() => physique.creer(t, { type: 'boite', code: 'B0201', parent_id: tablette.id, couleur_etiquette: 'fuchsia' }, archi)))?.status === 400, 'couleur d\'étiquette hors palette : refusée');
    const magasin3 = await physique.creer(t, { type: 'magasin', code: 'M3', parent_id: depot.id, fonds: 'Comptabilité', type_boite: 'Carton', couleur_etiquette: 'rouge' }, archi);
    ok(magasin3.fonds === 'Comptabilité' && magasin3.type_boite === null && magasin3.couleur_etiquette === null, 'le fonds se porte à tout niveau ; type de boîte et couleur sont réservés aux boîtes');
    const recolore = await physique.modifier(t, boite3.id, { couleur_etiquette: 'vert' }, archi);
    ok(recolore.couleur_etiquette === 'vert' && recolore.fonds === 'PRMP' && recolore.cote === 'D1-M2-T03-E4-B0200', 'étiquette changée, le reste de la description conservé');
    const sug = await physique.suggestions(t);
    ok(sug.fonds.includes('PRMP') && sug.fonds.includes('Comptabilité') && sug.types_boite.includes('Liasse') && sug.couleurs.length === 9, 'saisie assistée : fonds déjà employés, types de boîte, palette');

    const marche = await doc('Marché');
    await physique.placer(t, marche, { support: 'papier', emplacement_id: boite3.id, cote_physique: 'Dossier 1', annee_debut: 2019, annee_fin: 2021 }, archi);
    let loc = await physique.localisation(t, marche);
    ok(loc.dates_extremes === '2019-2021' && loc.range_par_nom === 'Archi' && loc.range_at && loc.boite.fonds === 'PRMP', 'dossier rangé : dates extrêmes, et la fiche dit qui l\'a rangé et quand');
    ok((await attendreErreur(() => physique.placer(t, marche, { annee_debut: 2022, annee_fin: 2020 }, archi)))?.status === 400, 'dates extrêmes : fin avant début refusée');
    ok((await attendreErreur(() => physique.placer(t, marche, { annee_debut: 19 }, archi)))?.status === 400, 'date extrême : année sur quatre chiffres exigée');
    await physique.placer(t, marche, { annee_fin: 2022 }, agent);
    loc = await physique.localisation(t, marche);
    ok(loc.dates_extremes === '2019-2022' && loc.range_par_nom === 'Archi', 'corriger les dates ne change pas « rangé par »');
    ok(physique.datesExtremes({ annee: 1998 }) === '1998' && physique.datesExtremes({ annee_debut: 2020, annee_fin: 2020, annee: 1998 }) === '2020' && physique.datesExtremes({}) === '', 'dates extrêmes : à défaut, l\'année de la fiche');

    // --- Répertoire (instrument de recherche) -----------------------------------------
    const classeMp = (await db.query("INSERT INTO metadata_schemas (tenant_id, name, code) VALUES ($1, 'Dossier de marché public', 'MP') RETURNING id", [t])).rows[0].id;
    const champ = async (label, ordre) => (await db.query(
      "INSERT INTO metadata_fields (schema_id, name, label, type, display_order) VALUES ($1, $2, $3, 'text', $4) RETURNING id", [classeMp, label.toLowerCase(), label, ordre])).rows[0].id;
    const cSigmap = await champ('N° SIGMAP', 2);
    const cMode = await champ('Mode de passation', 1);
    await db.query('UPDATE documents SET classe_id = $2 WHERE id = $1', [marche, classeMp]);
    await db.query('INSERT INTO metadata_values (document_id, field_id, value_json) VALUES ($1, $2, $3), ($1, $4, $5)',
      [marche, cSigmap, JSON.stringify('T_DMP_2019_0412'), cMode, JSON.stringify("DAO — Dossier d'appel d'offres")]);
    const rep = await physique.repertoire(t, magasin.id, archi);
    const b200 = rep.boites.find((b) => b.cote === 'D1-M2-T03-E4-B0200');
    const b127 = rep.boites.find((b) => b.cote === 'D1-M2-T03-E4-B0127');
    ok(rep.perimetre.cote === 'D1-M2' && rep.boites.length === 2 && rep.total_dossiers === 3 && rep.masques === 0, `répertoire du magasin : 2 boîtes, 3 dossiers (${rep.boites.length}, ${rep.total_dossiers})`);
    ok(b200.fonds === 'PRMP' && b200.couleur_etiquette === 'vert' && b200.dates_extremes === '2019-2022' && b200.dossiers[0].cote === 'Dossier 1', 'boîte : fonds, étiquette, dates extrêmes tirées de son contenu');
    ok(JSON.stringify(b200.dossiers[0].details) === JSON.stringify([['Mode de passation', "DAO — Dossier d'appel d'offres", 'text'], ['N° SIGMAP', 'T_DMP_2019_0412', 'text']]) && b200.dossiers[0].classe === 'Dossier de marché public',
      'dossier : propriétés de sa classe, dans l\'ordre de la classe');
    ok(b127.dates_extremes === '1998' && b127.dossiers.length === 2 && b127.fonds === null, 'boîte sans description : dates tirées de l\'année des fiches');
    ok(physique.intitule({ description: null, nom_entreprise: 'À indexer', fichier_nom: 'scan-0042.pdf' }) === 'scan-0042.pdf'
      && physique.intitule({ description: 'MP-2019-012 — Pistes', nom_entreprise: 'X' }) === 'MP-2019-012 — Pistes' && physique.intitule({}) === 'Sans intitulé',
      'intitulé d\'un dossier : titre, sinon entreprise, sinon nom du fichier — jamais « À indexer »');
    const repBoite = await physique.repertoire(t, boite3.id, archi);
    ok(repBoite.boites.length === 1 && repBoite.perimetre.cote === 'D1-M2-T03-E4-B0200', 'répertoire d\'une seule boîte');
    await physique.modifier(t, boite3.id, { fonds: '' }, archi);
    await physique.modifier(t, magasin.id, { fonds: 'Marchés publics' }, archi);
    ok((await physique.repertoire(t, magasin.id, archi)).boites.every((b) => b.fonds === 'Marchés publics'), 'boîte sans fonds propre : celui de son magasin');
    ok((await attendreErreur(() => physique.repertoire(t2, magasin.id, archi)))?.status === 404, 'répertoire d\'une autre organisation : introuvable');

    const cx = await db.pool.connect();
    try {
      await cx.query('BEGIN');
      await cx.query("SET LOCAL docuflow.audit_override = 'on'");
      await cx.query('DELETE FROM tenants WHERE id = ANY($1)', [[t, t2]]);
      await cx.query('COMMIT');
    } catch (err) { await cx.query('ROLLBACK'); console.error('nettoyage :', err.message); } finally { cx.release(); }
    await db.pool.end();
  }
  console.log(`\n${echecs === 0 ? '✅' : '❌'} Archives papier cohérentes — ${verifs} vérifications${echecs ? `, ${echecs} échec(s)` : ''}.`);
  process.exit(echecs ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
