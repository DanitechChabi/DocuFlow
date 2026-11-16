// ============================================================================
// douchetteService — sorties et retours à la douchette (053).
//
// Chaque dossier entré porte une étiquette à code-barres (Code 128) :
// « D0001234 », son numéro dans dossiers_entres. La douchette tape ce code
// comme un clavier, suivi d'Entrée. Le scan dit tout de suite :
//   - si le dossier est SORTI : chez qui, depuis quand → « Retourné » ;
//   - sinon, les demandes EN ATTENTE qui le visent (même n° d'acte, ou même
//     nom) → « Transmettre à … ».
// Un n° d'acte tapé à la main (« 2479 », « 2025/2479 ») marche aussi.
// Le prêt créé à la douchette garde le dossier scanné : le retour le
// retrouve sans rien chercher.
// ============================================================================
const db = require('../config/db');
const loanService = require('./loanService');
const entreeService = require('./entreeService');
const { ARMOIRE_SQL } = require('./rangementService');

function erreur(statut, message) {
  const e = new Error(message);
  e.statut = statut;
  return e;
}

/** Code de l'étiquette d'un dossier entré : « D0001234 ». */
const codeDe = (id) => `D${String(id).padStart(7, '0')}`;

/** N° de dossier entré lu dans un code d'étiquette, ou null. */
function lireCode(saisie) {
  const m = /^D0*(\d{1,9})$/i.exec(String(saisie || '').trim());
  return m ? Number(m[1]) : null;
}

const SEUIL_NOM = 0.6;

async function dossierPar(tenantId, id) {
  const r = await db.query(
    `SELECT d.id, to_char(d.date_point, 'YYYY-MM-DD') AS date_point, to_char(d.semaine, 'YYYY-MM-DD') AS semaine,
            to_char(d.semaine + 6, 'YYYY-MM-DD') AS au, d.num_actes, d.actes, d.denomination, d.lettre, d.type_garantie,
            ${ARMOIRE_SQL('d')} AS armoire
       FROM dossiers_entres d WHERE d.tenant_id = $1 AND d.id = $2`,
    [tenantId, id]
  );
  return r.rows[0] ? { ...r.rows[0], code: codeDe(r.rows[0].id) } : null;
}

/** Les demandes ouvertes (sans prêt) ou les prêts en cours qui visent ce dossier. */
async function correspondances(tenantId, dossier) {
  const nom = entreeService.nomSimple(dossier.denomination);
  const actes = new Set(dossier.actes || []);
  const r = await db.query(
    `SELECT r.id, r.nom_entreprise, r.num_dossier, r.num_acte, r.annee, r.type_document, r.motif, r.statut, r.created_at,
            u.full_name AS requester_name, u.section,
            p.id AS pret_id, p.remis_at, to_char(p.date_retour_prevue, 'YYYY-MM-DD') AS date_retour_prevue, p.dossier_entre_id,
            CASE WHEN $3::text = '' THEN 0 ELSE similarity(
              trim(regexp_replace(translate(lower(COALESCE(r.nom_entreprise, '')), 'àáâäãéèêëíîïóôöõúùûüçñ', 'aaaaaeeeeiiioooouuuucn'), '[^a-z0-9]+', ' ', 'g')),
              $3::text) END AS sim
       FROM requests r
       JOIN users u ON u.id = r.id_user
       LEFT JOIN request_loans p ON p.request_id = r.id
      WHERE r.tenant_id = $1
        AND ((p.id IS NULL AND r.statut IN ('en attente', 'a traiter'))
          OR (p.id IS NOT NULL AND p.retourne_at IS NULL))
        AND (p.dossier_entre_id IS NULL OR p.dossier_entre_id = $2)`,
    [tenantId, dossier.id, nom]
  );
  const vise = (x) => {
    if (x.dossier_entre_id === dossier.id) return 3; // sorti à la douchette avec CE dossier
    const numeros = entreeService.acteDemande(x.num_acte).numeros;
    if (numeros.length) return numeros.some((n) => actes.has(n)) ? 2 : 0; // un acte qui ne correspond pas : autre dossier
    const n = entreeService.nomSimple(x.nom_entreprise);
    return n && nom && (n.includes(nom) || nom.includes(n) || Number(x.sim) >= SEUIL_NOM) ? 1 : 0;
  };
  const lignes = r.rows.map((x) => ({ ...x, force: vise(x) })).filter((x) => x.force > 0)
    .map(({ sim: _s, ...x }) => x)
    .sort((a, b) => b.force - a.force || new Date(a.created_at) - new Date(b.created_at));
  return {
    sorties: lignes.filter((x) => x.pret_id),
    demandes: lignes.filter((x) => !x.pret_id),
  };
}

/**
 * Lecture d'un scan (ou d'un n° d'acte tapé) : le dossier, ses sorties en
 * cours, les demandes qui l'attendent. Plusieurs dossiers pour un n° d'acte
 * tapé : la liste, pour choisir.
 */
async function lire(tenantId, saisie) {
  const s = String(saisie || '').trim();
  if (!s) throw erreur(400, 'Scannez une étiquette ou tapez un n° d\'acte.');
  const id = lireCode(s);
  if (id) {
    const dossier = await dossierPar(tenantId, id);
    if (!dossier) throw erreur(404, `Étiquette ${s.toUpperCase()} inconnue : ce dossier n'est pas (ou plus) dans l'entrée des dossiers.`);
    return { dossier, ...(await correspondances(tenantId, dossier)) };
  }
  if (!/^(?:(?:19|20)\d{2}\s*\/\s*)?\d+$/.test(s)) throw erreur(400, 'Code non reconnu : scannez une étiquette « D… » ou tapez un n° d\'acte.');
  const trouves = (await entreeService.rechercher(tenantId, { q: s })).slice(0, 20);
  if (!trouves.length) throw erreur(404, `Aucun dossier entré avec l'acte ${s}.`);
  if (trouves.length > 1) {
    return { choix: trouves.map((d) => ({ ...d, code: codeDe(d.id) })) };
  }
  const dossier = await dossierPar(tenantId, trouves[0].id);
  return { dossier, ...(await correspondances(tenantId, dossier)) };
}

/** Transmet la demande avec le dossier scanné (prêt + lien vers le dossier). */
async function sortir(tenantId, user, { dossier_entre_id: dossierId, request_id: requestId, date_retour_prevue } = {}) {
  const dossier = await dossierPar(tenantId, Number(dossierId));
  if (!dossier) throw erreur(404, 'Dossier introuvable.');
  const { demandes } = await correspondances(tenantId, dossier);
  if (!demandes.some((d) => d.id === Number(requestId))) throw erreur(409, 'Cette demande ne vise pas ce dossier, ou elle a déjà été servie.');
  const res = await loanService.remettre(tenantId, Number(requestId), user, { date_retour_prevue, observation: `Sorti à la douchette (${dossier.code})` });
  await db.query('UPDATE request_loans SET dossier_entre_id = $1 WHERE request_id = $2 AND tenant_id = $3', [dossier.id, Number(requestId), tenantId]);
  return { ...res, dossier };
}

/** Note le retour d'un dossier sorti. */
async function rentrer(tenantId, user, { request_id: requestId } = {}) {
  return loanService.retourner(tenantId, Number(requestId), user, { observation: 'Retour à la douchette' });
}

module.exports = { codeDe, lireCode, lire, sortir, rentrer };
