// ============================================================================
// gedMatchService — le document demandé est-il déjà dans la GED ?
//
// Pour une demande (ou une saisie en cours), cherche les documents de
// l'organisation qui y correspondent et leur donne un score de 0 à 100,
// avec les raisons, lisibles par l'archiviste :
//
//   n° de dossier ET n° d'acte identiques ........ 100 (certain)
//   n° de dossier identique ....................... 55
//   n° d'acte identique ........................... 45
//   nom proche (similarité trigramme ≥ 0,35) ...... jusqu'à 30
//   mots de la description retrouvés .............. jusqu'à 50 (70 si la
//     description compte au moins 4 mots significatifs), selon la part de ces
//     mots présents dans la référence, la description, les tags ou le
//     CONTENU du document (index plein texte, 027)
//   même année / même type ........................ +5 / +5
//
// Score plafonné à 100. En dessous de SEUIL_CANDIDAT, rien n'est proposé : un
// candidat faible noie les bons et fait perdre du temps.
//
// CONFIDENTIALITÉ — la règle de la GED tient ici :
//   * l'archiviste ne voit que les documents des dossiers qu'il peut lire
//     (ACL de dossier, migration 022) ;
//   * le demandeur n'obtient qu'un indicateur (« probablement disponible »),
//     calculé sur les seuls documents hors dossiers restreints — jamais le
//     document, ni même sa référence.
// ============================================================================
const db = require('../config/db');
const aclService = require('./aclService');

const SEUIL_CANDIDAT = 35;
const SEUIL_PROBABLE = 60;
const MAX_CANDIDATS = 5;
const POIDS_CONTENU = 50;
const POIDS_CONTENU_RICHE = 70;
// Valeurs de repli posées sur un document « à indexer » (versement en masse,
// livraison d'une demande rapide) : elles ne désignent rien et ne doivent
// rien faire correspondre.
const REPLIS = ['à indexer', 'a indexer'];

const texte = (v) => (v === undefined || v === null ? '' : String(v).trim());

/** Critères de recherche tirés d'une demande ou d'une saisie. Fonction pure. */
function criteres(source = {}) {
  const c = {
    description: texte(source.description).slice(0, 2000),
    nom: texte(source.nom_entreprise).slice(0, 255),
    dossier: texte(source.num_dossier).slice(0, 50),
    acte: texte(source.num_acte).slice(0, 50),
    annee: /^\d{4}$/.test(texte(source.annee)) ? Number(source.annee) : null,
    type: texte(source.type_document).slice(0, 100),
  };
  for (const k of ['nom', 'dossier', 'acte']) if (REPLIS.includes(c[k].toLowerCase())) c[k] = '';
  // Texte libre : la description, plus le nom (souvent présent dans le contenu).
  c.libre = [c.description, c.nom].filter(Boolean).join(' ');
  return c;
}

/** Y a-t-il de quoi chercher ? Fonction pure. */
function chercheable(c) {
  return Boolean(c.dossier || c.acte || c.nom.length >= 3 || c.libre.length >= 8);
}

/**
 * Candidats triés par score décroissant.
 * @param {number} tenantId
 * @param {object} source  demande ou saisie (description, nom_entreprise…)
 * @param {object} [opts]  { dossiersLisibles: Set|null — null = aucun filtre ACL,
 *                           horsRestreints: boolean, limite }
 */
async function chercher(tenantId, source, { dossiersLisibles = null, limite = MAX_CANDIDATS } = {}) {
  const c = criteres(source);
  if (!chercheable(c)) return [];

  // L'année et le type se comparent en JavaScript, sur les candidats.
  const params = [tenantId, c.dossier, c.acte, c.nom, c.libre];
  let bornes = '';
  if (dossiersLisibles) {
    const ids = [...dossiersLisibles];
    params.push(ids);
    bornes = `AND (d.dossier_id IS NULL OR d.dossier_id = ANY($${params.length}::int[]))`;
  }

  // Lexèmes significatifs de la saisie (dictionnaire français : « signé » →
  // « sign », mots vides retirés). La requête en OU retrouve les documents
  // qui en partagent au moins un ; la couverture (part des lexèmes présents
  // dans le document) mesure ensuite la ressemblance.
  const r = await db.query(
    `WITH q AS (
       SELECT tsvector_to_array(to_tsvector('french', $5::text)) AS lexemes
     ), qq AS (
       SELECT lexemes,
              CASE WHEN cardinality(lexemes) > 0
                   THEN array_to_string(ARRAY(SELECT quote_literal(l) FROM unnest(lexemes) l), ' | ')::tsquery
              END AS tsq
         FROM q
     ), candidats AS (
       SELECT d.id, d.reference_mfile, d.nom_entreprise, d.num_dossier, d.num_acte, d.annee, d.type_document,
              d.description, d.dossier_id, d.statut, d.search_vector,
              ($2::text <> '' AND lower(d.num_dossier) = lower($2::text)) AS meme_dossier,
              ($3::text <> '' AND lower(d.num_acte) = lower($3::text)) AS meme_acte,
              CASE WHEN $4::text <> '' THEN similarity(lower(d.nom_entreprise), lower($4::text)) ELSE 0 END AS sim_nom
         FROM documents d, qq
        WHERE d.tenant_id = $1 AND d.deleted_at IS NULL ${bornes}
          AND (
               ($2 <> '' AND lower(d.num_dossier) = lower($2))
            OR ($3 <> '' AND lower(d.num_acte) = lower($3))
            OR ($4 <> '' AND lower(d.nom_entreprise) % lower($4))
            OR (qq.tsq IS NOT NULL AND d.search_vector @@ qq.tsq)
          )
        ORDER BY (qq.tsq IS NOT NULL AND d.search_vector @@ qq.tsq) DESC,
                 ts_rank_cd(d.search_vector, COALESCE(qq.tsq, ''::tsquery)) DESC
        LIMIT 200
     )
     SELECT c.*, qq.lexemes,
            (SELECT count(*) FROM unnest(qq.lexemes) l WHERE l = ANY(tsvector_to_array(c.search_vector)))::int AS lexemes_trouves
       FROM candidats c, qq`,
    params
  );

  const resultats = r.rows.map((d) => {
    const raisons = [];
    let score = 0;
    if (d.meme_dossier && d.meme_acte) {
      score = 100;
      raisons.push('N° de dossier et n° d\'acte identiques');
    } else {
      if (d.meme_dossier) { score += 55; raisons.push('N° de dossier identique'); }
      if (d.meme_acte) { score += 45; raisons.push('N° d\'acte identique'); }
    }
    const sim = Number(d.sim_nom) || 0;
    if (sim >= 0.35) {
      score += Math.round(Math.min(1, sim) * 30);
      raisons.push(sim >= 0.9 ? 'Même nom' : `Nom proche (« ${d.nom_entreprise} »)`);
    }
    const total = (d.lexemes || []).length;
    if (total >= 2 && d.lexemes_trouves > 0) {
      const couverture = d.lexemes_trouves / total;
      // Une description riche (≥ 4 mots significatifs) entièrement retrouvée
      // vaut une quasi-certitude ; deux ou trois mots, un simple indice.
      score += Math.round(couverture * (total >= 4 ? POIDS_CONTENU_RICHE : POIDS_CONTENU));
      raisons.push(`${d.lexemes_trouves} mot${d.lexemes_trouves > 1 ? 's' : ''} sur ${total} retrouvé${d.lexemes_trouves > 1 ? 's' : ''} dans le document`);
    }
    if (c.annee && d.annee === c.annee) { score += 5; raisons.push('Même année'); }
    if (c.type && d.type_document === c.type) { score += 5; raisons.push('Même type'); }
    return {
      document_id: d.id,
      reference: d.reference_mfile,
      nom_entreprise: d.nom_entreprise,
      num_dossier: d.num_dossier,
      num_acte: d.num_acte,
      annee: d.annee,
      type_document: d.type_document,
      description: d.description,
      dossier_id: d.dossier_id,
      statut: d.statut,
      score: Math.min(100, score),
      raisons,
    };
  });

  return resultats
    .filter((x) => x.score >= SEUIL_CANDIDAT)
    .sort((a, b) => b.score - a.score || b.document_id - a.document_id)
    .slice(0, limite);
}

/** Candidats visibles d'un membre de l'archive (ACL de dossier appliquées). */
async function candidatsPour(tenantId, user, source) {
  const { lisibles } = await aclService.dossiersAccessibles(tenantId, user.id);
  return chercher(tenantId, source, { dossiersLisibles: lisibles });
}

/**
 * Indicateur pour le demandeur : un document correspondant existe-t-il
 * probablement ? Calculé hors dossiers restreints (sauf ceux qu'il peut lire),
 * pour ne rien laisser deviner de ce qui lui est fermé.
 */
async function indicateurPour(tenantId, user, source) {
  const { lisibles } = await aclService.dossiersAccessibles(tenantId, user.id);
  const [meilleur] = await chercher(tenantId, source, { dossiersLisibles: lisibles, limite: 1 });
  return { probable: Boolean(meilleur && meilleur.score >= SEUIL_PROBABLE) };
}

/**
 * Meilleur score pour une demande, enregistré sur la demande (badge des
 * listes). Sur tous les documents de l'organisation : c'est une indication
 * pour l'archive, pas un accès. Ne lève jamais : la recherche automatique ne
 * doit pas faire échouer une création de demande.
 * @returns {Promise<number|null>}
 */
async function noterDemande(tenantId, request) {
  try {
    const [meilleur] = await chercher(tenantId, request, { limite: 1 });
    const score = meilleur ? meilleur.score : 0;
    await db.query('UPDATE requests SET ged_score = $1 WHERE id = $2 AND tenant_id = $3', [score, request.id, tenantId]);
    return score;
  } catch (err) {
    if (!['42703', '42P01', '42883'].includes(err.code)) {
      console.error('[ged-match] score non calculé :', err.message);
    }
    return null;
  }
}

module.exports = {
  SEUIL_CANDIDAT, SEUIL_PROBABLE, criteres, chercheable, chercher, candidatsPour, indicateurPour, noterDemande,
};
