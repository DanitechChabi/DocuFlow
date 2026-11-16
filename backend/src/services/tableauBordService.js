// ============================================================================
// tableauBordService — le tableau de bord des archives pour la direction.
//
// Sur une période (du … au …, dates de calendrier) :
//   - les demandes reçues, servies, annulées, renvoyées pour compléments ;
//   - par département (section de l'agent) et par motif ;
//   - le délai de traitement : de la demande à la sortie du dossier
//     (moyenne et médiane, en heures) ;
//   - les demandes et les dossiers entrés, semaine de production par semaine ;
//   - à l'instant : les dossiers sortis en retard (chez qui, depuis quand),
//     et le contenu de chaque armoire.
// ============================================================================
const db = require('../config/db');

function erreur(statut, message) {
  const e = new Error(message);
  e.statut = statut;
  return e;
}

const iso = (d) => d.toISOString().slice(0, 10);
const valide = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1 ? iso(d) : null;
};

/** Période demandée, ou le mois en cours. `au` inclus. */
function periode({ du, au } = {}, maintenant = new Date()) {
  const debutMois = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), 1));
  const d = valide(du) || iso(debutMois);
  const a = valide(au) || iso(maintenant);
  if (d > a) throw erreur(400, 'La date de début est après la date de fin.');
  const jours = (Date.parse(a) - Date.parse(d)) / 86400000;
  if (jours > 366 * 3) throw erreur(400, 'Période trop longue (3 ans au plus).');
  return { du: d, au: a };
}

// Vendredi qui ouvre la semaine de production d'une date SQL (dow : dimanche = 0, vendredi = 5).
const SEMAINE = (col) => `(${col}::date - ((extract(dow FROM ${col})::int + 2) % 7))`;

async function tableau(tenantId, params = {}) {
  const { du, au } = periode(params);
  const p = [tenantId, du, au];
  const dansPeriode = 'r.tenant_id = $1 AND r.created_at >= $2::date AND r.created_at < $3::date + 1';

  const [synthese, departements, motifs, delais, parSemaine, entrees, retards, armoires, complements] = await Promise.all([
    db.query(
      `SELECT count(*)::int AS recues,
              count(*) FILTER (WHERE p.id IS NOT NULL OR r.statut = 'livré')::int AS servies,
              count(*) FILTER (WHERE r.statut IN ('annulé', 'rejete'))::int AS annulees,
              count(*) FILTER (WHERE r.statut = 'a completer')::int AS a_completer,
              count(*) FILTER (WHERE p.id IS NULL AND r.statut IN ('en attente', 'a traiter'))::int AS en_attente
         FROM requests r LEFT JOIN request_loans p ON p.request_id = r.id
        WHERE ${dansPeriode}`, p),
    db.query(
      `SELECT COALESCE(NULLIF(trim(u.section), ''), 'Non renseigné') AS nom, count(*)::int AS n
         FROM requests r JOIN users u ON u.id = r.id_user
        WHERE ${dansPeriode} GROUP BY 1 ORDER BY 2 DESC, 1`, p),
    db.query(
      `SELECT COALESCE(NULLIF(trim(r.motif), ''), 'Sans motif') AS nom, count(*)::int AS n
         FROM requests r WHERE ${dansPeriode} GROUP BY 1 ORDER BY 2 DESC, 1`, p),
    db.query(
      `SELECT count(*)::int AS n,
              round(avg(extract(epoch FROM (p.remis_at - r.created_at)) / 3600)::numeric, 1)::float AS moyenne_h,
              round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (p.remis_at - r.created_at)) / 3600))::numeric, 1)::float AS mediane_h,
              count(*) FILTER (WHERE p.remis_at - r.created_at <= interval '24 hours')::int AS en_24h
         FROM request_loans p JOIN requests r ON r.id = p.request_id
        WHERE p.tenant_id = $1 AND p.remis_at >= $2::date AND p.remis_at < $3::date + 1 AND p.remis_at >= r.created_at`, p),
    db.query(
      `SELECT to_char(${SEMAINE('r.created_at')}, 'YYYY-MM-DD') AS semaine, count(*)::int AS n
         FROM requests r WHERE ${dansPeriode} GROUP BY 1 ORDER BY 1`, p),
    db.query(
      `SELECT to_char(semaine, 'YYYY-MM-DD') AS semaine, count(*)::int AS n
         FROM dossiers_entres WHERE tenant_id = $1 AND date_point BETWEEN $2::date AND $3::date
        GROUP BY 1 ORDER BY 1`, p).catch((e) => (e.code === '42P01' ? { rows: [] } : Promise.reject(e))),
    db.query(
      `SELECT r.id, r.nom_entreprise, r.num_dossier, r.num_acte, r.annee, r.type_document, r.description,
              u.full_name AS emprunteur, COALESCE(NULLIF(trim(u.section), ''), '—') AS departement,
              to_char(p.remis_at, 'YYYY-MM-DD') AS sorti_le, to_char(p.date_retour_prevue, 'YYYY-MM-DD') AS retour_prevu,
              (CURRENT_DATE - p.date_retour_prevue)::int AS jours_retard
         FROM request_loans p JOIN requests r ON r.id = p.request_id JOIN users u ON u.id = p.emprunteur_id
        WHERE p.tenant_id = $1 AND p.retourne_at IS NULL AND p.date_retour_prevue < CURRENT_DATE
        ORDER BY p.date_retour_prevue, r.id LIMIT 200`, [tenantId]),
    db.query(
      `SELECT g.nom, g.lieu, count(d.id)::int AS n
         FROM rangements g
         LEFT JOIN dossiers_entres d ON d.tenant_id = g.tenant_id
          AND (d.semaine, COALESCE(d.lettre, '~') COLLATE "C") >= (g.debut_semaine, COALESCE(g.debut_lettre, '#') COLLATE "C")
          AND (d.semaine, COALESCE(d.lettre, '~') COLLATE "C") <= (g.fin_semaine, COALESCE(g.fin_lettre, '~') COLLATE "C")
        WHERE g.tenant_id = $1
        GROUP BY g.id, g.nom, g.lieu, g.ordre, g.debut_semaine ORDER BY g.debut_semaine, g.ordre, g.id`, [tenantId])
      .catch((e) => (e.code === '42P01' ? { rows: [] } : Promise.reject(e))),
    db.query(
      `SELECT count(*)::int AS n FROM requests r
        WHERE r.tenant_id = $1 AND r.complement_demande_at >= $2::date AND r.complement_demande_at < $3::date + 1`, p)
      .catch((e) => (e.code === '42703' ? { rows: [{ n: 0 }] } : Promise.reject(e))),
  ]);

  const s = synthese.rows[0];
  return {
    periode: { du, au },
    demandes: { ...s, complements: complements.rows[0].n },
    departements: departements.rows,
    motifs: motifs.rows,
    delai: delais.rows[0],
    demandes_par_semaine: parSemaine.rows,
    entrees_par_semaine: entrees.rows,
    entrees_total: entrees.rows.reduce((t, x) => t + x.n, 0),
    retards: retards.rows,
    armoires: armoires.rows,
  };
}

module.exports = { tableau, periode };
