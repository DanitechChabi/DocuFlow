// ============================================================================
// conformiteService — l'étage OR : les incohérences ENTRE documents.
//
// Un document seul est rarement faux ; c'est la comparaison qui trahit. Ce
// service rapproche les analyses (document_extractions) et lève une alerte
// quand elles se contredisent :
//
//   identifiant_format      numéro d'entreprise mal formé (haute)
//   identifiant_incoherent  un même émetteur, deux numéros — usurpation
//                           possible (critique). Les couples facture /
//                           attestation sont comparés en priorité.
//   montant_incoherent      facture hors tolérance du devis correspondant (haute)
//   date_incoherente        facture antérieure à son devis (moyenne)
//   attestation_expiree     attestation dont l'échéance est dépassée (haute)
//   + les contrôles au registre officiel (registreOfficielService), si activés.
//
// `detecterIncoherences` est PURE (enregistrements → alertes) : c'est ce que
// les tests éprouvent règle par règle. `recalculer` la branche sur la base :
// les alertes sont stockées avec une empreinte stable, de sorte qu'une alerte
// déjà traitée ou ignorée par un humain le reste au recalcul suivant, et
// qu'une alerte qui n'a plus lieu d'être (document corrigé, supprimé) passe
// d'elle-même à « résolue ».
// ============================================================================
const crypto = require('crypto');
const db = require('../config/db');
const settingsService = require('./settingsService');
const aclService = require('./aclService');
const { referentiel, ORDRE_SEVERITE, TYPES_ALERTE, TOLERANCE_MONTANT_DEFAUT } = require('../config/conformite');
const { alerte, cleNom } = require('./alerteFabrique');

const nombre = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const estIso = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

function formaterMontant(n, devise) {
  const t = Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 }).replace(/ | /g, ' ');
  return `${t} ${devise === 'EUR' ? '€' : devise === 'USD' ? '$' : 'FCFA'}`;
}

/** Regroupe par émetteur (nom normalisé) ; les documents sans émetteur sont écartés. */
function parEmetteur(enregs) {
  const groupes = new Map();
  for (const e of enregs) {
    const k = cleNom(e.donnees?.emetteur_nom);
    if (!k) continue;
    if (!groupes.has(k)) groupes.set(k, { nom: e.donnees.emetteur_nom, docs: [] });
    groupes.get(k).docs.push(e);
  }
  return groupes;
}

/**
 * Deux documents du même émetteur relèvent-ils d'une même affaire ? Quand les
 * deux nomment leur destinataire, ce doit être le même — évite de comparer
 * le devis d'un client à la facture d'un autre.
 */
function memeContexte(a, b) {
  const da = cleNom(a.donnees?.destinataire_nom);
  const db_ = cleNom(b.donnees?.destinataire_nom);
  return da && db_ ? da === db_ : true;
}

const nomDoc = (e) => e.nom || `document n° ${e.id}`;

function controlerFormatIdentifiant(enregs, ref) {
  const alertes = [];
  if (!ref.principal) return alertes;
  for (const e of enregs) {
    const d = e.donnees || {};
    const verifs = [
      [ref.principal, d.identifiant_declare, 'identifiant'],
      [ref.etablissement, d.etablissement_declare, 'etablissement'],
    ];
    for (const [def, declare, champ] of verifs) {
      if (!def || !declare || declare.length === def.longueur) continue;
      alertes.push(alerte('identifiant_format', 'haute',
        `${def.nom} « ${declare} » invalide dans « ${nomDoc(e)} » (${def.longueur} chiffres attendus, ${declare.length} lus).`,
        [e.id], champ, declare, null, `Vérifier le numéro ${def.nom} sur le document source.`));
    }
  }
  return alertes;
}

function controlerCoherenceIdentifiant(enregs, ref) {
  const alertes = [];
  if (!ref.principal) return alertes;
  // Le plus précis des deux identifiants disponibles : l'établissement s'il existe.
  const discriminant = (e) => e.donnees?.etablissement || e.donnees?.identifiant || null;
  const nom = ref.etablissement ? ref.etablissement.nom : ref.principal.nom;
  for (const [, groupe] of parEmetteur(enregs)) {
    const avec = groupe.docs.map((e) => ({ e, id: discriminant(e) })).filter((x) => x.id);
    if (avec.length < 2) continue;
    const factures = avec.filter((x) => x.e.nature === 'facture');
    const attestations = avec.filter((x) => x.e.nature === 'attestation');
    const vus = new Set();
    for (const f of factures) {
      for (const a of attestations) {
        if (!memeContexte(f.e, a.e)) continue;
        const cle = [f.e.id, a.e.id].sort((x, y) => x - y).join('-');
        if (vus.has(cle)) continue;
        vus.add(cle);
        if (f.id !== a.id) {
          alertes.push(alerte('identifiant_incoherent', 'critique',
            `${nom} incohérent entre facture et attestation pour l'émetteur « ${groupe.nom} » : ${f.id} contre ${a.id}.`,
            [f.e.id, a.e.id], 'identifiant', f.id, a.id,
            "Vérifier l'identité légale de l'émetteur : l'un des deux documents est peut-être falsifié."));
        }
      }
    }
    if (!factures.length || !attestations.length) {
      const distincts = [...new Set(avec.map((x) => x.id))].sort();
      if (distincts.length > 1) {
        alertes.push(alerte('identifiant_incoherent', 'critique',
          `${nom} incohérent pour l'émetteur « ${groupe.nom} » : ${distincts[0]} contre ${distincts[1]}.`,
          avec.map((x) => x.e.id), 'identifiant', distincts[0], distincts[1],
          "Vérifier l'identité légale de l'émetteur."));
      }
    }
  }
  return alertes;
}

function controlerMontants(enregs, tolerancePct) {
  const alertes = [];
  for (const [, groupe] of parEmetteur(enregs)) {
    const devis = groupe.docs.filter((e) => e.nature === 'devis' && nombre(e.donnees.montant_ttc) !== null);
    const factures = groupe.docs.filter((e) => e.nature === 'facture' && nombre(e.donnees.montant_ttc) !== null);
    for (const d of devis) {
      for (const f of factures) {
        if (!memeContexte(d, f)) continue;
        const ttcD = nombre(d.donnees.montant_ttc);
        const ttcF = nombre(f.donnees.montant_ttc);
        const ecart = Math.abs(ttcD - ttcF);
        if (ecart > Math.abs(ttcD) * (tolerancePct / 100)) {
          const devise = f.donnees.devise || d.donnees.devise;
          alertes.push(alerte('montant_incoherent', 'haute',
            `Le montant TTC du devis (${formaterMontant(ttcD, devise)}) diffère de la facture (${formaterMontant(ttcF, devise)}) pour « ${groupe.nom} » : écart de ${formaterMontant(ecart, devise)}, au-delà de ${tolerancePct} %.`,
            [d.id, f.id], 'montant_ttc', ttcD, ttcF,
            'Vérifier si un avenant ou une modification de commande justifie cet écart.'));
        }
      }
    }
  }
  return alertes;
}

function controlerChronologie(enregs) {
  const alertes = [];
  for (const [, groupe] of parEmetteur(enregs)) {
    const devis = groupe.docs.filter((e) => e.nature === 'devis' && estIso(e.donnees.date_emission));
    const factures = groupe.docs.filter((e) => e.nature === 'facture' && estIso(e.donnees.date_emission));
    for (const d of devis) {
      for (const f of factures) {
        if (!memeContexte(d, f)) continue;
        if (f.donnees.date_emission < d.donnees.date_emission) {
          alertes.push(alerte('date_incoherente', 'moyenne',
            `La facture (${f.donnees.date_emission}) est antérieure au devis (${d.donnees.date_emission}) pour « ${groupe.nom} ».`,
            [d.id, f.id], 'date_emission', d.donnees.date_emission, f.donnees.date_emission,
            'Une facture ne peut pas précéder le devis qu\'elle honore.'));
        }
      }
    }
  }
  return alertes;
}

function controlerAttestations(enregs, aujourdhui) {
  const alertes = [];
  for (const e of enregs) {
    if (e.nature !== 'attestation' || !estIso(e.donnees?.date_echeance)) continue;
    if (e.donnees.date_echeance < aujourdhui) {
      alertes.push(alerte('attestation_expiree', 'haute',
        `Attestation expirée : « ${nomDoc(e)} » était valable jusqu'au ${e.donnees.date_echeance}.`,
        [e.id], 'date_echeance', e.donnees.date_echeance, aujourdhui,
        'Demander une attestation à jour au fournisseur.'));
    }
  }
  return alertes;
}

/**
 * Toutes les alertes d'un ensemble de documents analysés. Fonction pure.
 * @param {Array<{ id, nom?, nature, donnees }>} enregs
 * @param {{ referentiel?: object, tolerance?: number, aujourdhui?: string }} [opts]
 */
function detecterIncoherences(enregs, { referentiel: ref = referentiel('bj'), tolerance = TOLERANCE_MONTANT_DEFAUT, aujourdhui = new Date().toISOString().slice(0, 10) } = {}) {
  const alertes = [
    ...controlerFormatIdentifiant(enregs, ref),
    ...controlerCoherenceIdentifiant(enregs, ref),
    ...controlerMontants(enregs, tolerance),
    ...controlerChronologie(enregs),
    ...controlerAttestations(enregs, aujourdhui),
  ];
  return alertes.sort((a, b) => (ORDRE_SEVERITE[a.severite] ?? 9) - (ORDRE_SEVERITE[b.severite] ?? 9));
}

// ---------------------------------------------------------------------------
// Base de données
// ---------------------------------------------------------------------------

/** Documents analysés de l'organisation, au format des règles. */
async function chargerEnregistrements(tenantId) {
  const { rows } = await db.query(
    `SELECT d.id, d.reference_mfile, d.description, d.dossier_id, d.classe_id, e.nature, e.donnees, c.nature_conformite
       FROM document_extractions e
       JOIN documents d ON d.id = e.document_id AND d.tenant_id = e.tenant_id
       LEFT JOIN metadata_schemas c ON c.id = d.classe_id AND c.tenant_id = d.tenant_id
      WHERE e.tenant_id = $1 AND d.deleted_at IS NULL`,
    [tenantId]
  );
  return rows.map((r) => ({
    id: r.id,
    nom: (r.description && r.description !== 'À indexer' ? r.description : r.reference_mfile) || null,
    dossierId: r.dossier_id,
    // La classe fait foi (voir analyseService) — relu ici : la classe d'un
    // document a pu changer depuis son analyse.
    nature: r.classe_id ? (r.nature_conformite || 'autre') : r.nature,
    donnees: r.donnees || {},
  }));
}

/**
 * Recalcule les alertes de l'organisation et les enregistre.
 * @param {object} [opts] { registre: function(enregs, ctx) → alertes } injectable (tests)
 * @returns {Promise<{ documents, detectees, ouvertes, resolues }>}
 */
async function recalculer(tenantId, { registre = null } = {}) {
  const reglages = await settingsService.getAll(tenantId);
  const ref = referentiel(reglages.conformite_pays);
  const enregs = await chargerEnregistrements(tenantId);
  let alertes = detecterIncoherences(enregs, { referentiel: ref, tolerance: Number(reglages.conformite_tolerance_montant) });

  // Registre officiel : réseau, donc isolé — une panne ne doit pas effacer
  // les contrôles locaux ni résoudre à tort les alertes du registre.
  let registreExecute = false;
  if (reglages.conformite_verifier_registre && ref.registre) {
    try {
      const controle = registre || require('./registreOfficielService').controler;
      alertes = alertes.concat(await controle(enregs, { referentiel: ref }));
      registreExecute = true;
    } catch (err) {
      console.warn(`[conformite] registre officiel indisponible : ${err.message}`);
    }
  }

  const client = await db.pool.connect();
  let resolues = 0;
  try {
    await client.query('BEGIN');
    const empreintes = [];
    for (const a of alertes) {
      empreintes.push(a.empreinte);
      await client.query(
        `INSERT INTO compliance_alerts (tenant_id, empreinte, type, severite, description, document_ids, champ, valeur_a, valeur_b, suggestion)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (tenant_id, empreinte) DO UPDATE
           SET description = EXCLUDED.description, severite = EXCLUDED.severite, suggestion = EXCLUDED.suggestion,
               mise_a_jour_at = now(),
               -- Une alerte résolue qui réapparaît se rouvre ; traitée / ignorée, elle reste telle.
               statut = CASE WHEN compliance_alerts.statut = 'resolue' THEN 'ouverte' ELSE compliance_alerts.statut END`,
        [tenantId, a.empreinte, a.type, a.severite, a.description, a.documentIds, a.champ, a.valeurA, a.valeurB, a.suggestion]
      );
    }
    // Ouvertes qui ne sont plus détectées : résolues d'elles-mêmes. Les alertes
    // du registre ne sont touchées que si le registre a répondu.
    const typesRegistre = ['registre_introuvable', 'registre_ferme', 'nom_incoherent', 'adresse_incoherente'];
    const r = await client.query(
      `UPDATE compliance_alerts SET statut = 'resolue', mise_a_jour_at = now()
        WHERE tenant_id = $1 AND statut = 'ouverte' AND NOT (empreinte = ANY($2::varchar[]))
          AND ($3::boolean OR NOT (type = ANY($4::varchar[])))`,
      [tenantId, empreintes, registreExecute || !reglages.conformite_verifier_registre, typesRegistre]
    );
    resolues = r.rowCount;
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  const { rows } = await db.query("SELECT COUNT(*)::int AS n FROM compliance_alerts WHERE tenant_id = $1 AND statut = 'ouverte'", [tenantId]);
  return { documents: enregs.length, detectees: alertes.length, ouvertes: rows[0].n, resolues };
}

/**
 * Documents que l'utilisateur peut lire : pas de dossier, ou un dossier de
 * son périmètre. Une alerte n'est montrée que si TOUS ses documents le sont —
 * sa description cite leurs noms et leurs montants.
 */
async function documentsVisibles(tenantId, user) {
  const { visibles } = await aclService.dossiersAccessibles(tenantId, user.id);
  const { rows } = await db.query(
    'SELECT id, dossier_id FROM documents WHERE tenant_id = $1 AND deleted_at IS NULL', [tenantId]);
  return new Set(rows.filter((r) => r.dossier_id === null || visibles.has(r.dossier_id)).map((r) => r.id));
}

function versApi(r) {
  return {
    id: r.id, type: r.type, type_libelle: TYPES_ALERTE[r.type] || r.type, severite: r.severite,
    description: r.description, document_ids: r.document_ids, champ: r.champ,
    valeur_a: r.valeur_a, valeur_b: r.valeur_b, suggestion: r.suggestion,
    statut: r.statut, note: r.note, traite_at: r.traite_at, detectee_at: r.detectee_at,
  };
}

/** Alertes visibles par l'utilisateur, filtrées, les plus graves d'abord. */
async function listerAlertes(tenantId, user, { severite = null, type = null, statut = 'ouverte', documentId = null } = {}) {
  const visibles = await documentsVisibles(tenantId, user);
  const { rows } = await db.query(
    `SELECT * FROM compliance_alerts
      WHERE tenant_id = $1
        AND ($2::text IS NULL OR severite = $2) AND ($3::text IS NULL OR type = $3)
        AND ($4::text IS NULL OR $4 = 'toutes' OR statut = $4)
        AND ($5::int IS NULL OR $5 = ANY(document_ids))
      ORDER BY CASE severite WHEN 'critique' THEN 0 WHEN 'haute' THEN 1 WHEN 'moyenne' THEN 2 ELSE 3 END, detectee_at DESC`,
    [tenantId, severite, type, statut, documentId]
  );
  return rows.filter((r) => r.document_ids.every((id) => visibles.has(id))).map(versApi);
}

/** Chiffres du tableau de bord, sur ce que l'utilisateur peut voir. */
async function tableauDeBord(tenantId, user) {
  const visibles = await documentsVisibles(tenantId, user);
  const analyses = await db.query(
    `SELECT e.document_id, e.nature, e.source FROM document_extractions e
       JOIN documents d ON d.id = e.document_id AND d.deleted_at IS NULL
      WHERE e.tenant_id = $1`, [tenantId]);
  const docs = analyses.rows.filter((r) => visibles.has(r.document_id));
  const ouvertes = await listerAlertes(tenantId, user, { statut: 'ouverte' });
  const concernes = new Set(ouvertes.flatMap((a) => a.document_ids));
  const total = docs.length;
  const nonConformes = docs.filter((d) => concernes.has(d.document_id)).length;
  const compte = (s) => ouvertes.filter((a) => a.severite === s).length;
  const attente = await db.query(
    `SELECT COUNT(*)::int AS n FROM documents d LEFT JOIN document_extractions e ON e.document_id = d.id
      WHERE d.tenant_id = $1 AND d.deleted_at IS NULL AND e.id IS NULL
        AND length(btrim(coalesce(d.contenu_texte, ''))) >= 20`, [tenantId]);
  const parNature = {};
  for (const d of docs) parNature[d.nature] = (parNature[d.nature] || 0) + 1;
  return {
    total_documents: total,
    documents_conformes: total - nonConformes,
    documents_non_conformes: nonConformes,
    taux_conformite: total ? Math.round(((total - nonConformes) / total) * 1000) / 10 : 100,
    alertes_critiques: compte('critique'),
    alertes_hautes: compte('haute'),
    alertes_moyennes: compte('moyenne'),
    alertes_faibles: compte('faible'),
    alertes_totales: ouvertes.length,
    documents_en_attente: attente.rows[0].n,
    par_nature: parNature,
    analyses_par_ia: docs.filter((d) => d.source === 'llm').length,
  };
}

/**
 * Traite une alerte : ouverte / traitée / ignorée, avec une note.
 * @returns {Promise<object|null>} l'alerte, ou null si introuvable ou hors périmètre
 */
async function changerStatut(tenantId, alerteId, user, { statut, note = null }) {
  if (!['ouverte', 'traitee', 'ignoree'].includes(statut)) {
    const e = new Error('Statut attendu : ouverte, traitee ou ignoree.');
    e.statut = 400;
    throw e;
  }
  const visibles = await documentsVisibles(tenantId, user);
  const { rows } = await db.query('SELECT document_ids FROM compliance_alerts WHERE id = $1 AND tenant_id = $2', [alerteId, tenantId]);
  if (!rows[0] || !rows[0].document_ids.every((id) => visibles.has(id))) return null;
  const r = await db.query(
    `UPDATE compliance_alerts
        SET statut = $3::varchar, note = $4, traite_par = $5, traite_at = CASE WHEN $3::varchar = 'ouverte' THEN NULL ELSE now() END, mise_a_jour_at = now()
      WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [alerteId, tenantId, statut, note ? String(note).slice(0, 1000) : null, user.id]
  );
  return versApi(r.rows[0]);
}

module.exports = {
  detecterIncoherences, recalculer, listerAlertes, tableauDeBord, changerStatut,
  chargerEnregistrements, documentsVisibles, cleNom, formaterMontant,
};
