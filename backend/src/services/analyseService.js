// ============================================================================
// analyseService — l'étage ARGENT : ce que l'analyse a lu dans chaque document.
//
// Pour un document dont le texte est disponible (couche texte ou OCR) :
//   1. lecture par règles (extractionRegles) — toujours, gratuite et locale ;
//   2. lecture par modèle de langage si l'organisation en a configuré un
//      (llmService) — ses valeurs priment, les règles comblent ses trous ;
//   3. nature : la classe du document (« Facture fournisseur » → facture) si
//      elle porte un rôle, sinon ce que l'analyse a reconnu ;
//   4. enregistrement dans document_extractions, puis recalcul des contrôles
//      de l'organisation (conformiteService).
//
// Un échec du modèle n'empêche jamais l'analyse : l'erreur est notée, les
// règles ont servi, le document est contrôlé comme les autres.
//
// PLANIFICATION. Après l'enregistrement du texte d'un fichier (contentIndex
// Service) l'analyse est mise en file : un délai court (le texte est écrit
// dans une transaction qui doit d'abord être validée), un seul document à la
// fois (un modèle local ne tient pas la charge), et un recalcul des contrôles
// regroupé après la dernière analyse. La file ne démarre qu'avec le serveur
// (demarrerAnalyse) : les tests et les scripts n'y sont jamais mêlés.
// ============================================================================
const db = require('../config/db');
const settingsService = require('./settingsService');
const llmService = require('./llmService');
const { extraireParRegles } = require('./extractionRegles');
const { referentiel } = require('../config/conformite');

const DELAI_ANALYSE_MS = 3000;
const DELAI_RECALCUL_MS = 6000;
const TEXTE_MINIMAL = 20; // en deçà, rien à lire

let tablesPromesse = null;
/** La migration 030 est-elle passée ? Vérifié une fois (comme les autres 0xx). */
function migrationPassee() {
  if (!tablesPromesse) {
    tablesPromesse = db.query("SELECT to_regclass('document_extractions') IS NOT NULL AS ok")
      .then((r) => r.rows[0].ok).catch(() => { tablesPromesse = null; return false; });
  }
  return tablesPromesse;
}

const vide = (v) => v === null || v === undefined || v === '';

/**
 * Fusion règles + modèle : le modèle prime champ par champ, les règles
 * comblent ce qu'il n'a pas rendu. Les identifiants « déclarés » (ce qui est
 * écrit dans le document, même mal formé) viennent des règles : c'est du
 * texte lu tel quel, pas une interprétation.
 */
function fusionner(regles, llm) {
  if (!llm) return { ...regles };
  const donnees = { ...regles.donnees };
  for (const [cle, valeur] of Object.entries(llm.donnees)) {
    if (cle === 'identifiant_declare' || cle === 'etablissement_declare') {
      if (vide(donnees[cle]) && !vide(valeur)) donnees[cle] = valeur;
      continue;
    }
    if (!vide(valeur)) donnees[cle] = valeur;
  }
  return { nature: llm.nature !== 'autre' || regles.nature === 'autre' ? llm.nature : regles.nature, confiance: llm.confiance, donnees };
}

/**
 * Analyse un document et enregistre le résultat.
 * @returns {Promise<null | { id, nature, confiance, source, modele, donnees, erreur, analyse_at }>}
 *          null : document absent ou sans texte à lire (pas d'enregistrement,
 *          pour qu'un scan encore en cours d'OCR soit repris ensuite)
 */
async function analyserDocument(tenantId, documentId, { recalculer = true } = {}) {
  if (!(await migrationPassee())) return null;
  const { rows } = await db.query(
    `SELECT d.id, d.contenu_texte, d.classe_id, c.nature_conformite
       FROM documents d LEFT JOIN metadata_schemas c ON c.id = d.classe_id AND c.tenant_id = d.tenant_id
      WHERE d.id = $1 AND d.tenant_id = $2 AND d.deleted_at IS NULL`,
    [documentId, tenantId]
  );
  const doc = rows[0];
  if (!doc || String(doc.contenu_texte || '').trim().length < TEXTE_MINIMAL) return null;

  const reglages = await settingsService.getAll(tenantId);
  const ref = referentiel(reglages.conformite_pays);
  const regles = extraireParRegles(doc.contenu_texte, { referentiel: ref });

  let llm = null;
  let erreur = null;
  const cfg = await llmService.configuration(tenantId);
  if (cfg.pret) {
    try {
      llm = await llmService.analyser(tenantId, doc.contenu_texte, { referentiel: ref, cfg });
    } catch (err) {
      erreur = String(err.message || err).slice(0, 500);
      console.warn(`[analyse] document ${documentId} : modèle indisponible (${erreur})`);
    }
  }

  const fusion = fusionner(regles, llm);
  // La CLASSE fait foi (comme dans M-Files) : un document classé « Facture
  // fournisseur » est une facture ; classé « Arrêté » ou « Demande
  // d'attestation », il n'entre dans aucun contrôle, quoi qu'en dise la
  // lecture. Seuls les documents sans classe sont reconnus automatiquement.
  const nature = doc.classe_id ? (doc.nature_conformite || 'autre') : fusion.nature;
  const source = llm ? 'llm' : 'regles';
  const modele = llm ? llm.modele : null;

  const r = await db.query(
    `INSERT INTO document_extractions (tenant_id, document_id, nature, confiance, source, modele, donnees, erreur, analyse_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (document_id) DO UPDATE
       SET nature = EXCLUDED.nature, confiance = EXCLUDED.confiance, source = EXCLUDED.source, modele = EXCLUDED.modele,
           donnees = EXCLUDED.donnees, erreur = EXCLUDED.erreur, analyse_at = now()
     RETURNING id, nature, confiance, source, modele, donnees, erreur, analyse_at`,
    [tenantId, documentId, nature, fusion.confiance, source, modele, JSON.stringify(fusion.donnees), erreur]
  );
  if (recalculer) planifierRecalcul(tenantId);
  return r.rows[0];
}

/** Analyse enregistrée d'un document (ou null). */
async function extractionDe(tenantId, documentId) {
  if (!(await migrationPassee())) return null;
  const { rows } = await db.query(
    `SELECT id, nature, confiance, source, modele, donnees, erreur, analyse_at
       FROM document_extractions WHERE tenant_id = $1 AND document_id = $2`,
    [tenantId, documentId]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// File d'analyse
// ---------------------------------------------------------------------------
let actif = false;          // vrai une fois demarrerAnalyse() appelé (le serveur)
const delais = new Map();   // "tenant:doc" → minuterie (anti-rebond par document)
const file = [];            // [{ tenantId, documentId }]
let enCours = false;
const recalculs = new Map(); // tenantId → minuterie

function planifierRecalcul(tenantId) {
  if (!actif) return;
  clearTimeout(recalculs.get(tenantId));
  const t = setTimeout(async () => {
    recalculs.delete(tenantId);
    try {
      await require('./conformiteService').recalculer(tenantId);
    } catch (err) {
      console.warn(`[conformite] recalcul impossible (organisation ${tenantId}) : ${err.message}`);
    }
  }, DELAI_RECALCUL_MS);
  t.unref?.();
  recalculs.set(tenantId, t);
}

async function vider() {
  if (enCours) return;
  enCours = true;
  try {
    while (file.length) {
      const { tenantId, documentId } = file.shift();
      try {
        await analyserDocument(tenantId, documentId);
      } catch (err) {
        console.warn(`[analyse] document ${documentId} : ${err.message}`);
      }
    }
  } finally {
    enCours = false;
  }
}

/**
 * Met un document en file d'analyse (anti-rebond : plusieurs écritures de
 * texte rapprochées — versions, OCR — ne donnent qu'une analyse). Sans effet
 * tant que le serveur n'a pas démarré la file, ou si l'organisation a
 * désactivé l'analyse automatique.
 */
function planifier(tenantId, documentId, delai = DELAI_ANALYSE_MS) {
  if (!actif) return;
  const cle = `${tenantId}:${documentId}`;
  clearTimeout(delais.get(cle));
  const t = setTimeout(async () => {
    delais.delete(cle);
    try {
      if (!(await settingsService.get(tenantId, 'conformite_active', true))) return;
    } catch { /* réglage illisible : on analyse */ }
    if (!file.some((x) => x.tenantId === tenantId && x.documentId === documentId)) file.push({ tenantId, documentId });
    vider();
  }, delai);
  t.unref?.();
  delais.set(cle, t);
}

/** Documents lisibles jamais analysés (ou à refaire) — par lots. */
async function documentsAAnalyser({ tenantId = null, forcer = false, lot = 10 } = {}) {
  if (!(await migrationPassee())) return [];
  const { rows } = await db.query(
    `SELECT d.id, d.tenant_id FROM documents d
       LEFT JOIN document_extractions e ON e.document_id = d.id
      WHERE d.deleted_at IS NULL
        AND length(btrim(coalesce(d.contenu_texte, ''))) >= $1
        AND ($2::int IS NULL OR d.tenant_id = $2)
        AND ($3::boolean OR e.id IS NULL)
        AND NOT EXISTS (SELECT 1 FROM settings s WHERE s.tenant_id = d.tenant_id AND s.key = 'conformite_active' AND s.value = 'false')
      ORDER BY d.id DESC LIMIT $4`,
    [TEXTE_MINIMAL, tenantId, forcer, lot]
  );
  return rows;
}

/**
 * Relance l'analyse de tous les documents d'une organisation (action
 * « Relancer l'analyse »). Renvoie le nombre de documents mis en file ; le
 * traitement se fait en arrière-plan, un à la fois.
 */
async function analyserTout(tenantId) {
  const { rows } = await db.query(
    `SELECT id FROM documents WHERE tenant_id = $1 AND deleted_at IS NULL
        AND length(btrim(coalesce(contenu_texte, ''))) >= $2 ORDER BY id DESC LIMIT 5000`,
    [tenantId, TEXTE_MINIMAL]
  );
  for (const r of rows) {
    if (!file.some((x) => x.tenantId === tenantId && x.documentId === r.id)) file.push({ tenantId, documentId: r.id });
  }
  if (rows.length) { actif = true; vider(); }
  return rows.length;
}

/**
 * Démarre l'analyse en arrière-plan : active la file, puis rattrape par lots
 * les documents jamais analysés (versés avant la migration 030 ou pendant une
 * panne). Un lot toutes les 2 minutes tant qu'il reste du travail, puis une
 * vérification toutes les 30 minutes. Ne retient pas le processus.
 */
function demarrerAnalyse() {
  actif = true;
  let delai = 60000;
  const tour = async () => {
    try {
      const lot = await documentsAAnalyser();
      for (const d of lot) await analyserDocument(d.tenant_id, d.id, { recalculer: false });
      for (const t of new Set(lot.map((d) => d.tenant_id))) planifierRecalcul(t);
      if (lot.length) console.log(`[analyse] ${lot.length} document(s) analysé(s) en rattrapage`);
      delai = lot.length ? 120000 : 30 * 60000;
    } catch (err) {
      console.warn('[analyse] rattrapage différé :', err.message);
      delai = 10 * 60000;
    }
    setTimeout(tour, delai).unref?.();
  };
  setTimeout(tour, delai).unref?.();
}

module.exports = {
  analyserDocument, extractionDe, fusionner, planifier, planifierRecalcul, analyserTout, demarrerAnalyse,
  documentsAAnalyser, migrationPassee,
};
