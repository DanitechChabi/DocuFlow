// ============================================================================
// rapportAnnuelService — rapport annuel d'activité du service d'archives.
//
// Décret n° 2007-532, art. 31 : les services producteurs adressent chaque
// année un rapport sur la gestion de leurs archives à l'autorité d'archives.
// Le rapport se calcule sur les données (rien à ressaisir) : accroissements,
// fonds au 31 décembre, éliminations visées, versements, communications et
// copies, récolements, état de conservation, points d'attention.
// ============================================================================
const db = require('../config/db');
const settingsService = require('./settingsService');

const un = async (sql, params) => {
  try { return (await db.query(sql, params)).rows[0] || {}; } catch (err) {
    if (err.code === '42P01' || err.code === '42703') return {}; // migration absente
    throw err;
  }
};
const plusieurs = async (sql, params) => {
  try { return (await db.query(sql, params)).rows; } catch (err) {
    if (err.code === '42P01' || err.code === '42703') return [];
    throw err;
  }
};

/** Points d'attention à porter à la connaissance de l'autorité. Fonction pure. */
function pointsAttention(r) {
  const p = [];
  if (r.conservation.alterees > 0) p.push(`${r.conservation.alterees} fichier(s) dont l'intégrité est compromise (altéré ou introuvable).`);
  if (r.fonds.classes_sans_duree > 0) p.push(`${r.fonds.classes_sans_duree} classe(s) de documents sans durée de conservation : tableau de gestion à compléter et à faire valider (art. 40).`);
  if (r.recolement.manquants > 0) p.push(`${r.recolement.manquants} article(s) constaté(s) absent(s) au récolement.`);
  if (r.recolement.abimes > 0) p.push(`${r.recolement.abimes} article(s) abîmé(s) : restauration ou reconditionnement à prévoir.`);
  if (r.recolement.clos === 0 && r.fonds.documents_papier > 0) p.push('Aucun récolement des archives papier clos dans l\'année.');
  if (r.conservation.formats_a_risque > 0) p.push(`${r.conservation.formats_a_risque} fichier(s) dans un format à risque : copies de conservation PDF/A à produire (Code du numérique, art. 301-303).`);
  if (r.communication.prets_en_retard > 0) p.push(`${r.communication.prets_en_retard} prêt(s) de dossier non rendu(s) à la date prévue.`);
  if (r.eliminations.en_attente_visa > 0) p.push(`${r.eliminations.en_attente_visa} bordereau(x) d'élimination en attente du visa de l'autorité d'archives (art. 44).`);
  return p;
}

async function rapport(tenantId, annee) {
  const a = Number(annee);
  if (!Number.isInteger(a) || a < 1900 || a > 2200) throw Object.assign(new Error('Année invalide.'), { status: 400 });
  const debut = `${a}-01-01`;
  const fin = `${a + 1}-01-01`;
  const p = [tenantId, debut, fin];
  const reglages = await settingsService.getAll(tenantId);
  const org = await un('SELECT name FROM tenants WHERE id = $1', [tenantId]);

  const [entrees, fonds, emplacements, elim, vers, demandes, prets, pretsRetard, copies, recol, conserv, horod, classes] = await Promise.all([
    un(`SELECT count(*)::int AS documents,
               count(*) FILTER (WHERE support IN ('papier', 'mixte'))::int AS papier
          FROM documents WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3`, p),
    un(`SELECT count(*)::int AS documents,
               count(*) FILTER (WHERE support IN ('papier', 'mixte'))::int AS papier,
               count(*) FILTER (WHERE emplacement_id IS NOT NULL)::int AS ranges,
               count(*) FILTER (WHERE verse_at IS NOT NULL)::int AS verses
          FROM documents WHERE tenant_id = $1 AND created_at < $2 AND (elimine_at IS NULL OR elimine_at >= $2)
           AND (deleted_at IS NULL OR deleted_at >= $2)`, [tenantId, fin]),
    plusieurs(`SELECT type, count(*)::int AS n, COALESCE(sum(capacite_ml), 0)::float AS ml FROM emplacements WHERE tenant_id = $1 GROUP BY type`, [tenantId]),
    un(`SELECT count(*) FILTER (WHERE execute_at >= $2 AND execute_at < $3)::int AS bordereaux,
               count(*) FILTER (WHERE execute_at >= $2 AND execute_at < $3 AND visa_decision IN ('accorde', 'partiel'))::int AS vises,
               count(*) FILTER (WHERE statut = 'transmis')::int AS en_attente_visa,
               (SELECT count(*)::int FROM documents d WHERE d.tenant_id = $1 AND d.elimine_at >= $2 AND d.elimine_at < $3) AS documents
          FROM bordereaux_elimination WHERE tenant_id = $1`, p),
    un(`SELECT count(*) FILTER (WHERE transmis_at >= $2 AND transmis_at < $3)::int AS transmis,
               count(*) FILTER (WHERE statut = 'pris_en_charge' AND enregistre_at >= $2 AND enregistre_at < $3)::int AS pris_en_charge,
               (SELECT count(*)::int FROM documents d WHERE d.tenant_id = $1 AND d.verse_at >= $2 AND d.verse_at < $3) AS documents
          FROM bordereaux_versement WHERE tenant_id = $1`, p),
    un(`SELECT count(*)::int AS recues, count(*) FILTER (WHERE date_livraison IS NOT NULL)::int AS livrees
          FROM requests WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3`, p),
    plusieurs(`SELECT COALESCE(nature, 'original') AS nature, count(*)::int AS n FROM request_loans
                WHERE tenant_id = $1 AND remis_at >= $2 AND remis_at < $3 GROUP BY 1`, p),
    un(`SELECT count(*)::int AS n FROM request_loans WHERE tenant_id = $1 AND retourne_at IS NULL AND date_retour_prevue < now()`, [tenantId]),
    un(`SELECT count(*)::int AS n, count(*) FILTER (WHERE autorisation_communication IS NOT NULL)::int AS sur_autorisation
          FROM copies_certifiees WHERE tenant_id = $1 AND delivre_at >= $2 AND delivre_at < $3`, p),
    un(`SELECT count(*) FILTER (WHERE r.statut = 'clos')::int AS clos,
               (SELECT count(*)::int FROM recolement_lignes l JOIN recolements x ON x.id = l.recolement_id
                 WHERE x.tenant_id = $1 AND x.statut = 'clos' AND x.clos_at >= $2 AND x.clos_at < $3 AND l.resultat = 'absent') AS manquants,
               (SELECT count(*)::int FROM recolement_lignes l JOIN recolements x ON x.id = l.recolement_id
                 WHERE x.tenant_id = $1 AND x.statut = 'clos' AND x.clos_at >= $2 AND x.clos_at < $3 AND l.resultat = 'abime') AS abimes
          FROM recolements r WHERE r.tenant_id = $1 AND r.clos_at >= $2 AND r.clos_at < $3`, p),
    un(`SELECT count(*)::int AS fichiers,
               COALESCE(sum(f.file_size), 0)::bigint AS octets,
               count(*) FILTER (WHERE f.integrite_statut IN ('alteree', 'introuvable'))::int AS alterees,
               count(*) FILTER (WHERE f.integrite_verifiee_at >= $2 AND f.integrite_verifiee_at < $3)::int AS controles,
               count(*) FILTER (WHERE f.format_risque IN ('surveiller', 'risque'))::int AS formats_a_risque,
               count(*) FILTER (WHERE f.pdfa IS NOT NULL)::int AS pdfa
          FROM document_files f JOIN documents d ON d.id = f.document_id
         WHERE d.tenant_id = $1 AND d.elimine_at IS NULL AND d.deleted_at IS NULL`, p),
    un(`SELECT count(*) FILTER (WHERE statut = 'obtenu')::int AS obtenus FROM horodatages WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3`, p),
    un(`SELECT count(*)::int AS n, count(*) FILTER (WHERE dua_annees IS NULL)::int AS sans_duree
          FROM metadata_schemas WHERE tenant_id = $1 AND is_default IS NOT TRUE`, [tenantId]),
  ]);

  const parType = Object.fromEntries(emplacements.map((e) => [e.type, e]));
  const r = {
    annee: a,
    organisation: reglages.legal_entity || org.name || null,
    autorite: reglages.archives_autorite || null,
    genere_at: new Date().toISOString(),
    accroissements: { documents: entrees.documents || 0, papier: entrees.papier || 0 },
    fonds: {
      documents: fonds.documents || 0, documents_papier: fonds.papier || 0, ranges: fonds.ranges || 0, verses: fonds.verses || 0,
      classes: classes.n || 0, classes_sans_duree: classes.sans_duree || 0,
      depots: parType.depot?.n || 0, magasins: parType.magasin?.n || 0, boites: parType.boite?.n || 0,
      capacite_ml: emplacements.reduce((s, e) => s + (e.type === 'magasin' ? e.ml : 0), 0),
    },
    eliminations: { bordereaux: elim.bordereaux || 0, vises: elim.vises || 0, documents: elim.documents || 0, en_attente_visa: elim.en_attente_visa || 0 },
    versements: { transmis: vers.transmis || 0, pris_en_charge: vers.pris_en_charge || 0, documents: vers.documents || 0 },
    communication: {
      demandes_recues: demandes.recues || 0, demandes_livrees: demandes.livrees || 0,
      prets: Object.fromEntries(prets.map((x) => [x.nature, x.n])), prets_en_retard: pretsRetard.n || 0,
      copies_certifiees: copies.n || 0, copies_sur_autorisation: copies.sur_autorisation || 0,
    },
    recolement: { clos: recol.clos || 0, manquants: recol.manquants || 0, abimes: recol.abimes || 0 },
    conservation: {
      fichiers: conserv.fichiers || 0, octets: Number(conserv.octets || 0), alterees: conserv.alterees || 0,
      controles: conserv.controles || 0, formats_a_risque: conserv.formats_a_risque || 0, pdfa: conserv.pdfa || 0,
      horodatages: horod.obtenus || 0,
    },
  };
  r.points_attention = pointsAttention(r);
  return r;
}

module.exports = { rapport, pointsAttention };
