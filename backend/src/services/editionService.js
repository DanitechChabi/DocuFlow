// ============================================================================
// editionService — applique les préréglages d'une édition dédiée (AFGC…) à
// l'espace de l'organisation : motifs de demande, types de dossier,
// départements.
//
// L'application FUSIONNE, elle n'écrase pas :
//  - les motifs et les types de l'édition viennent en tête, dans son ordre ;
//    une valeur déjà présente sous une forme voisine (« Soldes créditeurs »
//    pour « Solde créditeur ») est gardée telle quelle, pour que les demandes
//    déjà faites restent rattachées à leur motif ;
//  - les valeurs ajoutées par l'organisation suivent ; seules disparaissent
//    les valeurs génériques livrées avec DocuFlow (« Radiation », « Statuts »…) ;
//  - les départements manquants sont ajoutés ; les sections génériques de
//    DocuFlow (DGI, DNCMP…) sont retirées si aucun compte ne s'y rattache.
// Idempotente : l'appliquer deux fois ne change plus rien.
// ============================================================================
const db = require('../config/db');
const catalog = require('../config/settingsCatalog');
const settingsService = require('./settingsService');
const listeService = require('./listeService');
const { DEFAULT_SECTIONS } = require('./tenantProvisioningService');
const { EDITIONS } = require('../config/editions');

function erreur(statut, message) {
  const e = new Error(message);
  e.statut = statut;
  return e;
}

function trouver(cle) {
  const edition = EDITIONS[String(cle || '').trim().toLowerCase()];
  if (!edition) throw erreur(400, `Édition inconnue : « ${cle || ''} ».`);
  return edition;
}

/** Forme comparable : sans accents ni casse, chaque mot sans marque du pluriel. */
const plat = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').map((m) => (m.length > 2 ? m.replace(/[sx]$/, '') : m)).join(' ');

/** Valeurs livrées par défaut avec DocuFlow pour un réglage de liste. */
function valeursParDefaut(cle) {
  try { return JSON.parse(catalog.BY_KEY.get(cle).default).map((o) => o.value); } catch { return []; }
}

/**
 * Liste de l'édition, complétée des valeurs propres à l'organisation.
 * @param {string[]} voulues valeurs de l'édition, dans l'ordre voulu
 * @param {{value: string, label: string}[]} existantes réglage actuel
 * @param {string[]} generiques valeurs livrées avec DocuFlow
 */
function fusionner(voulues, existantes, generiques) {
  const reste = [...existantes];
  const reprendre = (v) => {
    const i = reste.findIndex((o) => plat(o.value) === plat(v) || plat(o.label) === plat(v));
    return i < 0 ? null : reste.splice(i, 1)[0];
  };
  const tete = voulues.map((v) => {
    const o = reprendre(v);
    return o ? { value: o.value, label: o.label || o.value } : { value: v, label: v };
  });
  const aRetirer = new Set(generiques.map(plat));
  return [...tete, ...reste.filter((o) => !aRetirer.has(plat(o.value))).map((o) => ({ value: o.value, label: o.label || o.value }))];
}

const manquantes = (voulues, presentes) => {
  const p = new Set(presentes.flatMap((o) => (typeof o === 'string' ? [o] : [o.value, o.label])).map(plat));
  return voulues.filter((v) => !p.has(plat(v)));
};

const traceApplication = (edition) => `A appliqué la configuration ${edition.nom}`;

/**
 * Ce qui manque à l'espace pour l'édition, et si sa configuration a déjà été
 * appliquée (l'accueil ne la propose qu'une fois).
 */
async function etat(tenantId, cle) {
  const edition = trouver(cle);
  const [motifs, types, sections, trace] = await Promise.all([
    listeService.cadresAdmis(tenantId),
    listeService.typesAdmis(tenantId),
    db.query('SELECT name FROM sections WHERE tenant_id = $1', [tenantId]),
    db.query('SELECT 1 FROM audit_logs WHERE tenant_id = $1 AND action LIKE $2 LIMIT 1', [tenantId, `${traceApplication(edition)}%`]),
  ]);
  return {
    edition: String(cle).trim().toLowerCase(),
    nom: edition.nom,
    appliquee: trace.rowCount > 0,
    attendus: { motifs: edition.motifs.length, types: edition.types.length, departements: edition.departements.length },
    manquants: {
      motifs: manquantes(edition.motifs, motifs).length,
      types: manquantes(edition.types, types).length,
      departements: manquantes(edition.departements, sections.rows.map((r) => r.name)).length,
    },
  };
}

/**
 * @returns {Promise<{ edition: string, motifs: number, types: number, departements_ajoutes: number, sections_retirees: number }>}
 */
async function appliquer(tenantId, user, cle) {
  const edition = trouver(cle);
  const [motifsActuels, typesActuels] = await Promise.all([listeService.cadresAdmis(tenantId), listeService.typesAdmis(tenantId)]);

  // Motifs et types : fusionnés (voir plus haut). Autres réglages de
  // l'édition : posés seulement s'ils sont absents — un choix de
  // l'administrateur (domaine d'adresse, création des départements…) reste.
  const reglages = [
    ['request_motifs', fusionner(edition.motifs, motifsActuels, valeursParDefaut('request_motifs')), false],
    ['request_document_types', fusionner(edition.types, typesActuels, valeursParDefaut('request_document_types')), false],
    ...Object.entries(edition.reglages || {}).map(([cle, valeur]) => [cle, valeur, true]),
  ].map(([cleReglage, valeur, siAbsent]) => {
    const definition = catalog.BY_KEY.get(cleReglage);
    if (!definition) throw erreur(500, `Réglage absent du catalogue : ${cleReglage}.`);
    return [cleReglage, catalog.coerce(definition, valeur), Array.isArray(valeur) ? valeur.length : 1, siAbsent];
  });

  const client = await db.pool.connect();
  let ajoutes = 0;
  let retirees = 0;
  try {
    await client.query('BEGIN');
    for (const [cleReglage, valeur, , siAbsent] of reglages) {
      await client.query(
        `INSERT INTO settings (tenant_id, key, value) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, key) DO ${siAbsent ? 'NOTHING' : 'UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP'}`,
        [tenantId, cleReglage, typeof valeur === 'string' ? valeur : JSON.stringify(valeur)]
      );
    }
    for (const nom of edition.departements) {
      const r = await client.query(
        `INSERT INTO sections (tenant_id, name) SELECT $1, $2::varchar
          WHERE NOT EXISTS (SELECT 1 FROM sections WHERE tenant_id = $1 AND lower(name) = lower($2::varchar))
         RETURNING id`,
        [tenantId, nom]
      );
      ajoutes += r.rowCount;
    }
    // Sections génériques de DocuFlow que personne n'utilise : elles
    // encombreraient le choix du département à l'inscription.
    const generiques = DEFAULT_SECTIONS.filter((s) => !edition.departements.some((d) => d.toLowerCase() === s.toLowerCase()));
    retirees = (await client.query(
      `DELETE FROM sections s
        WHERE s.tenant_id = $1 AND s.name = ANY($2::text[])
          AND NOT EXISTS (SELECT 1 FROM users u WHERE u.tenant_id = $1 AND lower(COALESCE(u.section, '')) = lower(s.name))`,
      [tenantId, generiques]
    )).rowCount;
    await client.query(
      'INSERT INTO audit_logs (id_user, action, request_id, tenant_id) VALUES ($1, $2, NULL, $3)',
      [user.id, `${traceApplication(edition)} : ${reglages[0][2]} motifs, ${reglages[1][2]} types de dossier, ${ajoutes} département(s) ajouté(s)`.slice(0, 500), tenantId]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  settingsService.invalidate(tenantId);
  return {
    edition: String(cle).trim().toLowerCase(),
    motifs: reglages[0][2],
    types: reglages[1][2],
    departements_ajoutes: ajoutes,
    sections_retirees: retirees,
  };
}

module.exports = { appliquer, etat, fusionner, plat };
