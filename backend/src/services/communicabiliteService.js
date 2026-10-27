// ============================================================================
// communicabiliteService — quand un document devient-il communicable au
// public ? (décret n° 2007-532 du 2 novembre 2007, art. 32 et 33).
//
//   art. 32  règle générale : communication au public après 30 ans ; avant,
//            sur autorisation du comité permanent (en accord avec le service
//            versant) ; certaines catégories sont libres quel que soit l'âge.
//   art. 33  délais spéciaux : renseignements médicaux 100 ans après la
//            naissance, dossiers de personnel 90 ans après la naissance,
//            état civil, minutes notariales, enregistrement 100 ans après
//            l'acte, instruction judiciaire et statistiques individuelles
//            60 ans, sûreté de l'État 50 ans.
//
// La catégorie se règle sur la CLASSE (metadata_schemas.communicabilite) ;
// sans catégorie, la règle générale s'applique. Un délai compté depuis la
// naissance lit la propriété « Date de naissance » du document : absente, le
// document n'est PAS réputé communicable (on ne devine pas une date qui ouvre
// l'accès à des données personnelles).
//
// La règle générale de l'art. 32 vise les documents VERSÉS aux archives
// publiques : un document encore détenu par le service qui l'a produit relève
// de la communication administrative, et la règle générale ne s'y applique
// pas. Les délais spéciaux de l'art. 33 (vie privée, sûreté de l'État), eux,
// s'appliquent toujours.
//
// Ce service ne bloque rien seul : il répond. Le partage public (lien vers un
// tiers sans compte) s'y soumet ; la fiche et le bordereau de versement
// l'affichent.
// ============================================================================
const db = require('../config/db');
const { COMMUNICABILITE } = require('../config/referentielBenin');

const jour = (v) => {
  if (!v) return null;
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v));
  return m ? m[1] : null;
};

function ajouterAnnees(date, annees) {
  const [a, m, j] = date.split('-').map(Number);
  const an = a + annees;
  const dernier = new Date(Date.UTC(an, m, 0)).getUTCDate();
  return `${String(an).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(Math.min(j, dernier)).padStart(2, '0')}`;
}

const normaliser = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Calcul pur.
 * @param {{ categorie?: string|null, date_document?: string, created_at?: string|Date, naissance?: string|null, verse_archives_publiques?: boolean }} d
 * @returns {{ categorie, libelle, reference, communicable: boolean, a_partir_du: string|null, raison: string|null }}
 */
function calculer(d, aujourdhui = jour(new Date())) {
  const categorie = COMMUNICABILITE[d.categorie] ? d.categorie : 'general';
  const regle = COMMUNICABILITE[categorie];
  const base = { categorie, libelle: regle.libelle, reference: regle.ref };
  if (regle.annees === 0) return { ...base, communicable: true, a_partir_du: null, raison: null };
  if (regle.apres_versement && !d.verse_archives_publiques) {
    return { ...base, communicable: true, a_partir_du: null, raison: null, hors_archives_publiques: true };
  }
  let depart;
  if (regle.depart === 'naissance') {
    depart = jour(d.naissance);
    if (!depart) {
      return { ...base, communicable: false, a_partir_du: null, raison: 'Date de naissance de la personne inconnue : renseignez la propriété « Date de naissance ».' };
    }
  } else {
    depart = jour(d.date_document) || jour(d.created_at);
  }
  if (!depart) return { ...base, communicable: false, a_partir_du: null, raison: 'Date du document inconnue.' };
  const libre = ajouterAnnees(depart, regle.annees);
  return { ...base, communicable: libre <= aujourdhui, a_partir_du: libre, raison: null };
}

/** État de communicabilité d'un document (null s'il n'existe pas dans l'organisation). */
async function etatDocument(tenantId, documentId) {
  const { rows } = await db.query(
    `SELECT d.id, to_char(d.date_document, 'YYYY-MM-DD') AS date_document, d.created_at, c.communicabilite,
            (v.destination = 'archives_publiques') AS verse_archives_publiques
       FROM documents d LEFT JOIN metadata_schemas c ON c.id = d.classe_id AND c.tenant_id = d.tenant_id
       LEFT JOIN bordereaux_versement v ON v.id = d.verse_versement_id AND v.statut = 'pris_en_charge'
      WHERE d.id = $1 AND d.tenant_id = $2`, [Number(documentId), tenantId]);
  const d = rows[0];
  if (!d) return null;
  let naissance = null;
  const regle = COMMUNICABILITE[d.communicabilite];
  if (regle && regle.depart === 'naissance') {
    const v = await db.query(
      `SELECT f.label, v.value_json FROM metadata_values v JOIN metadata_fields f ON f.id = v.field_id
        WHERE v.document_id = $1`, [d.id]);
    const champ = v.rows.find((x) => normaliser(x.label) === 'date de naissance');
    const brut = champ ? champ.value_json : null;
    naissance = brut && typeof brut === 'object' ? (brut.value ?? null) : brut;
  }
  return calculer({
    categorie: d.communicabilite, date_document: d.date_document, created_at: d.created_at, naissance,
    verse_archives_publiques: Boolean(d.verse_archives_publiques),
  });
}

module.exports = { calculer, etatDocument, ajouterAnnees };
