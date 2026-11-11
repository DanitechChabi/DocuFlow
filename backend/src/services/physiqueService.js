// ============================================================================
// physiqueService — archives papier (migration 038) : emplacements et cotes
// topographiques, documents placés, campagnes de récolement.
//
//   EMPLACEMENTS  dépôt → magasin → travée → tablette → boîte ; un niveau
//                 s'inscrit toujours plus bas que son parent. La cote d'un
//                 emplacement est la suite des codes depuis le dépôt
//                 (D1-M2-T03-E4-B0127). Un emplacement ne se supprime que vide.
//   DOCUMENTS     support (numérique, papier, hybride), boîte, cote dans la
//                 boîte, dates extrêmes ; tout déplacement est journalisé et
//                 la fiche dit qui a rangé le dossier, et quand.
//   DESCRIPTION   (043) une boîte porte son fonds (service producteur), son
//                 type et la couleur de son étiquette, comme sur un bordereau
//                 de traitement. Le RÉPERTOIRE d'un périmètre — l'instrument
//                 de recherche — se tire de ces descriptions.
//   RÉCOLEMENT    instantané à l'ouverture (boîtes et documents attendus du
//                 périmètre, prêts en cours notés « en prêt »), constats ligne
//                 à ligne, clôture quand tout est constaté : procès-verbal figé
//                 par son empreinte.
// ============================================================================
const db = require('../config/db');
const aclService = require('./aclService');
const integrite = require('./integriteService');

const TYPES = ['depot', 'magasin', 'travee', 'tablette', 'boite'];
const LIBELLES_TYPE = { depot: 'Dépôt', magasin: 'Magasin', travee: 'Travée', tablette: 'Tablette', boite: 'Boîte' };
const SUPPORTS = ['numerique', 'papier', 'hybride'];
const COULEURS = ['blanc', 'jaune', 'vert', 'bleu', 'rouge', 'rose', 'orange', 'violet', 'gris'];
const TYPES_BOITE = ["Boîte d'archives (dos 10 cm)", "Boîte d'archives (dos 8 cm)", 'Boîte à pans coupés', 'Carton', 'Chemise à sangle', 'Liasse', 'Registre'];
const RESULTATS = ['present', 'absent', 'deplace', 'abime', 'en_pret'];
const LIBELLES_RESULTAT = { present: 'Présent', absent: 'Absent', deplace: 'Déplacé', abime: 'Abîmé', en_pret: 'En prêt' };

const erreur = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

async function journaliser(run, tenantId, user, action, objectType, objectId, details) {
  const qui = await integrite.identite(user);
  await run.query(
    `INSERT INTO audit_logs (tenant_id, actor_id, actor_username, action, object_type, object_id, details_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [tenantId, qui.id, qui.username, action, objectType, objectId, JSON.stringify(details || {})]);
  return qui;
}

// ---------------------------------------------------------------- emplacements

/** Tous les emplacements de l'organisation, avec leur cote et leur contenu. */
async function lister(tenantId) {
  const { rows } = await db.query(
    `WITH RECURSIVE arbre AS (
       SELECT e.id, e.parent_id, e.type, e.code, e.libelle, e.capacite_ml, e.observations, e.fonds, e.type_boite, e.couleur_etiquette,
              e.code::text AS cote, 0 AS profondeur
         FROM emplacements e WHERE e.tenant_id = $1 AND e.parent_id IS NULL
       UNION ALL
       SELECT e.id, e.parent_id, e.type, e.code, e.libelle, e.capacite_ml, e.observations, e.fonds, e.type_boite, e.couleur_etiquette,
              a.cote || '-' || e.code, a.profondeur + 1
         FROM emplacements e JOIN arbre a ON e.parent_id = a.id WHERE e.tenant_id = $1
     )
     SELECT a.*, (SELECT count(*)::int FROM documents d WHERE d.emplacement_id = a.id AND d.tenant_id = $1 AND d.elimine_at IS NULL) AS nb_documents,
            (SELECT count(*)::int FROM emplacements c WHERE c.parent_id = a.id) AS nb_enfants
       FROM arbre a ORDER BY a.cote`, [tenantId]);
  return rows.map((r) => ({ ...r, capacite_ml: r.capacite_ml === null ? null : Number(r.capacite_ml) }));
}

async function charger(run, tenantId, id) {
  const { rows } = await run.query('SELECT * FROM emplacements WHERE id = $1 AND tenant_id = $2', [Number(id), tenantId]);
  if (!rows[0]) throw erreur(404, 'Emplacement introuvable.');
  return rows[0];
}

/** Cote topographique d'un emplacement (codes depuis le dépôt). */
async function coteDe(run, tenantId, id) {
  if (!id) return null;
  const { rows } = await run.query(
    `WITH RECURSIVE montee AS (
       SELECT id, parent_id, code, 0 AS n FROM emplacements WHERE id = $1 AND tenant_id = $2
       UNION ALL
       SELECT e.id, e.parent_id, e.code, m.n + 1 FROM emplacements e JOIN montee m ON e.id = m.parent_id
     ) SELECT string_agg(code, '-' ORDER BY n DESC) AS cote FROM montee`, [Number(id), tenantId]);
  return rows[0]?.cote || null;
}

/**
 * Description d'un emplacement lue dans la saisie (043). Le type de boîte et la
 * couleur d'étiquette n'ont de sens que pour une boîte ; le fonds peut se
 * porter à tout niveau (un magasin réservé à un service). `actuel` : valeurs
 * conservées quand la saisie ne les mentionne pas.
 */
function lireDescription(corps, type, actuel = {}) {
  const texte = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max) || null;
  const fonds = corps.fonds === undefined ? (actuel.fonds ?? null) : texte(corps.fonds, 150);
  let typeBoite = corps.type_boite === undefined ? (actuel.type_boite ?? null) : texte(corps.type_boite, 60);
  let couleur = corps.couleur_etiquette === undefined ? (actuel.couleur_etiquette ?? null) : (corps.couleur_etiquette || null);
  if (couleur !== null && !COULEURS.includes(couleur)) throw erreur(400, `Couleur d'étiquette inconnue (attendu : ${COULEURS.join(', ')}).`);
  if (type !== 'boite') { typeBoite = null; couleur = null; }
  return { fonds, type_boite: typeBoite, couleur_etiquette: couleur };
}

function validerCode(code) {
  const c = String(code || '').trim();
  if (!c) throw erreur(400, 'Le code est obligatoire (ex. M2, T03, B0127).');
  if (!/^[A-Za-z0-9._/]{1,20}$/.test(c)) throw erreur(400, 'Code : lettres, chiffres, point, barre ou tiret bas, 20 caractères au plus.');
  return c;
}

async function creer(tenantId, corps = {}, user) {
  const type = corps.type;
  if (!TYPES.includes(type)) throw erreur(400, 'Type attendu : dépôt, magasin, travée, tablette ou boîte.');
  const code = validerCode(corps.code);
  const parentId = corps.parent_id ? Number(corps.parent_id) : null;
  if (parentId) {
    const parent = await charger(db, tenantId, parentId);
    if (TYPES.indexOf(type) <= TYPES.indexOf(parent.type)) {
      throw erreur(400, `Une ${LIBELLES_TYPE[type].toLowerCase()} ne se range pas dans un(e) ${LIBELLES_TYPE[parent.type].toLowerCase()}.`);
    }
  } else if (type !== 'depot') {
    throw erreur(400, 'Seul un dépôt se crée à la racine : choisissez son emplacement parent.');
  }
  const capacite = corps.capacite_ml === undefined || corps.capacite_ml === null || corps.capacite_ml === '' ? null : Number(corps.capacite_ml);
  if (capacite !== null && (!Number.isFinite(capacite) || capacite < 0 || capacite > 100000)) throw erreur(400, 'Capacité en mètres linéaires invalide.');
  const d = lireDescription(corps, type);
  try {
    const { rows } = await db.query(
      `INSERT INTO emplacements (tenant_id, parent_id, type, code, libelle, capacite_ml, observations, fonds, type_boite, couleur_etiquette)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [tenantId, parentId, type, code, String(corps.libelle || '').trim().slice(0, 150) || null, capacite,
        String(corps.observations || '').trim().slice(0, 2000) || null, d.fonds, d.type_boite, d.couleur_etiquette]);
    await journaliser(db, tenantId, user, 'EMPLACEMENT_CREE', 'emplacement', rows[0].id, { type, cote: await coteDe(db, tenantId, rows[0].id) });
    return { ...rows[0], cote: await coteDe(db, tenantId, rows[0].id) };
  } catch (err) {
    if (err.code === '23505') throw erreur(409, `Le code « ${code} » existe déjà à cet endroit.`);
    throw err;
  }
}

async function modifier(tenantId, id, corps = {}, user) {
  const e = await charger(db, tenantId, id);
  const code = corps.code === undefined ? e.code : validerCode(corps.code);
  const libelle = corps.libelle === undefined ? e.libelle : (String(corps.libelle || '').trim().slice(0, 150) || null);
  const capacite = corps.capacite_ml === undefined ? e.capacite_ml : (corps.capacite_ml === null || corps.capacite_ml === '' ? null : Number(corps.capacite_ml));
  const d = lireDescription(corps, e.type, e);
  try {
    const { rows } = await db.query(
      `UPDATE emplacements SET code = $3, libelle = $4, capacite_ml = $5, fonds = $6, type_boite = $7, couleur_etiquette = $8, updated_at = now()
        WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [e.id, tenantId, code, libelle, capacite, d.fonds, d.type_boite, d.couleur_etiquette]);
    if (code !== e.code) await journaliser(db, tenantId, user, 'EMPLACEMENT_RECOTE', 'emplacement', e.id, { avant: e.code, apres: code });
    return { ...rows[0], cote: await coteDe(db, tenantId, e.id) };
  } catch (err) {
    if (err.code === '23505') throw erreur(409, `Le code « ${code} » existe déjà à cet endroit.`);
    throw err;
  }
}

async function supprimer(tenantId, id, user) {
  const e = await charger(db, tenantId, id);
  const c = await db.query(
    `SELECT (SELECT count(*) FROM emplacements WHERE parent_id = $1)::int AS enfants,
            (SELECT count(*) FROM documents WHERE emplacement_id = $1 AND elimine_at IS NULL)::int AS documents`, [e.id]);
  if (c.rows[0].enfants || c.rows[0].documents) {
    throw erreur(409, `Emplacement non vide (${c.rows[0].enfants} sous-emplacement(s), ${c.rows[0].documents} document(s)) : videz-le d'abord.`);
  }
  const cote = await coteDe(db, tenantId, e.id);
  await db.query('DELETE FROM emplacements WHERE id = $1 AND tenant_id = $2', [e.id, tenantId]);
  await journaliser(db, tenantId, user, 'EMPLACEMENT_SUPPRIME', 'emplacement', e.id, { cote });
  return { supprime: e.id };
}

/** Documents rangés dans un emplacement (bornés au périmètre de l'utilisateur). */
async function contenu(tenantId, id, user) {
  const e = await charger(db, tenantId, id);
  const { lisibles } = await aclService.dossiersAccessibles(tenantId, user.id);
  const { rows } = await db.query(
    `SELECT d.id, d.reference_mfile, d.description, d.nom_entreprise, d.cote_physique, d.support, d.statut, d.dossier_id,
            d.annee, d.annee_debut, d.annee_fin, ${SQL_FICHIER},
            EXISTS (SELECT 1 FROM request_loans l WHERE l.document_id = d.id AND l.retourne_at IS NULL) AS en_pret
       FROM documents d WHERE d.emplacement_id = $1 AND d.tenant_id = $2 AND d.elimine_at IS NULL AND d.deleted_at IS NULL
      ORDER BY d.cote_physique NULLS LAST, d.id`, [e.id, tenantId]);
  const visibles = rows.filter((r) => r.dossier_id === null || lisibles.has(Number(r.dossier_id)))
    .map((r) => ({ ...r, intitule: intitule(r), dates_extremes: datesExtremes(r) }));
  return { emplacement: { ...e, cote: await coteDe(db, tenantId, e.id) }, documents: visibles, masques: rows.length - visibles.length };
}

/**
 * Intitulé d'un dossier pour un répertoire : sa description (le titre calculé
 * par la charte de nommage), sinon l'entreprise, sinon le nom de son fichier.
 * « À indexer » est le repli des versements en masse, pas un intitulé.
 */
function intitule(d) {
  const utile = (v) => (v && String(v).trim() !== 'À indexer' ? String(v).trim() : '');
  return utile(d.description) || utile(d.nom_entreprise) || utile(d.fichier_nom) || 'Sans intitulé';
}
const SQL_FICHIER = '(SELECT df.original_name FROM document_files df WHERE df.document_id = d.id ORDER BY df.version DESC LIMIT 1) AS fichier_nom';

/** Dates extrêmes lisibles : « 2019-2021 », « 2019 », ou l'année de la fiche. */
function datesExtremes(d) {
  const debut = d.annee_debut || d.annee_fin || null;
  const fin = d.annee_fin || d.annee_debut || null;
  if (!debut) return d.annee ? String(d.annee) : '';
  return debut === fin ? String(debut) : `${debut}-${fin}`;
}

/** Dates extrêmes saisies (années) ; `actuel` quand la saisie ne les mentionne pas. */
function lireDatesExtremes(corps, actuel = {}) {
  const annee = (v, nom) => {
    if (v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1000 || n > 2200) throw erreur(400, `${nom} : une année sur quatre chiffres est attendue.`);
    return n;
  };
  const debut = corps.annee_debut === undefined ? (actuel.annee_debut ?? null) : annee(corps.annee_debut, 'Date extrême de début');
  const fin = corps.annee_fin === undefined ? (actuel.annee_fin ?? null) : annee(corps.annee_fin, 'Date extrême de fin');
  if (debut !== null && fin !== null && fin < debut) throw erreur(400, 'Dates extrêmes : la fin précède le début.');
  return [debut, fin];
}

/**
 * Place un document : support, boîte, cote dans la boîte, dates extrêmes.
 * L'accès en écriture au document est vérifié par le contrôleur.
 */
async function placer(tenantId, documentId, corps = {}, user) {
  const { rows } = await db.query('SELECT id, support, emplacement_id, cote_physique, annee_debut, annee_fin FROM documents WHERE id = $1 AND tenant_id = $2', [Number(documentId), tenantId]);
  const d = rows[0];
  if (!d) throw erreur(404, 'Document introuvable.');
  const support = corps.support === undefined ? d.support : corps.support;
  if (!SUPPORTS.includes(support)) throw erreur(400, 'Support attendu : numérique, papier ou hybride.');
  let emplacementId = corps.emplacement_id === undefined ? d.emplacement_id : (corps.emplacement_id ? Number(corps.emplacement_id) : null);
  if (emplacementId) {
    const e = await charger(db, tenantId, emplacementId);
    if (!['boite', 'tablette'].includes(e.type)) throw erreur(400, 'Un document se range dans une boîte (ou directement sur une tablette).');
  }
  if (support === 'numerique') emplacementId = null;
  const cote = corps.cote_physique === undefined ? d.cote_physique : (String(corps.cote_physique || '').trim().slice(0, 60) || null);
  const [debut, fin] = lireDatesExtremes(corps, d);
  const deplace = (d.emplacement_id || null) !== (emplacementId || null);
  const qui = deplace && emplacementId ? await integrite.identite(user) : null;
  await db.query(
    `UPDATE documents SET support = $3, emplacement_id = $4, cote_physique = $5, annee_debut = $6, annee_fin = $7,
            range_par = CASE WHEN $8 THEN $9::int ELSE range_par END,
            range_par_nom = CASE WHEN $8 THEN $10 ELSE range_par_nom END,
            range_at = CASE WHEN $8 THEN (CASE WHEN $9::int IS NULL THEN NULL ELSE now() END) ELSE range_at END,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND tenant_id = $2`,
    [d.id, tenantId, support, emplacementId, support === 'numerique' ? null : cote, debut, fin, deplace, qui?.id ?? null, qui?.nom ?? null]);
  const avant = d.emplacement_id ? await coteDe(db, tenantId, d.emplacement_id) : null;
  const apres = emplacementId ? await coteDe(db, tenantId, emplacementId) : null;
  if (avant !== apres || d.support !== support || d.cote_physique !== cote) {
    await journaliser(db, tenantId, user, 'DOCUMENT_PLACE', 'document', d.id, { support, avant, apres, cote_physique: cote });
    await require('./documentIndexService').logHistory(tenantId, d.id, user.id,
      apres ? `Rangé en ${apres}${cote ? ` (${cote})` : ''}` : `Support : ${support}`, null, null, avant ? `Auparavant en ${avant}` : null);
  }
  return {
    support, emplacement_id: emplacementId, cote_topographique: apres, cote_physique: support === 'numerique' ? null : cote,
    annee_debut: debut, annee_fin: fin,
  };
}

/** Localisation d'un document (fiche). */
async function localisation(tenantId, documentId) {
  const { rows } = await db.query(
    `SELECT d.support, d.emplacement_id, d.cote_physique, d.annee, d.annee_debut, d.annee_fin, d.range_par_nom, d.range_at,
            (SELECT json_build_object('fonds', e.fonds, 'type_boite', e.type_boite, 'couleur_etiquette', e.couleur_etiquette, 'libelle', e.libelle)
               FROM emplacements e WHERE e.id = d.emplacement_id) AS boite,
            (SELECT json_build_object('nature', l.nature, 'remis_at', l.remis_at, 'retour_prevu', l.date_retour_prevue, 'emprunteur', u.full_name)
               FROM request_loans l LEFT JOIN users u ON u.id = l.emprunteur_id
              WHERE l.document_id = d.id AND l.retourne_at IS NULL ORDER BY l.remis_at DESC LIMIT 1) AS pret
       FROM documents d WHERE d.id = $1 AND d.tenant_id = $2`, [Number(documentId), tenantId]);
  if (!rows[0]) return null;
  return {
    ...rows[0], dates_extremes: datesExtremes(rows[0]),
    cote_topographique: rows[0].emplacement_id ? await coteDe(db, tenantId, rows[0].emplacement_id) : null,
  };
}

/** Fonds et types de boîte déjà employés par l'organisation (saisie assistée). */
async function suggestions(tenantId) {
  const [fonds, types, services] = await Promise.all([
    db.query("SELECT DISTINCT fonds AS v FROM emplacements WHERE tenant_id = $1 AND fonds IS NOT NULL ORDER BY 1", [tenantId]),
    db.query("SELECT DISTINCT type_boite AS v FROM emplacements WHERE tenant_id = $1 AND type_boite IS NOT NULL ORDER BY 1", [tenantId]),
    db.query('SELECT name AS v FROM sections WHERE tenant_id = $1 ORDER BY 1', [tenantId]).catch(() => ({ rows: [] })),
  ]);
  const uniques = (l) => [...new Map(l.map((v) => [v.toLowerCase(), v])).values()];
  return {
    fonds: uniques([...fonds.rows.map((r) => r.v), ...services.rows.map((r) => r.v)]),
    types_boite: uniques([...types.rows.map((r) => r.v), ...TYPES_BOITE]),
    couleurs: COULEURS,
  };
}

/**
 * Répertoire d'un périmètre (dépôt, magasin, travée, tablette ou boîte) :
 * l'instrument de recherche. Chaque boîte avec sa description (fonds, type,
 * étiquette, dates extrêmes tirées de son contenu) et ses dossiers (cote,
 * analyse, dates extrêmes, propriétés de la classe). Les dossiers hors du
 * périmètre de lecture de l'utilisateur sont comptés, pas décrits.
 */
async function repertoire(tenantId, id, user) {
  const racine = await charger(db, tenantId, id);
  const coteRacine = await coteDe(db, tenantId, racine.id);
  const { rows: noeuds } = await db.query(
    `WITH RECURSIVE arbre AS (
       SELECT e.id, e.parent_id, e.type, e.code, e.libelle, e.fonds, e.type_boite, e.couleur_etiquette, $3::text AS cote
         FROM emplacements e WHERE e.id = $1 AND e.tenant_id = $2
       UNION ALL
       SELECT e.id, e.parent_id, e.type, e.code, e.libelle, e.fonds, e.type_boite, e.couleur_etiquette, a.cote || '-' || e.code
         FROM emplacements e JOIN arbre a ON e.parent_id = a.id WHERE e.tenant_id = $2
     ) SELECT * FROM arbre ORDER BY cote`, [racine.id, tenantId, coteRacine]);
  const ids = noeuds.map((n) => n.id);
  const { lisibles } = await aclService.dossiersAccessibles(tenantId, user.id);
  const { rows: docs } = await db.query(
    `SELECT d.id, d.emplacement_id, d.reference_mfile, d.description, d.nom_entreprise, d.cote_physique, d.statut, d.dossier_id,
            d.annee, d.annee_debut, d.annee_fin, d.range_par_nom, c.name AS classe, ${SQL_FICHIER}
       FROM documents d LEFT JOIN metadata_schemas c ON c.id = d.classe_id AND c.tenant_id = d.tenant_id
      WHERE d.tenant_id = $1 AND d.emplacement_id = ANY($2) AND d.elimine_at IS NULL AND d.deleted_at IS NULL
      ORDER BY d.cote_physique NULLS LAST, d.id`, [tenantId, ids]);
  const visibles = docs.filter((d) => d.dossier_id === null || lisibles.has(Number(d.dossier_id)));
  // Propriétés de classe de chaque dossier, dans l'ordre de la classe.
  const { lisible } = require('./classeService');
  const details = new Map();
  if (visibles.length) {
    const { rows: valeurs } = await db.query(
      `SELECT v.document_id, f.label, f.type, f.options_json, v.value_json
         FROM metadata_values v JOIN metadata_fields f ON f.id = v.field_id
         JOIN metadata_schemas s ON s.id = f.schema_id AND s.tenant_id = $1
        WHERE v.document_id = ANY($2) ORDER BY f.display_order NULLS LAST, f.id`, [tenantId, visibles.map((d) => d.id)]);
    for (const v of valeurs) {
      // [libellé, valeur lisible, type] : le type laisse l'affichage formater un nombre.
      const texte = lisible(v.value_json, v);
      if (texte) details.set(v.document_id, [...(details.get(v.document_id) || []), [v.label, texte, v.type]]);
    }
  }
  const parBoite = new Map();
  for (const d of visibles) parBoite.set(d.emplacement_id, [...(parBoite.get(d.emplacement_id) || []), d]);
  const masques = new Map();
  for (const d of docs) if (!visibles.includes(d)) masques.set(d.emplacement_id, (masques.get(d.emplacement_id) || 0) + 1);
  // Le fonds se lit sur la boîte, sinon sur le plus proche parent qui en porte un.
  const parId = new Map(noeuds.map((n) => [n.id, n]));
  const fondsDe = (n) => { for (let x = n; x; x = parId.get(x.parent_id)) if (x.fonds) return x.fonds; return null; };
  const boites = noeuds
    .filter((n) => n.type === 'boite' || (n.type === 'tablette' && (parBoite.has(n.id) || masques.has(n.id))))
    .map((n) => {
      const dossiers = (parBoite.get(n.id) || []).map((d) => ({
        id: d.id, reference: d.reference_mfile, cote: d.cote_physique, analyse: intitule(d), classe: d.classe,
        dates_extremes: datesExtremes(d), details: details.get(d.id) || [], range_par: d.range_par_nom,
      }));
      const annees = (parBoite.get(n.id) || []).flatMap((d) => [d.annee_debut || d.annee_fin || d.annee, d.annee_fin || d.annee_debut || d.annee]).filter(Boolean).map(Number);
      const min = annees.length ? Math.min(...annees) : null;
      const max = annees.length ? Math.max(...annees) : null;
      return {
        id: n.id, type: n.type, cote: n.cote, libelle: n.libelle, fonds: fondsDe(n), type_boite: n.type_boite, couleur_etiquette: n.couleur_etiquette,
        dates_extremes: min === null ? '' : (min === max ? String(min) : `${min}-${max}`), dossiers, masques: masques.get(n.id) || 0,
      };
    });
  const org = await require('./archivageService').internes.organisationDe(tenantId);
  return {
    organisation: org, perimetre: { id: racine.id, type: racine.type, cote: coteRacine, libelle: racine.libelle },
    boites, total_dossiers: visibles.length, masques: docs.length - visibles.length, etabli_at: new Date().toISOString(),
  };
}

// ------------------------------------------------------------------ récolement

async function chargerRecolement(run, tenantId, id, { verrou = false } = {}) {
  const { rows } = await run.query(`SELECT * FROM recolements WHERE id = $1 AND tenant_id = $2${verrou ? ' FOR UPDATE' : ''}`, [Number(id), tenantId]);
  if (!rows[0]) throw erreur(404, 'Récolement introuvable.');
  return rows[0];
}

/** Ouvre une campagne : instantané des boîtes et des documents attendus du périmètre. */
async function ouvrirRecolement(tenantId, corps = {}, user) {
  const perimetre = await charger(db, tenantId, corps.emplacement_id);
  const intitule = String(corps.intitule || '').trim().slice(0, 200);
  const qui = await integrite.identite(user);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const cotePerimetre = await coteDe(client, tenantId, perimetre.id);
    const { rows } = await client.query(
      `INSERT INTO recolements (tenant_id, intitule, emplacement_id, perimetre_libelle, ouvert_par, ouvert_par_nom)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [tenantId, intitule || `Récolement ${cotePerimetre} — ${new Date().toLocaleDateString('fr-FR')}`, perimetre.id, cotePerimetre, qui.id, qui.nom]);
    const r = rows[0];
    // Contenants du périmètre (lui compris) : chaque boîte est une ligne, puis
    // chacun des documents qu'elle doit contenir.
    const contenants = (await client.query(
      `WITH RECURSIVE sous AS (
         SELECT id, type, code, libelle FROM emplacements WHERE id = $1 AND tenant_id = $2
         UNION ALL SELECT e.id, e.type, e.code, e.libelle FROM emplacements e JOIN sous s ON e.parent_id = s.id WHERE e.tenant_id = $2
       ) SELECT * FROM sous WHERE type IN ('boite', 'tablette') ORDER BY id`, [perimetre.id, tenantId])).rows;
    let ordre = 0;
    for (const c of contenants) {
      const cote = await coteDe(client, tenantId, c.id);
      ordre += 1;
      if (c.type === 'boite') {
        await client.query(
          'INSERT INTO recolement_lignes (recolement_id, emplacement_id, cote, libelle, ordre) VALUES ($1, $2, $3, $4, $5)',
          [r.id, c.id, cote, c.libelle || `Boîte ${c.code}`, ordre]);
      }
      const docs = (await client.query(
        `SELECT d.id, d.reference_mfile, d.description, d.cote_physique,
                EXISTS (SELECT 1 FROM request_loans l WHERE l.document_id = d.id AND l.retourne_at IS NULL) AS en_pret
           FROM documents d WHERE d.emplacement_id = $1 AND d.tenant_id = $2 AND d.elimine_at IS NULL AND d.deleted_at IS NULL
          ORDER BY d.cote_physique NULLS LAST, d.id`, [c.id, tenantId])).rows;
      for (const d of docs) {
        ordre += 1;
        await client.query(
          `INSERT INTO recolement_lignes (recolement_id, emplacement_id, document_id, cote, libelle, resultat, constate_par_nom, constate_at, ordre)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [r.id, c.id, d.id, `${cote}${d.cote_physique ? ` / ${d.cote_physique}` : ''}`, `${d.reference_mfile}${d.description ? ` — ${d.description}` : ''}`.slice(0, 500),
            d.en_pret ? 'en_pret' : null, d.en_pret ? 'Registre des prêts' : null, d.en_pret ? new Date() : null, ordre]);
      }
    }
    await client.query(
      `INSERT INTO audit_logs (tenant_id, actor_id, actor_username, action, object_type, object_id, details_json)
       VALUES ($1, $2, $3, 'RECOLEMENT_OUVERT', 'recolement', $4, $5)`,
      [tenantId, qui.id, qui.username, r.id, JSON.stringify({ perimetre: cotePerimetre, lignes: ordre })]);
    await client.query('COMMIT');
    return r;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function detailRecolement(tenantId, id) {
  const r = await chargerRecolement(db, tenantId, id);
  const { rows } = await db.query('SELECT * FROM recolement_lignes WHERE recolement_id = $1 ORDER BY ordre, id', [r.id]);
  const compte = (x) => rows.filter((l) => l.resultat === x).length;
  return {
    ...r,
    empreinte: r.empreinte ? String(r.empreinte).trim() : null,
    lignes: rows,
    bilan: {
      total: rows.length, a_constater: rows.filter((l) => !l.resultat).length,
      ...Object.fromEntries(RESULTATS.map((x) => [x, compte(x)])),
    },
  };
}

async function listerRecolements(tenantId) {
  const { rows } = await db.query(
    `SELECT r.*, count(l.id)::int AS lignes, count(l.id) FILTER (WHERE l.resultat IS NULL)::int AS a_constater,
            count(l.id) FILTER (WHERE l.resultat IN ('absent', 'abime', 'deplace'))::int AS anomalies
       FROM recolements r LEFT JOIN recolement_lignes l ON l.recolement_id = r.id
      WHERE r.tenant_id = $1 GROUP BY r.id ORDER BY r.ouvert_at DESC LIMIT 200`, [tenantId]);
  return rows;
}

/** Constate une ou plusieurs lignes d'un récolement en cours. */
async function constater(tenantId, id, constats = [], user) {
  const liste = Array.isArray(constats) ? constats : [];
  if (!liste.length) throw erreur(400, 'Aucun constat.');
  const qui = await integrite.identite(user);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const r = await chargerRecolement(client, tenantId, id, { verrou: true });
    if (r.statut !== 'en_cours') throw erreur(409, 'Ce récolement est clos.');
    for (const c of liste) {
      if (!RESULTATS.includes(c.resultat)) throw erreur(400, 'Constat attendu : présent, absent, déplacé, abîmé ou en prêt.');
      const obs = String(c.observation || '').trim().slice(0, 1000) || null;
      if (['absent', 'deplace', 'abime'].includes(c.resultat) && !obs && c.resultat !== 'absent') throw erreur(400, 'Décrivez le déplacement ou le dommage constaté.');
      const u = await client.query(
        `UPDATE recolement_lignes SET resultat = $3, observation = $4, constate_par_nom = $5, constate_at = now()
          WHERE id = $1 AND recolement_id = $2`, [Number(c.ligne_id), r.id, c.resultat, obs, qui.nom]);
      if (!u.rowCount) throw erreur(404, 'Ligne de récolement introuvable.');
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return detailRecolement(tenantId, id);
}

const corpsRecolement = (r, lignes) => ({
  id: r.id, intitule: r.intitule, perimetre: r.perimetre_libelle, ouvert_par: r.ouvert_par_nom, ouvert_at: new Date(r.ouvert_at).toISOString(),
  clos_par: r.clos_par_nom, clos_at: r.clos_at ? new Date(r.clos_at).toISOString() : null,
  lignes: lignes.map((l) => ({ cote: l.cote, libelle: l.libelle, document_id: l.document_id, resultat: l.resultat, observation: l.observation || null })),
});

/** Clôture : tout doit être constaté ; procès-verbal figé par son empreinte. */
async function clore(tenantId, id, { observations } = {}, user) {
  const qui = await integrite.identite(user);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const r = await chargerRecolement(client, tenantId, id, { verrou: true });
    if (r.statut !== 'en_cours') throw erreur(409, 'Ce récolement est déjà clos.');
    const lignes = (await client.query('SELECT * FROM recolement_lignes WHERE recolement_id = $1 ORDER BY ordre, id', [r.id])).rows;
    const reste = lignes.filter((l) => !l.resultat).length;
    if (reste) throw erreur(409, `${reste} ligne(s) restent à constater.`);
    let fin = (await client.query(
      `UPDATE recolements SET clos_par = $2, clos_par_nom = $3, clos_at = now(), observations = $4 WHERE id = $1 RETURNING *`,
      [r.id, qui.id, qui.nom, String(observations || '').trim().slice(0, 4000) || null])).rows[0];
    const empreinte = integrite.empreinteTampon(Buffer.from(JSON.stringify(corpsRecolement(fin, lignes)), 'utf8'));
    fin = (await client.query("UPDATE recolements SET statut = 'clos', empreinte = $2 WHERE id = $1 RETURNING *", [r.id, empreinte])).rows[0];
    const anomalies = lignes.filter((l) => ['absent', 'deplace', 'abime'].includes(l.resultat)).length;
    await client.query(
      `INSERT INTO audit_logs (tenant_id, actor_id, actor_username, action, object_type, object_id, details_json)
       VALUES ($1, $2, $3, 'RECOLEMENT_CLOS', 'recolement', $4, $5)`,
      [tenantId, qui.id, qui.username, r.id, JSON.stringify({ perimetre: r.perimetre_libelle, lignes: lignes.length, anomalies, empreinte })]);
    await client.query('COMMIT');
    return fin;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Procès-verbal de récolement, empreinte recalculée et comparée. */
async function procesVerbal(tenantId, id) {
  const d = await detailRecolement(tenantId, id);
  if (d.statut !== 'clos') throw erreur(409, "Le procès-verbal n'existe qu'une fois le récolement clos.");
  const calculee = integrite.empreinteTampon(Buffer.from(JSON.stringify(corpsRecolement(d, d.lignes)), 'utf8'));
  const org = await require('./archivageService').internes.organisationDe(tenantId);
  return { ...d, organisation: org, empreinte_conforme: d.empreinte === calculee };
}

module.exports = {
  TYPES, LIBELLES_TYPE, SUPPORTS, RESULTATS, LIBELLES_RESULTAT, COULEURS, TYPES_BOITE,
  lister, creer, modifier, supprimer, contenu, coteDe, placer, localisation, suggestions, repertoire, datesExtremes, intitule,
  ouvrirRecolement, detailRecolement, listerRecolements, constater, clore, procesVerbal, corpsRecolement,
};
