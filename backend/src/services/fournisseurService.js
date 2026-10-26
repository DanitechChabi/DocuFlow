// ============================================================================
// fournisseurService — la fiche des fournisseurs (CRM) tirée des analyses.
//
// Les documents analysés sont regroupés par TIERS, avec une clé composite :
//   « id:<numéro> »   l'identifiant d'entreprise est connu (IFU, SIREN) —
//                     le regroupement le plus fiable, il traverse les graphies
//                     du nom (« SBEE », « S.B.E.E. SA ») ;
//   « nom:<nom> »     à défaut, le nom normalisé ;
//   « inconnu »       ni l'un ni l'autre.
// Le tiers est l'émetteur du document ; à défaut son destinataire (un acte
// administratif délivré à une entreprise la désigne comme destinataire).
//
// Pour chaque fournisseur : nombre de documents, total TTC (devis exclus : un
// devis n'est pas une dépense), natures présentes, alertes ouvertes, et la
// liste de ses documents.
// ============================================================================
const db = require('../config/db');
const conformiteService = require('./conformiteService');

const PREFIXE_ID = 'id:';
const PREFIXE_NOM = 'nom:';
const INCONNU = 'inconnu';

function cleFournisseur(donnees = {}) {
  const id = donnees.identifiant || donnees.etablissement;
  if (id) return `${PREFIXE_ID}${String(id).slice(0, donnees.identifiant ? 20 : 9)}`;
  const nom = conformiteService.cleNom(donnees.emetteur_nom || donnees.destinataire_nom);
  return nom ? `${PREFIXE_NOM}${nom}` : INCONNU;
}

const typeGroupe = (cle) => (cle.startsWith(PREFIXE_ID) ? 'identifiant' : cle.startsWith(PREFIXE_NOM) ? 'nom' : 'inconnu');

/** Documents analysés que l'utilisateur peut lire, avec leurs alertes ouvertes. */
async function charger(tenantId, user) {
  const visibles = await conformiteService.documentsVisibles(tenantId, user);
  const { rows } = await db.query(
    `SELECT d.id, d.reference_mfile, d.description, d.statut, d.created_at, e.nature, e.donnees, e.source
       FROM document_extractions e JOIN documents d ON d.id = e.document_id AND d.tenant_id = e.tenant_id
      WHERE e.tenant_id = $1 AND d.deleted_at IS NULL ORDER BY d.created_at DESC`, [tenantId]);
  const alertes = await conformiteService.listerAlertes(tenantId, user, { statut: 'ouverte' });
  const alertesParDoc = new Map();
  for (const a of alertes) for (const id of a.document_ids) alertesParDoc.set(id, (alertesParDoc.get(id) || 0) + 1);
  return rows.filter((r) => visibles.has(r.id)).map((r) => ({
    id: r.id,
    reference: r.reference_mfile,
    titre: r.description && r.description !== 'À indexer' ? r.description : r.reference_mfile,
    statut: r.statut,
    nature: r.nature,
    donnees: r.donnees || {},
    alertes: alertesParDoc.get(r.id) || 0,
    cree_le: r.created_at,
  }));
}

/**
 * Clé finale de chaque document. Un document sans identifiant rejoint le
 * fournisseur du MÊME nom qui en a un — s'il n'y en a qu'un : deux numéros
 * pour un même nom, c'est précisément ce que la conformité signale, on ne
 * tranche pas à sa place.
 */
function resoudreCles(docs) {
  const parNom = new Map(); // nom normalisé → clés « id: » rencontrées
  for (const d of docs) {
    const cle = cleFournisseur(d.donnees);
    if (!cle.startsWith(PREFIXE_ID)) continue;
    const nom = conformiteService.cleNom(d.donnees.emetteur_nom || d.donnees.destinataire_nom);
    if (!nom) continue;
    if (!parNom.has(nom)) parNom.set(nom, new Set());
    parNom.get(nom).add(cle);
  }
  const cles = new Map();
  for (const d of docs) {
    let cle = cleFournisseur(d.donnees);
    if (cle.startsWith(PREFIXE_NOM)) {
      const ids = parNom.get(cle.slice(PREFIXE_NOM.length));
      if (ids && ids.size === 1) cle = [...ids][0];
    }
    cles.set(d.id, cle);
  }
  return cles;
}

/** Liste des fournisseurs. */
async function lister(tenantId, user) {
  const docs = await charger(tenantId, user);
  const cles = resoudreCles(docs);
  const fiches = new Map();
  for (const d of docs) {
    const cle = cles.get(d.id);
    const nom = (d.donnees.emetteur_nom || d.donnees.destinataire_nom || '').trim() || 'Tiers inconnu';
    let f = fiches.get(cle);
    if (!f) {
      f = { cle, groupe: typeGroupe(cle), identifiant: cle.startsWith(PREFIXE_ID) ? cle.slice(PREFIXE_ID.length) : null, nom, nombre_documents: 0, total_ttc: 0, a_des_alertes: false, nombre_alertes: 0, natures: new Set(), devise: d.donnees.devise || null };
      fiches.set(cle, f);
    } else if (f.nom === 'Tiers inconnu' && nom !== 'Tiers inconnu') f.nom = nom;
    f.nombre_documents += 1;
    // Un devis n'est pas une dépense : il n'entre pas dans le total.
    if (d.nature !== 'devis' && d.donnees.montant_ttc) f.total_ttc += Number(d.donnees.montant_ttc);
    if (d.alertes) { f.a_des_alertes = true; f.nombre_alertes += d.alertes; }
    f.natures.add(d.nature);
    if (!f.devise && d.donnees.devise) f.devise = d.donnees.devise;
  }
  const ordre = { identifiant: 0, nom: 1, inconnu: 2 };
  return [...fiches.values()]
    .map((f) => ({ ...f, total_ttc: Math.round(f.total_ttc * 100) / 100, natures: [...f.natures] }))
    .sort((a, b) => ordre[a.groupe] - ordre[b.groupe] || a.nom.localeCompare(b.nom, 'fr'));
}

/** Documents d'un fournisseur, les plus récents d'abord. */
async function documentsDe(tenantId, user, cle) {
  const docs = await charger(tenantId, user);
  const cles = resoudreCles(docs);
  return docs.filter((d) => cles.get(d.id) === cle);
}

/** Export CSV (séparateur « ; », BOM : Excel en français l'ouvre correctement). */
function versCsv(fiches) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const entete = ['Clé', 'Regroupement', 'Identifiant', 'Nom', 'Documents', 'Total TTC', 'Devise', 'Alertes ouvertes', 'Natures'];
  const lignes = fiches.map((f) => [f.cle, f.groupe, f.identifiant, f.nom, f.nombre_documents, f.total_ttc, f.devise, f.nombre_alertes, f.natures.join(' / ')].map(esc).join(';'));
  return `﻿${[entete.map(esc).join(';'), ...lignes].join('\r\n')}\r\n`;
}

module.exports = { cleFournisseur, resoudreCles, lister, documentsDe, versCsv, typeGroupe };
