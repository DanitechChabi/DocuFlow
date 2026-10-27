// ============================================================================
// archivageService — archivage réglementaire (migration 032) : DUA, sort
// final, bordereaux d'élimination, procès-verbal.
//
//   ÉCHÉANCE     date de départ (date du document, création, archivage) +
//                DUA de la classe. Une classe sans DUA ne produit aucune
//                échéance : pas de repli sur un réglage par défaut — une
//                destruction repose sur une règle explicite (voir la 032).
//   SORT FINAL   au terme de la DUA : conservation (versement aux archives
//                définitives), élimination (par bordereau), tri (au cas par
//                cas). Les décisions « verser » / « conserver » sortent le
//                document de la liste à traiter.
//   BORDEREAU    brouillon → proposé → validé (ou rejeté) → exécuté, avec
//                SÉPARATION DES TÂCHES : celui qui prépare ou propose ne
//                valide pas. Chaque ligne garde l'instantané du document.
//   EXÉCUTION    destruction : fichiers, texte, métadonnées, analyses,
//                relations ; la ligne `documents` reste en pierre tombale
//                (elimine_at + deleted_at). Base d'abord, stockage après
//                (comme la purge) : un échec en base laisse les binaires
//                intacts et l'exécution rejouable. Un document gelé, ou qui
//                n'est plus éligible, est écarté et le PV le dit.
//   PROCÈS-VERBAL  contenu figé à l'exécution, empreinte SHA-256 inscrite au
//                journal chaîné (031).
//
// Tout passe par le journal d'audit chaîné, DANS la transaction de l'acte :
// la trace et l'acte sont validés ensemble, ou ni l'un ni l'autre — une
// destruction sans trace est impossible (documentAuditService avale ses
// erreurs, ce qui convient à une consultation, pas à une élimination).
// ============================================================================
const crypto = require('crypto');
const db = require('../config/db');
const aclService = require('./aclService');
const roleService = require('./roleService');
const integrite = require('./integriteService');
const stateMachine = require('./documentStateMachine');
const { COMMUNICABILITE } = require('../config/referentielBenin');

const POINTS_DEPART = ['date_document', 'creation', 'archivage'];
const SORTS = ['conservation', 'elimination', 'tri'];
const STATUTS_BORDEREAU = ['brouillon', 'propose', 'valide', 'transmis', 'vise', 'rejete', 'execute', 'annule'];
const OUVERTS = ['brouillon', 'propose', 'valide', 'transmis', 'vise'];
// Après la validation interne, plus rien ne s'ajoute : la corbeille est admise
// (le document attend sa destruction), la liste est celle que l'autorité vise.
const ARRETES = ['valide', 'transmis', 'vise'];
const DECISIONS_VISA = ['accorde', 'partiel', 'refuse'];
const MODES_DESTRUCTION = ['sur_place', 'prestataire'];
const LIBELLES_POINT_DEPART = {
  date_document: 'la date du document', creation: "l'entrée dans la GED", archivage: "l'archivage",
};
const LIBELLES_SORT = { conservation: 'Conservation définitive', elimination: 'Élimination', tri: 'Tri' };
const MOTIFS = {
  introuvable: 'Document introuvable ou hors de votre périmètre.',
  deja_elimine: 'Document déjà éliminé.',
  en_corbeille: 'Document en corbeille.',
  sans_dua: 'Sa classe ne porte pas de DUA.',
  dua_non_commencee: "Sa DUA n'a pas commencé (point de départ non atteint).",
  echeance_non_atteinte: "Son échéance n'est pas atteinte.",
  sort_conservation: 'Son sort final est la conservation.',
  gel_juridique: 'Document sous gel juridique.',
  decision_versement: 'Déjà versé aux archives définitives.',
  decision_conservation: 'Conservé par décision.',
  autre_bordereau: "Déjà inscrit sur un autre bordereau en cours.",
  absent: 'Document détruit depuis (purge).',
  exclu_visa: "Exclu par le visa de l'autorité d'archives.",
};

const erreur = (status, message, code, extra = {}) => Object.assign(new Error(message), { status, ...(code ? { code } : {}), ...extra });

// ---------------------------------------------------------------- calculs purs

/** 'YYYY-MM-DD' + n années ; le 29 février tombe au 28 (comme PostgreSQL). */
function ajouterAnnees(date, annees) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date || ''));
  if (!m) return null;
  const an = Number(m[1]) + Number(annees);
  const mois = Number(m[2]);
  const dernier = new Date(Date.UTC(an, mois, 0)).getUTCDate();
  const jour = Math.min(Number(m[3]), dernier);
  return `${String(an).padStart(4, '0')}-${m[2]}-${String(jour).padStart(2, '0')}`;
}

const jourDe = (v) => {
  if (!v) return null;
  if (v instanceof Date) {
    // Les timestamps arrivent en Date : leur jour LOCAL est celui que la base
    // retient (`::date` dans le fuseau de la session).
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return String(v).slice(0, 10);
};

/**
 * Date de départ de la DUA.
 *  - date_document : la date du document ; absente, la date d'entrée dans la
 *    GED est retenue (plus tardive : l'échéance recule, jamais l'inverse) et
 *    signalée comme estimée ;
 *  - creation : l'entrée dans la GED ;
 *  - archivage : le passage au statut « archivé » ; un document non archivé
 *    n'a pas d'échéance (sa DUA n'a pas commencé).
 */
function departDua({ date_document: dateDoc, created_at: creation, archive_at: archive }, point = 'date_document') {
  if (point === 'creation') return { depart: jourDe(creation), estime: false };
  if (point === 'archivage') return { depart: jourDe(archive), estime: false };
  if (dateDoc) return { depart: jourDe(dateDoc), estime: false };
  return { depart: jourDe(creation), estime: Boolean(creation) };
}

const joursEntre = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/**
 * Échéance d'un document au regard de la règle de sa classe.
 * @returns {null|{depart, depart_estime, echeance, echu, jours_restants}}
 */
function calculerEcheance(doc, regle, aujourdhui = jourDe(new Date())) {
  if (!regle || regle.dua_annees === null || regle.dua_annees === undefined) return null;
  const { depart, estime } = departDua(doc, regle.dua_point_depart || 'date_document');
  if (!depart) return { depart: null, depart_estime: false, echeance: null, echu: false, jours_restants: null };
  const echeance = ajouterAnnees(depart, regle.dua_annees);
  const jours = joursEntre(aujourdhui, echeance);
  return { depart, depart_estime: estime, echeance, echu: jours <= 0, jours_restants: jours };
}

/** Règle de DUA saisie : normalisée, ou erreur 400. */
function validerCommunicabilite(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (!Object.prototype.hasOwnProperty.call(COMMUNICABILITE, v)) throw erreur(400, 'Catégorie de communicabilité inconnue (décret n° 2007-532, art. 32-33).');
  return v;
}

function validerRegle(body = {}) {
  const brut = body.dua_annees;
  const communicabilite = validerCommunicabilite(body.communicabilite);
  if (brut === null || brut === undefined || brut === '') {
    return { dua_annees: null, dua_point_depart: POINTS_DEPART.includes(body.dua_point_depart) ? body.dua_point_depart : 'date_document', sort_final: null, dua_reference: String(body.dua_reference || '').trim().slice(0, 2000) || null, communicabilite };
  }
  const annees = Number(brut);
  if (!Number.isInteger(annees) || annees < 0 || annees > 200) throw erreur(400, 'La DUA est un nombre entier d\'années, de 0 à 200.');
  const point = body.dua_point_depart || 'date_document';
  if (!POINTS_DEPART.includes(point)) throw erreur(400, 'Point de départ attendu : date du document, création ou archivage.');
  if (!SORTS.includes(body.sort_final)) throw erreur(400, 'Sort final attendu : conservation, élimination ou tri.');
  const ref = String(body.dua_reference || '').trim();
  if (ref.length > 2000) throw erreur(400, 'Référence trop longue (2 000 caractères au plus).');
  return { dua_annees: annees, dua_point_depart: point, sort_final: body.sort_final, dua_reference: ref || null, communicabilite };
}

/** Intitulé lisible : le titre calculé par la classe, sinon la fiche. */
function intituleDe(d) {
  const vide = (v) => !v || !String(v).trim() || String(v).trim() === 'À indexer';
  if (!vide(d.description)) return String(d.description).trim().slice(0, 300);
  const sujet = [d.type_document, vide(d.nom_entreprise) ? null : d.nom_entreprise].filter(Boolean).join(' — ');
  const numeros = [d.num_dossier, d.num_acte].filter((x) => !vide(x));
  return [sujet, numeros.length ? `dossier ${numeros.join(' / ')}` : null].filter(Boolean).join(' · ') || d.reference_mfile || null;
}

/** Pourquoi ce document ne peut pas être éliminé (null : il le peut). */
function motifNonEligible(r, { bordereauId = null, corbeilleAdmise = false } = {}) {
  if (!r) return 'introuvable';
  if (r.elimine_at) return 'deja_elimine';
  if (r.deleted_at && !corbeilleAdmise) return 'en_corbeille';
  if (r.dua_annees === null || r.dua_annees === undefined) return 'sans_dua';
  if (!r.echeance) return 'dua_non_commencee';
  if (Number(r.jours_restants) > 0) return 'echeance_non_atteinte';
  if (r.sort_final === 'conservation') return 'sort_conservation';
  if (r.gel_id) return 'gel_juridique';
  if (r.decision) return `decision_${r.decision}`;
  if (r.bordereau_id && Number(r.bordereau_id) !== Number(bordereauId)) return 'autre_bordereau';
  return null;
}

/**
 * Actions ouvertes à un utilisateur sur un bordereau. SÉPARATION DES TÂCHES :
 * qui a préparé ou proposé le bordereau ne le valide ni ne le rejette.
 * @param {{ manage: boolean, validate: boolean }} droits
 */
function actionsPermises(b, userId, droits) {
  const auteur = [b.created_by, b.propose_par].filter((x) => x !== null && x !== undefined).map(Number).includes(Number(userId));
  const valideur = droits.validate && !auteur;
  return {
    modifier: droits.manage && b.statut === 'brouillon',
    proposer: droits.manage && b.statut === 'brouillon',
    retirer: droits.manage && b.statut === 'propose',
    valider: valideur && b.statut === 'propose',
    rejeter: valideur && b.statut === 'propose',
    reprendre: droits.manage && b.statut === 'rejete',
    // Décret n° 2007-532, art. 44 : la liste validée est soumise à l'autorité
    // d'archives, qui la vise ; l'exécution attend ce visa.
    transmettre: droits.manage && b.statut === 'valide' && Boolean(b.visa_requis),
    saisir_visa: droits.manage && b.statut === 'transmis',
    executer: droits.manage && (b.visa_requis ? b.statut === 'vise' : b.statut === 'valide'),
    annuler: droits.manage && ['brouillon', 'propose', 'rejete', 'valide', 'transmis', 'vise'].includes(b.statut),
    separation: droits.validate && auteur && b.statut === 'propose',
  };
}

const iso = (v) => (v ? new Date(v).toISOString() : null);

/** Contenu canonique du procès-verbal (ce que couvre son empreinte). */
function corpsPv(b, lignes) {
  return {
    numero: b.numero, intitule: b.intitule,
    propose_par: b.propose_par_nom, propose_at: iso(b.propose_at),
    valide_par: b.valide_par_nom, valide_at: iso(b.valide_at),
    execute_par: b.execute_par_nom, execute_at: iso(b.execute_at),
    // Ajoutés par la migration 036, et seulement s'ils sont renseignés : les
    // procès-verbaux antérieurs gardent exactement leur empreinte.
    ...(b.visa_numero || b.visa_decision ? {
      visa: { autorite: b.visa_autorite, numero: b.visa_numero, date: b.visa_date ? jourDe(b.visa_date) : null, decision: b.visa_decision },
    } : {}),
    ...(b.mode_destruction ? { destruction: { mode: b.mode_destruction, prestataire: b.prestataire || null, controle_par: b.controle_par || null } } : {}),
    lignes: lignes.map((l) => ({
      ordre: l.ordre, reference: l.reference, intitule: l.intitule, classe: l.classe, echeance: l.echeance,
      sort_final: l.sort_final, resultat: l.resultat, motif_ecart: l.motif_ecart || null,
      fichiers: (l.fichiers || []).map((f) => ({ version: f.version, empreinte: f.empreinte_sha256 || null })),
    })),
  };
}
const empreintePv = (b, lignes) => integrite.empreinteTampon(Buffer.from(JSON.stringify(corpsPv(b, lignes)), 'utf8'));

// ------------------------------------------------------------------ base

let migrationPromesse = null;
function migrationPassee() {
  if (!migrationPromesse) {
    migrationPromesse = db.query("SELECT to_regclass('bordereaux_elimination') IS NOT NULL AS ok")
      .then((r) => r.rows[0].ok).catch(() => { migrationPromesse = null; return false; });
  }
  return migrationPromesse;
}

/** Ligne d'audit chaîné, dans la transaction de l'acte (n'avale rien). */
async function journaliser(run, { tenantId, qui, action, objectType = 'document', objectId = null, details = {} }) {
  await run.query(
    `INSERT INTO audit_logs (tenant_id, actor_id, actor_username, action, object_type, object_id, details_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [tenantId, qui.id, qui.username, action, objectType, objectId, JSON.stringify(details)]
  );
}

async function historique(run, documentId, userId, action, comment = null, avant = null, apres = null) {
  await run.query(
    `INSERT INTO document_history (document_id, user_id, action, previous_status, new_status, comment)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [documentId, userId || null, String(action).slice(0, 100), avant, apres, comment]
  );
}

async function notifier(tenantId, userIds, { titre, message, documentId = null }) {
  for (const id of new Set(userIds.filter(Boolean))) {
    try {
      await db.query(
        `INSERT INTO notifications (id_user, title, message, type, tenant_id, document_id)
         VALUES ($1, $2, $3, 'archives', $4, $5)`,
        [id, titre.slice(0, 255), message, tenantId, documentId]
      );
    } catch (err) {
      console.warn('[archivage] notification non enregistrée :', err.message);
    }
  }
}

async function transaction(fn) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const perimetre = async (tenantId, userId) => {
  const { lisibles } = await aclService.dossiersAccessibles(tenantId, userId);
  return (dossierId) => dossierId === null || dossierId === undefined || lisibles.has(Number(dossierId));
};

// Échéance de chaque document, calculée en base (une seule définition, la
// même que calculerEcheance : les tests vérifient que les deux concordent).
const SQL_ECHEANCES = `
  SELECT d.id, d.tenant_id, d.reference_mfile, d.description, d.nom_entreprise, d.num_dossier, d.num_acte,
         d.type_document, d.annee, d.statut, d.dossier_id, d.classe_id, d.deleted_at, d.elimine_at,
         to_char(d.date_document, 'YYYY-MM-DD') AS date_document, d.created_at, d.archive_at,
         c.name AS classe, c.code AS classe_code, c.dua_annees, c.dua_point_depart, c.sort_final, c.dua_reference, c.communicabilite,
         fo.name AS dossier,
         to_char(x.depart, 'YYYY-MM-DD') AS depart, COALESCE(x.estime, false) AS depart_estime,
         to_char((x.depart + make_interval(years => c.dua_annees))::date, 'YYYY-MM-DD') AS echeance,
         ((x.depart + make_interval(years => c.dua_annees))::date - CURRENT_DATE) AS jours_restants,
         g.id AS gel_id, g.motif AS gel_motif, g.reference AS gel_reference,
         ds.decision, ds.note AS decision_note, ds.decide_par_nom, ds.decide_at,
         bo.id AS bordereau_id, bo.numero AS bordereau_numero, bo.statut AS bordereau_statut
    FROM documents d
    LEFT JOIN metadata_schemas c ON c.id = d.classe_id AND c.tenant_id = d.tenant_id
    LEFT JOIN document_folders fo ON fo.id = d.dossier_id AND fo.tenant_id = d.tenant_id
    LEFT JOIN LATERAL (
      SELECT CASE c.dua_point_depart
               WHEN 'creation' THEN d.created_at::date
               WHEN 'archivage' THEN d.archive_at::date
               ELSE COALESCE(d.date_document, d.created_at::date)
             END AS depart,
             (COALESCE(c.dua_point_depart, 'date_document') = 'date_document' AND d.date_document IS NULL) AS estime
       WHERE c.dua_annees IS NOT NULL
    ) x ON true
    LEFT JOIN document_gels g ON g.document_id = d.id AND g.leve_at IS NULL
    LEFT JOIN decisions_sort_final ds ON ds.document_id = d.id
    LEFT JOIN LATERAL (
      SELECT b.id, b.numero, b.statut FROM bordereau_documents l
        JOIN bordereaux_elimination b ON b.id = l.bordereau_id
       WHERE l.document_id = d.id AND b.statut IN ('brouillon', 'propose', 'valide', 'transmis', 'vise')
       ORDER BY b.id DESC LIMIT 1
    ) bo ON true
   WHERE d.tenant_id = $1`;

const versLigne = (r) => ({
  id: r.id, reference: r.reference_mfile, intitule: intituleDe(r), statut: r.statut,
  classe_id: r.classe_id, classe: r.classe, classe_code: r.classe_code, dossier: r.dossier,
  date_document: r.date_document, cree_le: r.created_at, archive_le: r.archive_at,
  dua_annees: r.dua_annees, point_depart: r.dua_point_depart, sort_final: r.sort_final, dua_reference: r.dua_reference,
  depart: r.depart, depart_estime: r.depart_estime, echeance: r.echeance,
  jours_restants: r.jours_restants === null ? null : Number(r.jours_restants),
  echu: r.echeance !== null && Number(r.jours_restants) <= 0,
  gel: r.gel_id ? { motif: r.gel_motif, reference: r.gel_reference } : null,
  decision: r.decision ? { decision: r.decision, note: r.decision_note, par: r.decide_par_nom, le: r.decide_at } : null,
  bordereau: r.bordereau_id ? { id: r.bordereau_id, numero: r.bordereau_numero, statut: r.bordereau_statut } : null,
});

async function lireEcheances(run, tenantId, ids) {
  const { rows } = await run.query(`${SQL_ECHEANCES} AND d.id = ANY($2::int[])`, [tenantId, ids]);
  return new Map(rows.map((r) => [r.id, r]));
}

// --------------------------------------------------------- règle des classes

async function definirDua(tenantId, classeId, body, user) {
  const regle = validerRegle(body);
  const qui = await integrite.identite(user);
  return transaction(async (c) => {
    const avant = (await c.query(
      'SELECT * FROM metadata_schemas WHERE id = $1 AND tenant_id = $2 AND is_default IS NOT TRUE FOR UPDATE', [classeId, tenantId])).rows[0];
    if (!avant) throw erreur(404, 'Classe introuvable.');
    const { rows } = await c.query(
      `UPDATE metadata_schemas SET dua_annees = $3, dua_point_depart = $4, sort_final = $5, dua_reference = $6,
              communicabilite = CASE WHEN $7::boolean THEN $8 ELSE communicabilite END, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [classeId, tenantId, regle.dua_annees, regle.dua_point_depart, regle.sort_final, regle.dua_reference,
        regle.communicabilite !== undefined, regle.communicabilite ?? null]
    );
    const resume = (s) => ({ dua_annees: s.dua_annees, point_depart: s.dua_point_depart, sort_final: s.sort_final, reference: s.dua_reference, communicabilite: s.communicabilite || null });
    await journaliser(c, {
      tenantId, qui, action: 'DUA_MODIFIEE', objectType: 'classe', objectId: classeId,
      details: { classe: avant.name, avant: resume(avant), apres: resume(rows[0]) },
    });
    return rows[0];
  });
}

// ------------------------------------------------------------ vue sort final

/**
 * Échéances atteintes (et à venir sous `horizon` mois), bornées au périmètre
 * de l'utilisateur, regroupées par classe et sort final.
 */
async function vueSortFinal(tenantId, user, { horizon = 6, classeId = null, sort = null, q = '', traites = false } = {}) {
  const mois = Math.min(Math.max(Number(horizon) || 0, 0), 120);
  const lisible = await perimetre(tenantId, user.id);
  const params = [tenantId, mois];
  let sql = `${SQL_ECHEANCES} AND d.deleted_at IS NULL AND d.elimine_at IS NULL AND c.dua_annees IS NOT NULL
     AND x.depart IS NOT NULL
     AND (x.depart + make_interval(years => c.dua_annees))::date <= (CURRENT_DATE + make_interval(months => $2))::date`;
  if (classeId) { params.push(Number(classeId)); sql += ` AND d.classe_id = $${params.length}`; }
  if (SORTS.includes(sort)) { params.push(sort); sql += ` AND c.sort_final = $${params.length}`; }
  if (!traites) sql += ' AND ds.id IS NULL';
  sql += ' ORDER BY (x.depart + make_interval(years => c.dua_annees))::date, d.id LIMIT 2001';
  const { rows } = await db.query(sql, params);
  const terme = String(q || '').trim().toLowerCase();
  let lignes = rows.filter((r) => lisible(r.dossier_id)).map((r) => ({
    ...versLigne(r),
    eligible: motifNonEligible(r) === null,
    motif: motifNonEligible(r) ? MOTIFS[motifNonEligible(r)] : null,
  }));
  if (terme) lignes = lignes.filter((l) => `${l.reference} ${l.intitule || ''}`.toLowerCase().includes(terme));
  const tronque = lignes.length > 2000;
  lignes = lignes.slice(0, 2000);

  const groupes = new Map();
  for (const l of lignes) {
    const cle = `${l.classe_id}|${l.sort_final}`;
    if (!groupes.has(cle)) {
      groupes.set(cle, {
        classe_id: l.classe_id, classe: l.classe, classe_code: l.classe_code, sort_final: l.sort_final,
        dua_annees: l.dua_annees, point_depart: l.point_depart, dua_reference: l.dua_reference, documents: [],
      });
    }
    groupes.get(cle).documents.push(l);
  }
  const echus = lignes.filter((l) => l.echu && !l.decision);
  const compte = (s) => echus.filter((l) => l.sort_final === s).length;

  // Indicateur : documents vivants dont la classe ne dit rien de leur
  // conservation (ou sans classe) — ce que le tableau de gestion ne couvre pas.
  const { lisibles } = await aclService.dossiersAccessibles(tenantId, user.id);
  const sansDua = await db.query(
    `SELECT count(*)::int AS n FROM documents d
       LEFT JOIN metadata_schemas c ON c.id = d.classe_id AND c.tenant_id = d.tenant_id
      WHERE d.tenant_id = $1 AND d.deleted_at IS NULL AND d.elimine_at IS NULL AND c.dua_annees IS NULL
        AND (d.dossier_id IS NULL OR d.dossier_id = ANY($2::int[]))`,
    [tenantId, [...lisibles]]
  );
  const classes = await db.query(
    `SELECT id, name, code, dua_annees, dua_point_depart, sort_final FROM metadata_schemas
      WHERE tenant_id = $1 AND is_default IS NOT TRUE ORDER BY name`, [tenantId]);
  return {
    horizon_mois: mois,
    resume: {
      a_eliminer: compte('elimination'), a_verser: compte('conservation'), a_trier: compte('tri'),
      a_venir: lignes.filter((l) => !l.echu).length,
      geles: lignes.filter((l) => l.gel).length,
      eligibles: lignes.filter((l) => l.eligible).length,
      sans_dua: sansDua.rows[0].n,
    },
    groupes: [...groupes.values()],
    classes: classes.rows,
    tronque,
  };
}

/** Échéance et sort final d'UN document (fiche). */
async function echeanceDocument(tenantId, documentId) {
  const r = (await lireEcheances(db, tenantId, [Number(documentId)])).get(Number(documentId));
  if (!r) return null;
  const communicabilite = await require('./communicabiliteService').etatDocument(tenantId, Number(documentId)).catch(() => null);
  return { ...versLigne(r), libelle_point_depart: LIBELLES_POINT_DEPART[r.dua_point_depart] || null, communicabilite };
}

// ---------------------------------------------------------------- décisions

/**
 * Décision de sort final, document par document :
 *   versement     (sort conservation ou tri) : versé aux archives définitives —
 *                 passe « archivé » si besoin ;
 *   conservation  (sort élimination ou tri) : gardé, note obligatoire.
 */
async function decider(tenantId, ids, { decision, note } = {}, user) {
  if (!['versement', 'conservation'].includes(decision)) throw erreur(400, 'Décision attendue : versement ou conservation.');
  const texte = String(note || '').trim();
  if (decision === 'conservation' && !texte) throw erreur(400, 'La conservation d\'un document au-delà de sa DUA se motive : note obligatoire.');
  if (texte.length > 2000) throw erreur(400, 'Note trop longue (2 000 caractères au plus).');
  const liste = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!liste.length) throw erreur(400, 'Aucun document désigné.');
  const lisible = await perimetre(tenantId, user.id);
  const qui = await integrite.identite(user);
  const faits = [];
  const refuses = [];
  for (const id of liste) {
    try {
      await transaction(async (c) => {
        await c.query('SELECT id FROM documents WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [id, tenantId]);
        const r = (await lireEcheances(c, tenantId, [id])).get(id);
        if (!r || !lisible(r.dossier_id)) throw erreur(404, MOTIFS.introuvable);
        if (r.elimine_at) throw erreur(409, MOTIFS.deja_elimine);
        if (r.deleted_at) throw erreur(409, MOTIFS.en_corbeille);
        if (r.dua_annees === null) throw erreur(409, MOTIFS.sans_dua);
        if (!r.echeance || Number(r.jours_restants) > 0) throw erreur(409, MOTIFS.echeance_non_atteinte);
        if (r.decision) throw erreur(409, MOTIFS[`decision_${r.decision}`]);
        if (r.bordereau_id) throw erreur(409, `Inscrit sur le bordereau ${r.bordereau_numero} : retirez-le d'abord.`);
        if (decision === 'versement' && r.sort_final === 'elimination') throw erreur(409, 'Son sort final est l\'élimination : un versement exige une décision de conservation.');
        if (decision === 'conservation' && r.sort_final === 'conservation') throw erreur(409, 'Son sort final est déjà la conservation : versez-le.');
        if (decision === 'versement' && r.statut !== 'archivé') {
          const t = stateMachine.canTransition(r.statut, 'archivé');
          if (!t.ok) throw erreur(409, `Versement impossible depuis le statut « ${r.statut} » : achevez d'abord son indexation.`);
          await c.query("UPDATE documents SET statut = 'archivé', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2", [id, tenantId]);
        }
        await c.query(
          `INSERT INTO decisions_sort_final (tenant_id, document_id, decision, note, decide_par, decide_par_nom)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [tenantId, id, decision, texte || null, qui.id, qui.nom]
        );
        await historique(c, id, user.id, decision === 'versement' ? 'Versé aux archives définitives (sort final)' : 'Conservé au-delà de la DUA (décision de tri)',
          texte || null, decision === 'versement' && r.statut !== 'archivé' ? r.statut : null, decision === 'versement' && r.statut !== 'archivé' ? 'archivé' : null);
        await journaliser(c, {
          tenantId, qui, action: decision === 'versement' ? 'VERSEMENT_DEFINITIF' : 'SORT_CONSERVE', objectId: id,
          details: { echeance: r.echeance, sort_final: r.sort_final, note: texte || null },
        });
      });
      faits.push(id);
    } catch (err) {
      if (!err.status) throw err;
      refuses.push({ id, motif: err.message });
    }
  }
  return { faits, refuses };
}

async function annulerDecision(tenantId, documentId, user) {
  const lisible = await perimetre(tenantId, user.id);
  const qui = await integrite.identite(user);
  return transaction(async (c) => {
    const { rows } = await c.query(
      `SELECT ds.*, d.dossier_id FROM decisions_sort_final ds JOIN documents d ON d.id = ds.document_id
        WHERE ds.document_id = $1 AND ds.tenant_id = $2 AND d.elimine_at IS NULL FOR UPDATE OF ds`, [documentId, tenantId]);
    const dec = rows[0];
    if (!dec || !lisible(dec.dossier_id)) throw erreur(404, 'Aucune décision de sort final pour ce document.');
    await c.query('DELETE FROM decisions_sort_final WHERE id = $1', [dec.id]);
    await historique(c, documentId, user.id, 'Décision de sort final annulée', null);
    await journaliser(c, { tenantId, qui, action: 'DECISION_SORT_ANNULEE', objectId: Number(documentId), details: { decision: dec.decision } });
    return { annulee: dec.decision };
  });
}

// --------------------------------------------------------------- bordereaux

const SQL_LIGNES = `
  SELECT l.id, l.bordereau_id, l.document_id, l.ordre, l.reference, l.intitule, l.classe, l.classe_code, l.dossier,
         l.type_document, l.annee, to_char(l.date_document, 'YYYY-MM-DD') AS date_document, l.cree_le, l.archive_le,
         to_char(l.depart, 'YYYY-MM-DD') AS depart, l.dua_annees, l.point_depart,
         to_char(l.echeance, 'YYYY-MM-DD') AS echeance, l.sort_final, l.dua_reference,
         l.nb_fichiers, l.volume_octets, l.fichiers, l.resultat, l.motif_ecart, l.ajoute_at, l.elimine_at, l.exclu_visa,
         d.dossier_id AS dossier_actuel
    FROM bordereau_documents l LEFT JOIN documents d ON d.id = l.document_id
   WHERE l.bordereau_id = $1
   ORDER BY l.ordre, l.id`;

async function chargerBordereau(run, tenantId, id, { verrou = false } = {}) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw erreur(400, 'Identifiant de bordereau invalide.');
  const { rows } = await run.query(
    `SELECT * FROM bordereaux_elimination WHERE id = $1 AND tenant_id = $2${verrou ? ' FOR UPDATE' : ''}`, [n, tenantId]);
  if (!rows[0]) throw erreur(404, 'Bordereau introuvable.');
  return rows[0];
}

const lignesDe = async (run, id) => (await run.query(SQL_LIGNES, [id])).rows.map((l) => ({
  ...l, volume_octets: Number(l.volume_octets), fichiers: l.fichiers || [],
}));

/** Fichiers d'un document, au format de l'instantané. */
async function fichiersDe(run, documentId) {
  const { rows } = await run.query(
    `SELECT id, version, original_name, mime_type, file_size, stored_name, cloudinary_public_id,
            empreinte_sha256, empreinte_origine, integrite_statut
       FROM document_files WHERE document_id = $1 ORDER BY version, id`, [documentId]);
  return rows;
}

function instantane(r, fichiers, constats = new Map()) {
  return {
    reference: r.reference_mfile, intitule: intituleDe(r), classe: r.classe, classe_code: r.classe_code,
    dossier: r.dossier, type_document: r.type_document, annee: r.annee, date_document: r.date_document,
    cree_le: r.created_at, archive_le: r.archive_at, depart: r.depart, dua_annees: r.dua_annees,
    point_depart: r.dua_point_depart, echeance: r.echeance, sort_final: r.sort_final, dua_reference: r.dua_reference,
    nb_fichiers: fichiers.length,
    volume_octets: fichiers.reduce((s, f) => s + (Number(f.file_size) || 0), 0),
    fichiers: fichiers.map((f) => {
      const enregistree = f.empreinte_sha256 ? f.empreinte_sha256.trim() : null;
      const c = constats.get(f.id);
      return {
        version: f.version, nom: f.original_name, type: f.mime_type, taille: f.file_size,
        empreinte_sha256: enregistree || c?.constatee || null,
        empreinte_origine: enregistree ? f.empreinte_origine : (c?.constatee ? 'elimination' : null),
        constat: c ? c.constat : (f.integrite_statut || null),
      };
    }),
  };
}

async function ecrireInstantane(run, ligneId, s) {
  await run.query(
    `UPDATE bordereau_documents SET reference = $2, intitule = $3, classe = $4, classe_code = $5, dossier = $6,
            type_document = $7, annee = $8, date_document = $9, cree_le = $10, archive_le = $11, depart = $12,
            dua_annees = $13, point_depart = $14, echeance = $15, sort_final = $16, dua_reference = $17,
            nb_fichiers = $18, volume_octets = $19, fichiers = $20
      WHERE id = $1`,
    [ligneId, s.reference, s.intitule, s.classe, s.classe_code, s.dossier, s.type_document, s.annee, s.date_document,
      s.cree_le, s.archive_le, s.depart, s.dua_annees, s.point_depart, s.echeance, s.sort_final, s.dua_reference,
      s.nb_fichiers, s.volume_octets, JSON.stringify(s.fichiers)]
  );
}

async function droitsDe(tenantId, user) {
  const [manage, validate] = await Promise.all([
    roleService.possede(tenantId, user.role, 'archives.manage'),
    roleService.possede(tenantId, user.role, 'archives.validate'),
  ]);
  return { manage, validate };
}

function versBordereau(b) {
  const { empreinte_pv: e, ...reste } = b;
  return { ...reste, empreinte_pv: e ? String(e).trim() : null };
}

async function listerBordereaux(tenantId, { statut = null } = {}) {
  const params = [tenantId];
  let filtre = '';
  if (STATUTS_BORDEREAU.includes(statut)) { params.push(statut); filtre = ' AND b.statut = $2'; }
  const { rows } = await db.query(
    `SELECT b.*, count(l.id)::int AS nb_documents,
            count(l.id) FILTER (WHERE l.resultat = 'elimine')::int AS nb_elimines,
            count(l.id) FILTER (WHERE l.resultat = 'ecarte')::int AS nb_ecartes,
            COALESCE(sum(l.volume_octets), 0)::bigint AS volume_octets
       FROM bordereaux_elimination b LEFT JOIN bordereau_documents l ON l.bordereau_id = b.id
      WHERE b.tenant_id = $1${filtre}
      GROUP BY b.id
      ORDER BY (b.statut IN ('propose', 'valide', 'transmis', 'vise')) DESC, b.created_at DESC
      LIMIT 500`, params);
  return rows.map((r) => ({ ...versBordereau(r), volume_octets: Number(r.volume_octets) }));
}

/**
 * Détail d'un bordereau. Une ligne dont le document est hors du périmètre
 * de l'utilisateur est MASQUÉE (ni référence, ni intitulé, ni empreinte) :
 * le bordereau ne révèle pas ce que l'ACL protège.
 */
async function detailBordereau(tenantId, id, user) {
  const b = await chargerBordereau(db, tenantId, id);
  const lisible = await perimetre(tenantId, user.id);
  const lignes = (await lignesDe(db, b.id)).map((l) => {
    const visible = lisible(l.dossier_actuel);
    const { dossier_actuel: _d, ...reste } = l;
    if (visible) return { ...reste, masque: false };
    return {
      id: l.id, ordre: l.ordre, masque: true, resultat: l.resultat, nb_fichiers: l.nb_fichiers,
      volume_octets: l.volume_octets, echeance: l.echeance, sort_final: l.sort_final,
    };
  });
  // Éligibilité actuelle des lignes d'un bordereau en cours (rien n'a encore été détruit).
  if (OUVERTS.includes(b.statut)) {
    const ids = lignes.filter((l) => !l.masque && l.document_id).map((l) => l.document_id);
    const etats = ids.length ? await lireEcheances(db, tenantId, ids) : new Map();
    for (const l of lignes) {
      if (l.masque) continue;
      const motif = l.document_id ? motifNonEligible(etats.get(l.document_id), { bordereauId: b.id, corbeilleAdmise: ARRETES.includes(b.statut) }) : 'absent';
      l.alerte = l.exclu_visa ? MOTIFS.exclu_visa : (motif ? MOTIFS[motif] : null);
      l.gel = Boolean(l.document_id && etats.get(l.document_id)?.gel_id);
    }
  }
  const droits = await droitsDe(tenantId, user);
  return {
    ...versBordereau(b),
    organisation: await organisationDe(tenantId),
    lignes,
    totaux: {
      documents: lignes.length,
      elimines: lignes.filter((l) => l.resultat === 'elimine').length,
      ecartes: lignes.filter((l) => l.resultat === 'ecarte').length,
      fichiers: lignes.reduce((s, l) => s + (l.nb_fichiers || 0), 0),
      volume_octets: lignes.reduce((s, l) => s + (l.volume_octets || 0), 0),
      masques: lignes.filter((l) => l.masque).length,
    },
    actions: actionsPermises(b, user.id, droits),
  };
}

async function prochainNumero(run, tenantId) {
  const annee = new Date().getFullYear();
  const { rows } = await run.query(
    `INSERT INTO bordereaux_compteurs (tenant_id, annee, dernier) VALUES ($1, $2, 1)
     ON CONFLICT (tenant_id, annee) DO UPDATE SET dernier = bordereaux_compteurs.dernier + 1
     RETURNING dernier`, [tenantId, annee]);
  return `BE-${annee}-${String(rows[0].dernier).padStart(4, '0')}`;
}

/**
 * Inscrit des documents sur un bordereau en brouillon. Chaque refus est
 * motivé ; un document hors périmètre est dit « introuvable » (la restriction
 * n'annonce pas ce qu'elle protège).
 */
async function inscrire(c, tenantId, b, ids, lisible) {
  const liste = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!liste.length) return { ajoutes: [], refuses: [] };
  if (liste.length > 1000) throw erreur(400, 'Un bordereau compte au plus 1 000 documents par ajout.');
  // Verrou des documents : deux ajouts concurrents du même document se
  // sérialisent, le second voit le premier.
  await c.query('SELECT id FROM documents WHERE id = ANY($1::int[]) AND tenant_id = $2 ORDER BY id FOR UPDATE', [liste, tenantId]);
  const etats = await lireEcheances(c, tenantId, liste);
  let ordre = (await c.query('SELECT COALESCE(max(ordre), 0) AS o FROM bordereau_documents WHERE bordereau_id = $1', [b.id])).rows[0].o;
  const ajoutes = [];
  const refuses = [];
  for (const id of liste) {
    const r = etats.get(id);
    let motif = !r || !lisible(r.dossier_id) ? 'introuvable' : motifNonEligible(r, { bordereauId: b.id });
    if (!motif && Number(r.bordereau_id) === b.id) motif = 'deja_inscrit';
    if (motif) { refuses.push({ id, motif: motif === 'deja_inscrit' ? 'Déjà inscrit sur ce bordereau.' : MOTIFS[motif] }); continue; }
    ordre += 1;
    const { rows } = await c.query(
      'INSERT INTO bordereau_documents (bordereau_id, tenant_id, document_id, ordre) VALUES ($1, $2, $3, $4) RETURNING id',
      [b.id, tenantId, id, ordre]);
    await ecrireInstantane(c, rows[0].id, instantane(r, await fichiersDe(c, id)));
    ajoutes.push(id);
  }
  return { ajoutes, refuses };
}

async function creerBordereau(tenantId, { intitule, commentaire, document_ids: ids } = {}, user) {
  const titre = String(intitule || '').trim();
  if (titre.length > 200) throw erreur(400, 'Intitulé trop long (200 caractères au plus).');
  const lisible = await perimetre(tenantId, user.id);
  const qui = await integrite.identite(user);
  return transaction(async (c) => {
    const numero = await prochainNumero(c, tenantId);
    const { rows } = await c.query(
      `INSERT INTO bordereaux_elimination (tenant_id, numero, intitule, commentaire, created_by, created_by_nom)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [tenantId, numero, titre || `Bordereau d'élimination ${numero}`, String(commentaire || '').trim() || null, qui.id, qui.nom]);
    const b = rows[0];
    const r = await inscrire(c, tenantId, b, ids, lisible);
    await journaliser(c, { tenantId, qui, action: 'BORDEREAU_CREE', objectType: 'bordereau_elimination', objectId: b.id, details: { numero, documents: r.ajoutes.length } });
    return { bordereau: versBordereau(b), ...r };
  });
}

async function modifierBordereau(tenantId, id, { intitule, commentaire } = {}, user) {
  return transaction(async (c) => {
    const b = await chargerBordereau(c, tenantId, id, { verrou: true });
    if (b.statut !== 'brouillon') throw erreur(409, 'Seul un bordereau en brouillon se modifie.', 'STATUT_BORDEREAU');
    const titre = intitule === undefined ? b.intitule : String(intitule || '').trim();
    if (!titre) throw erreur(400, "L'intitulé est obligatoire.");
    if (titre.length > 200) throw erreur(400, 'Intitulé trop long (200 caractères au plus).');
    const { rows } = await c.query(
      'UPDATE bordereaux_elimination SET intitule = $2, commentaire = $3, updated_at = now() WHERE id = $1 RETURNING *',
      [b.id, titre, commentaire === undefined ? b.commentaire : (String(commentaire || '').trim() || null)]);
    void user;
    return versBordereau(rows[0]);
  });
}

async function ajouterDocuments(tenantId, id, ids, user) {
  const lisible = await perimetre(tenantId, user.id);
  return transaction(async (c) => {
    const b = await chargerBordereau(c, tenantId, id, { verrou: true });
    if (b.statut !== 'brouillon') throw erreur(409, 'Seul un bordereau en brouillon se complète.', 'STATUT_BORDEREAU');
    return inscrire(c, tenantId, b, ids, lisible);
  });
}

async function retirerDocument(tenantId, id, documentId, user) {
  const lisible = await perimetre(tenantId, user.id);
  return transaction(async (c) => {
    const b = await chargerBordereau(c, tenantId, id, { verrou: true });
    if (b.statut !== 'brouillon') throw erreur(409, 'Seul un bordereau en brouillon se modifie.', 'STATUT_BORDEREAU');
    const { rows } = await c.query(
      `SELECT l.id, d.dossier_id FROM bordereau_documents l LEFT JOIN documents d ON d.id = l.document_id
        WHERE l.bordereau_id = $1 AND l.document_id = $2`, [b.id, Number(documentId)]);
    if (!rows[0] || !lisible(rows[0].dossier_id)) throw erreur(404, 'Ce document ne figure pas sur le bordereau.');
    await c.query('DELETE FROM bordereau_documents WHERE id = $1', [rows[0].id]);
    return { retire: Number(documentId) };
  });
}

/** Le bordereau entier doit être lisible par qui le fait avancer. */
async function exigerPerimetreComplet(c, tenantId, b, user) {
  const lisible = await perimetre(tenantId, user.id);
  const lignes = await lignesDe(c, b.id);
  const hors = lignes.filter((l) => !lisible(l.dossier_actuel)).length;
  if (hors) {
    throw erreur(403, `Ce bordereau compte ${hors} document(s) hors de votre périmètre : un autre que vous doit le traiter.`, 'HORS_PERIMETRE');
  }
  return lignes;
}

/** Transition atomique : le statut attendu, ou 409 avec le statut réel. */
async function passer(c, b, attendu, sets, valeurs) {
  const { rows } = await c.query(
    `UPDATE bordereaux_elimination SET statut = $3, ${sets}, updated_at = now()
      WHERE id = $1 AND tenant_id = $2 AND statut = '${attendu}' RETURNING *`,
    [b.id, b.tenant_id, ...valeurs]);
  if (!rows[0]) throw erreur(409, 'Le bordereau a changé d\'état entre-temps : rechargez-le.', 'STATUT_BORDEREAU');
  return rows[0];
}

const exigerStatut = (b, statuts, message) => {
  if (!statuts.includes(b.statut)) throw erreur(409, message, 'STATUT_BORDEREAU', { statut: b.statut });
};

async function journaliserLignes(c, tenantId, qui, lignes, action, details) {
  for (const l of lignes) {
    if (l.document_id) await journaliser(c, { tenantId, qui, action, objectId: l.document_id, details });
  }
}

async function proposer(tenantId, id, user) {
  const qui = await integrite.identite(user);
  const b2 = await transaction(async (c) => {
    const b = await chargerBordereau(c, tenantId, id, { verrou: true });
    exigerStatut(b, ['brouillon'], 'Seul un bordereau en brouillon se propose.');
    const lignes = await exigerPerimetreComplet(c, tenantId, b, user);
    if (!lignes.length) throw erreur(400, 'Un bordereau vide ne se propose pas : ajoutez des documents.');
    // Ce que le valideur verra : l'éligibilité revérifiée, l'instantané rafraîchi.
    const etats = await lireEcheances(c, tenantId, lignes.filter((l) => l.document_id).map((l) => l.document_id));
    const bloquants = [];
    for (const l of lignes) {
      const motif = l.document_id ? motifNonEligible(etats.get(l.document_id), { bordereauId: b.id }) : 'absent';
      if (motif) bloquants.push({ document_id: l.document_id, reference: l.reference, motif: MOTIFS[motif] });
      else await ecrireInstantane(c, l.id, instantane(etats.get(l.document_id), await fichiersDe(c, l.document_id)));
    }
    if (bloquants.length) {
      throw erreur(409, `${bloquants.length} document(s) ne sont plus éliminables : retirez-les avant de proposer.`, 'LIGNES_NON_ELIGIBLES', { lignes: bloquants });
    }
    const reglages = await require('./settingsService').getAll(tenantId);
    const r = await passer(c, b, 'brouillon', 'propose_par = $4, propose_par_nom = $5, propose_at = now(), visa_requis = $6',
      ['propose', qui.id, qui.nom, reglages.elimination_visa_requis !== false]);
    await journaliser(c, { tenantId, qui, action: 'ELIMINATION_PROPOSEE', objectType: 'bordereau_elimination', objectId: b.id, details: { numero: b.numero, documents: lignes.length } });
    await journaliserLignes(c, tenantId, qui, lignes, 'ELIMINATION_PROPOSEE', { bordereau: b.numero });
    return r;
  });
  const valideurs = (await integrite.destinataires(tenantId, 'archives.validate'))
    .filter((u) => u !== Number(user.id) && u !== Number(b2.created_by));
  await notifier(tenantId, valideurs, {
    titre: `Bordereau d'élimination à valider : ${b2.numero}`,
    message: `${qui.nom} propose l'élimination « ${b2.intitule} ». À examiner dans Archivage › Éliminations.`,
  });
  return versBordereau(b2);
}

/** Valider ou rejeter : séparation des tâches, périmètre complet. */
async function statuer(tenantId, id, user, { valider, motif }) {
  const qui = await integrite.identite(user);
  const texte = String(motif || '').trim();
  if (!valider && !texte) throw erreur(400, 'Le rejet se motive : motif obligatoire.');
  if (texte.length > 2000) throw erreur(400, 'Motif trop long (2 000 caractères au plus).');
  const b2 = await transaction(async (c) => {
    const b = await chargerBordereau(c, tenantId, id, { verrou: true });
    exigerStatut(b, ['propose'], 'Seul un bordereau proposé se valide ou se rejette.');
    if ([b.created_by, b.propose_par].map(Number).includes(Number(user.id))) {
      throw erreur(403, 'Séparation des tâches : vous avez préparé ou proposé ce bordereau, un autre valideur doit statuer.', 'SEPARATION_DES_TACHES');
    }
    const lignes = await exigerPerimetreComplet(c, tenantId, b, user);
    const r = valider
      ? await passer(c, b, 'propose', 'valide_par = $4, valide_par_nom = $5, valide_at = now()', ['valide', qui.id, qui.nom])
      : await passer(c, b, 'propose', 'rejete_par = $4, rejete_par_nom = $5, rejete_at = now(), motif_rejet = $6', ['rejete', qui.id, qui.nom, texte]);
    const action = valider ? 'ELIMINATION_VALIDEE' : 'ELIMINATION_REJETEE';
    await journaliser(c, { tenantId, qui, action, objectType: 'bordereau_elimination', objectId: b.id, details: { numero: b.numero, motif: texte || null } });
    if (valider) await journaliserLignes(c, tenantId, qui, lignes, action, { bordereau: b.numero });
    return r;
  });
  await notifier(tenantId, [b2.propose_par], valider ? {
    titre: `Bordereau validé : ${b2.numero}`,
    message: b2.visa_requis
      ? `${qui.nom} a validé « ${b2.intitule} ». Transmettez-le à l'autorité d'archives pour visa (Archivage › Éliminations).`
      : `${qui.nom} a validé « ${b2.intitule} ». L'élimination peut être exécutée (Archivage › Éliminations).`,
  } : {
    titre: `Bordereau rejeté : ${b2.numero}`,
    message: `${qui.nom} a rejeté « ${b2.intitule} » : ${texte}`,
  });
  return versBordereau(b2);
}

async function retirerProposition(tenantId, id, user) {
  const qui = await integrite.identite(user);
  return transaction(async (c) => {
    const b = await chargerBordereau(c, tenantId, id, { verrou: true });
    exigerStatut(b, ['propose'], "Seul un bordereau proposé se retire.");
    const r = await passer(c, b, 'propose', 'propose_par = NULL, propose_par_nom = NULL, propose_at = NULL', ['brouillon']);
    await journaliser(c, { tenantId, qui, action: 'PROPOSITION_RETIREE', objectType: 'bordereau_elimination', objectId: b.id, details: { numero: b.numero } });
    return versBordereau(r);
  });
}

async function reprendre(tenantId, id, user) {
  const qui = await integrite.identite(user);
  return transaction(async (c) => {
    const b = await chargerBordereau(c, tenantId, id, { verrou: true });
    exigerStatut(b, ['rejete'], 'Seul un bordereau rejeté se reprend.');
    // Un visa refusé se reprend aussi : la prochaine transmission repart d'une page blanche.
    await c.query('UPDATE bordereau_documents SET exclu_visa = false WHERE bordereau_id = $1 AND exclu_visa', [b.id]);
    const r = await passer(c, b, 'rejete', `propose_par = NULL, propose_par_nom = NULL, propose_at = NULL,
      transmis_par = NULL, transmis_par_nom = NULL, transmis_at = NULL, visa_numero = NULL, visa_date = NULL, visa_decision = NULL,
      visa_observations = NULL, visa_piece_document_id = NULL, visa_saisi_par = NULL, visa_saisi_par_nom = NULL, visa_saisi_at = NULL`, ['brouillon']);
    await journaliser(c, { tenantId, qui, action: 'BORDEREAU_REPRIS', objectType: 'bordereau_elimination', objectId: b.id, details: { numero: b.numero } });
    return versBordereau(r);
  });
}

async function annuler(tenantId, id, { motif } = {}, user) {
  const qui = await integrite.identite(user);
  const texte = String(motif || '').trim().slice(0, 2000);
  return transaction(async (c) => {
    const b = await chargerBordereau(c, tenantId, id, { verrou: true });
    exigerStatut(b, ['brouillon', 'propose', 'rejete', 'valide', 'transmis', 'vise'], 'Ce bordereau ne s\'annule plus.');
    const r = await passer(c, b, b.statut, 'annule_par = $4, annule_par_nom = $5, annule_at = now(), motif_annulation = $6', ['annule', qui.id, qui.nom, texte || null]);
    await journaliser(c, { tenantId, qui, action: 'BORDEREAU_ANNULE', objectType: 'bordereau_elimination', objectId: b.id, details: { numero: b.numero, motif: texte || null } });
    return versBordereau(r);
  });
}

/**
 * TRANSMISSION à l'autorité d'archives (décret n° 2007-532, art. 44) : le
 * bordereau validé est imprimé et envoyé ; il ne bouge plus jusqu'au visa.
 */
async function transmettre(tenantId, id, user) {
  const qui = await integrite.identite(user);
  return transaction(async (c) => {
    const b = await chargerBordereau(c, tenantId, id, { verrou: true });
    exigerStatut(b, ['valide'], 'Seul un bordereau validé se transmet.');
    if (!b.visa_requis) throw erreur(409, "Ce bordereau a été proposé sans exigence de visa : il s'exécute directement.", 'VISA_NON_REQUIS');
    await exigerPerimetreComplet(c, tenantId, b, user);
    const reglages = await require('./settingsService').getAll(tenantId);
    const r = await passer(c, b, 'valide', 'transmis_par = $4, transmis_par_nom = $5, transmis_at = now(), visa_autorite = $6',
      ['transmis', qui.id, qui.nom, String(reglages.archives_autorite || '').trim().slice(0, 200) || 'Direction des Archives Nationales (DAN)']);
    await journaliser(c, { tenantId, qui, action: 'ELIMINATION_TRANSMISE', objectType: 'bordereau_elimination', objectId: b.id, details: { numero: b.numero, autorite: r.visa_autorite } });
    return versBordereau(r);
  });
}

/**
 * VISA reçu de l'autorité d'archives : enregistré tel qu'il est (numéro, date,
 * décision, observations, courrier scanné dans la GED). Un visa partiel exclut
 * des lignes, un refus rejette le bordereau.
 */
async function enregistrerVisa(tenantId, id, body = {}, user) {
  const qui = await integrite.identite(user);
  const decision = body.decision;
  if (!DECISIONS_VISA.includes(decision)) throw erreur(400, 'Décision attendue : visa accordé, partiel ou refusé.');
  const numero = String(body.numero || '').trim();
  if (!numero) throw erreur(400, 'Le numéro (référence) du visa est obligatoire.');
  if (numero.length > 100) throw erreur(400, 'Numéro de visa trop long (100 caractères au plus).');
  const date = String(body.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw erreur(400, 'Date du visa attendue (AAAA-MM-JJ).');
  if (date > jourDe(new Date())) throw erreur(400, 'La date du visa ne peut pas être dans le futur.');
  const observations = String(body.observations || '').trim();
  if (observations.length > 4000) throw erreur(400, 'Observations trop longues (4 000 caractères au plus).');
  if (decision === 'refuse' && !observations) throw erreur(400, 'Un refus de visa se motive : reportez les observations de l\'autorité.');
  const autorite = String(body.autorite || '').trim().slice(0, 200);
  const exclus = [...new Set((Array.isArray(body.exclus) ? body.exclus : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (decision === 'partiel' && !exclus.length) throw erreur(400, 'Un visa partiel désigne les documents que l\'autorité exclut de l\'élimination.');
  const piece = body.piece_document_id ? Number(body.piece_document_id) : null;
  const lisible = await perimetre(tenantId, user.id);
  const b2 = await transaction(async (c) => {
    const b = await chargerBordereau(c, tenantId, id, { verrou: true });
    exigerStatut(b, ['transmis'], "Seul un bordereau transmis à l'autorité reçoit son visa.");
    const lignes = await exigerPerimetreComplet(c, tenantId, b, user);
    if (piece) {
      const d = (await c.query('SELECT dossier_id FROM documents WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL', [piece, tenantId])).rows[0];
      if (!d || !lisible(d.dossier_id)) throw erreur(400, 'Pièce introuvable : versez d\'abord le courrier de visa dans la GED.');
    }
    if (decision === 'partiel') {
      const inscrits = new Set(lignes.map((l) => Number(l.document_id)));
      const inconnus = exclus.filter((d) => !inscrits.has(d));
      if (inconnus.length) throw erreur(400, 'Un document exclu ne figure pas sur ce bordereau.');
      if (exclus.length >= lignes.length) throw erreur(400, 'Tous les documents sont exclus : enregistrez un refus de visa.');
      await c.query('UPDATE bordereau_documents SET exclu_visa = true WHERE bordereau_id = $1 AND document_id = ANY($2::int[])', [b.id, exclus]);
    }
    const champs = `visa_numero = $4, visa_date = $5, visa_decision = $6, visa_observations = $7, visa_piece_document_id = $8,
                    visa_saisi_par = $9, visa_saisi_par_nom = $10, visa_saisi_at = now(), visa_autorite = COALESCE(NULLIF($11, ''), visa_autorite)`;
    const valeurs = [numero, date, decision, observations || null, piece, qui.id, qui.nom, autorite];
    const r = decision === 'refuse'
      ? await passer(c, b, 'transmis', `${champs}, rejete_par = $9, rejete_par_nom = $10, rejete_at = now(), motif_rejet = $12`,
        ['rejete', ...valeurs, `Visa refusé par ${autorite || b.visa_autorite || "l'autorité d'archives"} (n° ${numero}) : ${observations}`])
      : await passer(c, b, 'transmis', champs, ['vise', ...valeurs]);
    const action = decision === 'refuse' ? 'VISA_ELIMINATION_REFUSE' : 'VISA_ELIMINATION_ACCORDE';
    await journaliser(c, {
      tenantId, qui, action, objectType: 'bordereau_elimination', objectId: b.id,
      details: { numero: b.numero, visa: numero, date, decision, autorite: r.visa_autorite, exclus: decision === 'partiel' ? exclus : [] },
    });
    return r;
  });
  return versBordereau(b2);
}

/**
 * Relit chaque fichier avant sa destruction : l'empreinte constatée prouve
 * QUEL contenu a été détruit (et rattrape un fichier encore sans empreinte).
 */
async function constater(fichiers) {
  const constats = new Map();
  for (const f of fichiers) {
    const enregistree = f.empreinte_sha256 ? f.empreinte_sha256.trim() : null;
    try {
      const constatee = await integrite.empreinteStockee(f);
      let constat;
      if (constatee === null) constat = 'introuvable';
      else if (!enregistree) constat = 'calculee';
      else constat = constatee === enregistree ? 'intacte' : 'alteree';
      constats.set(f.id, { constatee, constat });
    } catch (err) {
      constats.set(f.id, { constatee: null, constat: 'illisible' });
    }
  }
  return constats;
}

/**
 * EXÉCUTION. Pour chaque ligne, dans un point de sauvegarde : éligibilité
 * revérifiée (échéance, sort, gel, décision), instantané final, destruction
 * en base, pierre tombale, traces. Un échec sur une ligne l'écarte sans
 * défaire les autres. Les binaires partent après le COMMIT.
 */
async function executer(tenantId, id, user, corps = {}) {
  const qui = await integrite.identite(user);
  // Décret n° 2007-532, art. 44 : destruction sur place, ou confiée à une
  // entreprise spécialisée, sous le contrôle de l'autorité d'archives.
  const mode = corps.mode_destruction || null;
  if (mode !== null && !MODES_DESTRUCTION.includes(mode)) throw erreur(400, 'Mode de destruction attendu : sur place ou par un prestataire.');
  const prestataire = String(corps.prestataire || '').trim().slice(0, 200) || null;
  if (mode === 'prestataire' && !prestataire) throw erreur(400, 'Nommez l\'entreprise chargée de la destruction.');
  const controle = String(corps.controle_par || '').trim().slice(0, 200) || null;
  // Lecture des fichiers AVANT la transaction (aucun verrou tenu pendant les E/S).
  const prealable = await chargerBordereau(db, tenantId, id);
  const attendu = prealable.visa_requis ? 'vise' : 'valide';
  exigerStatut(prealable, [attendu], prealable.visa_requis
    ? "L'élimination attend le visa de l'autorité d'archives (décret n° 2007-532, art. 44)."
    : 'Seul un bordereau validé s\'exécute.');
  if (prealable.visa_requis && !mode) throw erreur(400, 'Précisez le mode de destruction (sur place ou par un prestataire).');
  const avant = await lignesDe(db, prealable.id);
  const constats = new Map();
  for (const l of avant) {
    if (!l.document_id) continue;
    for (const [k, v] of await constater(await fichiersDe(db, l.document_id))) constats.set(k, v);
  }

  const binaires = [];
  const resultat = await transaction(async (c) => {
    const b = await chargerBordereau(c, tenantId, id, { verrou: true });
    exigerStatut(b, [attendu], "Le bordereau a changé d'état entre-temps : rechargez-le.");
    const lignes = await exigerPerimetreComplet(c, tenantId, b, user);
    const ids = lignes.filter((l) => l.document_id).map((l) => l.document_id);
    if (ids.length) await c.query('SELECT id FROM documents WHERE id = ANY($1::int[]) AND tenant_id = $2 ORDER BY id FOR UPDATE', [ids, tenantId]);
    const etats = ids.length ? await lireEcheances(c, tenantId, ids) : new Map();
    const elimines = [];
    const ecartes = [];
    for (const l of lignes) {
      const r = l.document_id ? etats.get(l.document_id) : null;
      const motif = l.exclu_visa ? 'exclu_visa' : (l.document_id ? motifNonEligible(r, { bordereauId: b.id, corbeilleAdmise: true }) : 'absent');
      if (motif) {
        await c.query("UPDATE bordereau_documents SET resultat = 'ecarte', motif_ecart = $2 WHERE id = $1", [l.id, MOTIFS[motif]]);
        ecartes.push({ document_id: l.document_id, reference: l.reference, motif: MOTIFS[motif] });
        continue;
      }
      await c.query('SAVEPOINT ligne');
      try {
        const fichiers = await fichiersDe(c, r.id);
        const s = instantane(r, fichiers, constats);
        await ecrireInstantane(c, l.id, s);
        // Copies du même binaire jointes à des demandes (livraison depuis la
        // GED, ou indexation d'une pièce jointe) : l'élimination détruit toutes
        // les copies que l'organisation détient ; la demande garde la trace.
        const noms = fichiers.map((f) => f.stored_name).filter(Boolean);
        const publics = fichiers.map((f) => f.cloudinary_public_id).filter(Boolean);
        const pj = (await c.query(
          `DELETE FROM request_files WHERE tenant_id = $1
              AND (stored_name = ANY($2::text[]) OR cloudinary_public_id = ANY($3::text[])
                   OR source_document_file_id = ANY($4::int[]))
           RETURNING request_id, original_name`,
          [tenantId, noms, publics, fichiers.map((f) => f.id)])).rows;
        for (const p of pj) {
          await c.query(
            `INSERT INTO request_history (tenant_id, request_id, user_id, action, comment, user_name)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [tenantId, p.request_id, qui.id, 'Pièce jointe retirée : document éliminé',
              `« ${p.original_name} » (${r.reference_mfile}) détruit par le bordereau ${b.numero}.`, (qui.nom || '').slice(0, 100)]);
        }
        await c.query('DELETE FROM document_files WHERE document_id = $1', [r.id]);
        await c.query('DELETE FROM metadata_values WHERE document_id = $1', [r.id]);
        await c.query('DELETE FROM document_extractions WHERE document_id = $1', [r.id]);
        await c.query('DELETE FROM document_relations WHERE source_document_id = $1 OR target_document_id = $1', [r.id]);
        // Pierre tombale : l'identifiant, la référence et le classement
        // restent ; le contenu descriptif part avec les fichiers.
        await c.query(
          `UPDATE documents SET elimine_at = now(), elimine_bordereau_id = $3,
                  deleted_at = COALESCE(deleted_at, now()), deleted_by = COALESCE(deleted_by, $4),
                  nom_entreprise = 'Document éliminé', description = NULL, tags = '{}', auteur = NULL,
                  contenu_texte = NULL, chemin_acces_numerique = NULL, est_numerise = false,
                  is_checked_out = false, checked_out_by = NULL, checked_out_at = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND tenant_id = $2`,
          [r.id, tenantId, b.id, qui.id]);
        await historique(c, r.id, user.id, `Éliminé — bordereau ${b.numero}`, `Échéance ${r.echeance} · ${s.nb_fichiers} fichier(s) détruit(s)`);
        await journaliser(c, {
          tenantId, qui, action: 'DOCUMENT_ELIMINE', objectId: r.id,
          details: { bordereau: b.numero, reference: r.reference_mfile, echeance: r.echeance, fichiers: s.fichiers.map((f) => ({ version: f.version, empreinte_sha256: f.empreinte_sha256 })) },
        });
        await c.query("UPDATE bordereau_documents SET resultat = 'elimine', motif_ecart = NULL, elimine_at = now() WHERE id = $1", [l.id]);
        await c.query('RELEASE SAVEPOINT ligne');
        for (const f of fichiers) binaires.push(f);
        elimines.push(r.id);
      } catch (err) {
        await c.query('ROLLBACK TO SAVEPOINT ligne');
        const m = integrite.estErreurGel(err) ? MOTIFS.gel_juridique : `Erreur : ${err.message}`.slice(0, 300);
        if (!integrite.estErreurGel(err)) console.error(`[archivage] élimination du document ${r.id} impossible :`, err);
        await c.query("UPDATE bordereau_documents SET resultat = 'ecarte', motif_ecart = $2 WHERE id = $1", [l.id, m]);
        ecartes.push({ document_id: l.document_id, reference: l.reference, motif: m });
      }
    }
    // Exécutant et date posés tant que le bordereau est encore « validé »
    // (modifiable), l'empreinte du PV calculée sur ces valeurs, puis statut et
    // empreinte posés ENSEMBLE : la base fige le bordereau dès qu'il est
    // « exécuté » (un UPDATE ultérieur échouerait et ferait avorter la
    // transaction entière).
    let fin = (await c.query(
      `UPDATE bordereaux_elimination SET execute_par = $2, execute_par_nom = $3, execute_at = now(),
              mode_destruction = $5, prestataire = $6, controle_par = $7
        WHERE id = $1 AND statut = $4 RETURNING *`, [b.id, qui.id, qui.nom, attendu, mode, mode === 'prestataire' ? prestataire : null, controle])).rows[0];
    const empreinte = empreintePv(fin, await lignesDe(c, b.id));
    fin = (await c.query("UPDATE bordereaux_elimination SET statut = 'execute', empreinte_pv = $2 WHERE id = $1 RETURNING *", [b.id, empreinte])).rows[0];
    await journaliser(c, {
      tenantId, qui, action: 'ELIMINATION_EXECUTEE', objectType: 'bordereau_elimination', objectId: b.id,
      details: { numero: b.numero, elimines: elimines.length, ecartes: ecartes.length, empreinte_pv: empreinte },
    });
    return { bordereau: versBordereau(fin), elimines, ecartes };
  });

  // Stockage APRÈS le commit. Un binaire encore référencé ailleurs (autre
  // document, demande) est épargné ; un échec est journalisé, jamais silencieux.
  const storage = require('./storageService');
  const echecs = [];
  for (const f of binaires) {
    const ailleurs = await db.query(
      `SELECT 1 FROM document_files WHERE stored_name = $1 OR ($2::text IS NOT NULL AND cloudinary_public_id = $2)
       UNION ALL SELECT 1 FROM request_files WHERE stored_name = $1 OR ($2::text IS NOT NULL AND cloudinary_public_id = $2) LIMIT 1`,
      [f.stored_name, f.cloudinary_public_id || null]);
    if (ailleurs.rowCount) continue;
    try {
      await storage.deleteFile({ storedName: f.stored_name, cloudinaryPublicId: f.cloudinary_public_id, resourceType: f.mime_type });
    } catch (err) {
      echecs.push({ fichier: f.original_name, erreur: err.message });
    }
  }
  if (echecs.length) {
    await journaliser(db, {
      tenantId, qui, action: 'ELIMINATION_STOCKAGE_ECHEC', objectType: 'bordereau_elimination', objectId: resultat.bordereau.id,
      details: { numero: resultat.bordereau.numero, echecs },
    }).catch((err) => console.error('[archivage] trace d\'échec de stockage impossible :', err.message));
  }
  try { require('./analyseService').planifierRecalcul(tenantId); } catch { /* conformité absente */ }
  const b = resultat.bordereau;
  await notifier(tenantId, [b.propose_par, b.valide_par].filter((u) => u && Number(u) !== Number(user.id)), {
    titre: `Élimination exécutée : ${b.numero}`,
    message: `${resultat.elimines.length} document(s) éliminé(s)${resultat.ecartes.length ? `, ${resultat.ecartes.length} écarté(s)` : ''}. Procès-verbal disponible dans Archivage › Éliminations.`,
  });
  return { ...resultat, stockage_echecs: echecs };
}

/** Organisation qui produit le bordereau (en-tête des pièces imprimées). */
async function organisationDe(tenantId) {
  const reglages = await require('./settingsService').getAll(tenantId);
  const t = await db.query('SELECT name FROM tenants WHERE id = $1', [tenantId]);
  return { nom: reglages.legal_entity || t.rows[0]?.name || null, adresse: reglages.legal_address || null, autorite: reglages.archives_autorite || null };
}

/** Procès-verbal d'un bordereau exécuté, empreinte recalculée et comparée. */
async function procesVerbal(tenantId, id, user) {
  const b = await chargerBordereau(db, tenantId, id);
  if (b.statut !== 'execute') throw erreur(409, "Le procès-verbal n'existe qu'une fois l'élimination exécutée.", 'STATUT_BORDEREAU');
  const lignes = await lignesDe(db, b.id);
  const calculee = empreintePv(b, lignes);
  const lisible = await perimetre(tenantId, user.id);
  const reglages = await require('./settingsService').getAll(tenantId);
  const t = await db.query('SELECT name FROM tenants WHERE id = $1', [tenantId]);
  const trace = await db.query(
    `SELECT chaine_rang, chaine_hash::text AS chaine_hash FROM audit_logs
      WHERE tenant_id = $1 AND action = 'ELIMINATION_EXECUTEE' AND object_type = 'bordereau_elimination' AND object_id = $2
      ORDER BY id LIMIT 1`, [tenantId, b.id]);
  const vues = lignes.map((l) => {
    const { dossier_actuel: d, ...reste } = l;
    return lisible(d) ? { ...reste, masque: false } : {
      ordre: l.ordre, masque: true, resultat: l.resultat, nb_fichiers: l.nb_fichiers, volume_octets: l.volume_octets,
    };
  });
  const elimines = lignes.filter((l) => l.resultat === 'elimine');
  return {
    organisation: reglages.legal_entity || t.rows[0]?.name || null,
    adresse: reglages.legal_address || null,
    bordereau: versBordereau(b),
    lignes: vues,
    totaux: {
      elimines: elimines.length,
      ecartes: lignes.filter((l) => l.resultat === 'ecarte').length,
      fichiers: elimines.reduce((s, l) => s + l.nb_fichiers, 0),
      volume_octets: elimines.reduce((s, l) => s + l.volume_octets, 0),
      masques: vues.filter((l) => l.masque).length,
    },
    empreinte: { enregistree: b.empreinte_pv ? String(b.empreinte_pv).trim() : null, calculee, conforme: b.empreinte_pv ? String(b.empreinte_pv).trim() === calculee : null },
    journal: trace.rows[0] ? { rang: Number(trace.rows[0].chaine_rang), empreinte: trace.rows[0].chaine_hash } : null,
    edite_at: new Date().toISOString(),
  };
}

module.exports = {
  POINTS_DEPART, SORTS, STATUTS_BORDEREAU, MOTIFS, LIBELLES_SORT, LIBELLES_POINT_DEPART,
  ajouterAnnees, departDua, calculerEcheance, validerRegle, intituleDe, motifNonEligible, actionsPermises, corpsPv, empreintePv,
  migrationPassee, definirDua, vueSortFinal, echeanceDocument, decider, annulerDecision,
  listerBordereaux, detailBordereau, creerBordereau, modifierBordereau, ajouterDocuments, retirerDocument,
  proposer, valider: (t, id, u) => statuer(t, id, u, { valider: true }), rejeter: (t, id, u, motif) => statuer(t, id, u, { valider: false, motif }),
  retirerProposition, reprendre, annuler, executer, procesVerbal, transmettre, enregistrerVisa,
  DECISIONS_VISA, MODES_DESTRUCTION,
  // Pour versementService : mêmes échéances, mêmes instantanés, même journal.
  internes: { organisationDe, lireEcheances, fichiersDe, instantane, perimetre, journaliser, historique, notifier, transaction, erreur, jourDe },
};
