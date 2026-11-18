// ============================================================================
// La veille de DocuBot (056) : ce que l'archive doit savoir ce matin, sans
// l'avoir demandé. Montrée à l'ouverture de DocuBot (archive) et envoyée par
// courriel chaque matin, une fois, s'il y a quelque chose à signaler.
// ============================================================================

const db = require('../config/db');
const roleService = require('./roleService');

const pluriel = (n, mot, pl = `${mot}s`) => `${n} ${n > 1 ? pl : mot}`;
const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const jourAff = (iso) => {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return `${JOURS[d.getUTCDay()]} ${d.getUTCDate()} ${MOIS[d.getUTCMonth()]}`;
};

// Seuils de la veille.
const ATTENTE_JOURS = 2; // une demande non transmise depuis plus de 2 jours
const COMPLEMENT_JOURS = 3; // des compléments demandés, sans réponse depuis 3 jours
const PRET_LONG_JOURS = 30; // un dossier dehors depuis plus d'un mois
const SORTIES_FREQUENTES = 3; // le même dossier sorti 3 fois en 60 jours : à numériser

const q = async (sql, params) => (await db.query(sql, params)).rows;

/**
 * Le bilan du jour : [{ cle, niveau ('alerte' | 'conseil'), titre, detail, lien, nombre, exemples }].
 * `aujourdhui` (AAAA-MM-JJ) pour les tests.
 */
async function bilan(tenantId, { aujourdhui = null } = {}) {
  const jour = aujourdhui || new Date().toISOString().slice(0, 10);
  const items = [];

  const retards = await q(
    `SELECT q.nom_entreprise, u.full_name AS chez, ($2::date - l.date_retour_prevue)::int AS jours
       FROM request_loans l JOIN requests q ON q.id = l.request_id AND q.tenant_id = l.tenant_id
       LEFT JOIN users u ON u.id = l.emprunteur_id
      WHERE l.tenant_id = $1 AND l.retourne_at IS NULL AND l.date_retour_prevue < $2::date
      ORDER BY l.date_retour_prevue`, [tenantId, jour]
  );
  if (retards.length) {
    items.push({
      cle: 'retards', niveau: 'alerte', nombre: retards.length, lien: '/demandes/prets',
      titre: `${pluriel(retards.length, 'dossier')} en retard`,
      detail: 'À récupérer auprès des agents.',
      exemples: retards.slice(0, 3).map((r) => `${r.nom_entreprise || 'Dossier'} — chez ${r.chez || '?'} (${pluriel(r.jours, 'jour')} de retard)`),
    });
  }

  const attente = await q(
    `SELECT q.nom_entreprise, ($2::date - q.created_at::date)::int AS jours
       FROM requests q
      WHERE q.tenant_id = $1 AND q.statut = 'en attente' AND q.created_at::date < $2::date - $3::int
        AND (q.complement_demande_at IS NULL OR q.complement_fourni_at IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM request_loans l WHERE l.request_id = q.id)
      ORDER BY q.created_at`, [tenantId, jour, ATTENTE_JOURS]
  );
  if (attente.length) {
    items.push({
      cle: 'attente', niveau: 'alerte', nombre: attente.length, lien: '/demandes/a-traiter',
      titre: `${pluriel(attente.length, 'demande')} en attente depuis plus de ${ATTENTE_JOURS} jours`,
      detail: 'Des agents attendent leur dossier.',
      exemples: attente.slice(0, 3).map((r) => `${r.nom_entreprise || 'Dossier'} — depuis ${pluriel(r.jours, 'jour')}`),
    });
  }

  const complements = await q(
    `SELECT q.nom_entreprise, u.full_name AS agent, ($2::date - q.complement_demande_at::date)::int AS jours
       FROM requests q LEFT JOIN users u ON u.id = q.id_user
      WHERE q.tenant_id = $1 AND q.statut = 'en attente' AND q.complement_demande_at IS NOT NULL AND q.complement_fourni_at IS NULL
        AND q.complement_demande_at::date < $2::date - $3::int
      ORDER BY q.complement_demande_at`, [tenantId, jour, COMPLEMENT_JOURS]
  );
  if (complements.length) {
    items.push({
      cle: 'complements', niveau: 'conseil', nombre: complements.length, lien: '/demandes/a-traiter',
      titre: `${pluriel(complements.length, 'demande')} sans les compléments demandés`,
      detail: `Les agents n'ont pas répondu depuis plus de ${COMPLEMENT_JOURS} jours : un rappel, ou fermer la demande.`,
      exemples: complements.slice(0, 3).map((r) => `${r.nom_entreprise || 'Dossier'} — ${r.agent || 'agent'} (${pluriel(r.jours, 'jour')})`),
    });
  }

  const doublons = await q(
    `SELECT min(q.nom_entreprise) AS nom, count(*)::int AS n, count(DISTINCT q.id_user)::int AS agents
       FROM requests q
      WHERE q.tenant_id = $1 AND q.statut = 'en attente' AND COALESCE(q.nom_entreprise, '') <> ''
        AND NOT EXISTS (SELECT 1 FROM request_loans l WHERE l.request_id = q.id)
      GROUP BY lower(trim(q.nom_entreprise)), lower(COALESCE(q.num_acte, '')), COALESCE(q.type_document, '')
     HAVING count(*) > 1 ORDER BY count(*) DESC`, [tenantId]
  );
  if (doublons.length) {
    items.push({
      cle: 'doublons', niveau: 'conseil', nombre: doublons.length, lien: '/demandes/a-traiter',
      titre: `${pluriel(doublons.length, 'dossier demandé', 'dossiers demandés')} plusieurs fois`,
      detail: 'Le même dossier attend dans plusieurs demandes : à servir une fois, ou à regrouper.',
      exemples: doublons.slice(0, 3).map((r) => `${r.nom} — ${r.n} demandes${r.agents > 1 ? `, ${r.agents} agents` : ''}`),
    });
  }

  const frequents = await q(
    `SELECT min(q.nom_entreprise) AS nom, count(*)::int AS n
       FROM request_loans l JOIN requests q ON q.id = l.request_id AND q.tenant_id = l.tenant_id
      WHERE l.tenant_id = $1 AND l.remis_at::date > $2::date - 60 AND COALESCE(q.nom_entreprise, '') <> ''
      GROUP BY lower(trim(q.nom_entreprise)), lower(COALESCE(q.num_acte, ''))
     HAVING count(*) >= $3 ORDER BY count(*) DESC`, [tenantId, jour, SORTIES_FREQUENTES]
  );
  if (frequents.length) {
    items.push({
      cle: 'frequents', niveau: 'conseil', nombre: frequents.length, lien: '/demandes/prets',
      titre: `${pluriel(frequents.length, 'dossier sorti', 'dossiers sortis')} au moins ${SORTIES_FREQUENTES} fois en deux mois`,
      detail: 'À numériser en priorité : la copie M-Files éviterait de sortir le papier.',
      exemples: frequents.slice(0, 3).map((r) => `${r.nom} — ${r.n} sorties`),
    });
  }

  const longs = await q(
    `SELECT q.nom_entreprise, u.full_name AS chez, ($2::date - l.remis_at::date)::int AS jours
       FROM request_loans l JOIN requests q ON q.id = l.request_id AND q.tenant_id = l.tenant_id
       LEFT JOIN users u ON u.id = l.emprunteur_id
      WHERE l.tenant_id = $1 AND l.retourne_at IS NULL AND l.remis_at::date < $2::date - $3::int
      ORDER BY l.remis_at`, [tenantId, jour, PRET_LONG_JOURS]
  );
  if (longs.length) {
    items.push({
      cle: 'longs', niveau: 'conseil', nombre: longs.length, lien: '/demandes/prets',
      titre: `${pluriel(longs.length, 'dossier')} dehors depuis plus d'un mois`,
      detail: 'Même sans retard (prolongation), un dossier longtemps dehors risque de se perdre.',
      exemples: longs.slice(0, 3).map((r) => `${r.nom_entreprise || 'Dossier'} — chez ${r.chez || '?'} depuis ${pluriel(r.jours, 'jour')}`),
    });
  }

  // Le point du dernier jour ouvré : importé ? (seulement si l'organisation importe ses points)
  const veille = new Date(`${jour}T00:00:00Z`);
  do { veille.setUTCDate(veille.getUTCDate() - 1); } while ([0, 6].includes(veille.getUTCDay()));
  const veilleIso = veille.toISOString().slice(0, 10);
  const points = await q(
    `SELECT count(*) FILTER (WHERE date_point = $2::date)::int AS ce_jour,
            count(*) FILTER (WHERE date_point > $2::date - 30)::int AS mois
       FROM dossiers_entres WHERE tenant_id = $1`, [tenantId, veilleIso]
  ).catch(() => [{ ce_jour: 1, mois: 0 }]);
  const ferie = (await require('./entreeService').feriesDe(tenantId, Number(veilleIso.slice(0, 4))).catch(() => new Set())).has(veilleIso);
  if (points[0].mois > 0 && points[0].ce_jour === 0 && !ferie) {
    items.push({
      cle: 'point', niveau: 'conseil', nombre: 1, lien: '/archives/entrees',
      titre: `Aucun point importé pour ${jourAff(veilleIso)}`,
      detail: 'Si des dossiers sont entrés ce jour-là, importez le classeur du point.',
      exemples: [],
    });
  }

  return { jour, items, alertes: items.filter((i) => i.niveau === 'alerte').length };
}

/** Le texte de la veille, pour DocuBot. */
function enTexte(b) {
  if (!b.items.length) return 'Rien à signaler ce matin : pas de retard, pas de demande en souffrance.';
  return `Ce matin, ${pluriel(b.items.length, 'point')} à voir :`;
}

/** Les comptes de l'archive (permission requests.process) de l'organisation. */
async function comptesArchive(tenantId) {
  const u = await q("SELECT id, role FROM users WHERE tenant_id = $1 AND desactive_le IS NULL AND COALESCE(email, '') <> ''", [tenantId]);
  const res = [];
  for (const x of u) if (await roleService.possede(tenantId, x.role, 'requests.process').catch(() => false)) res.push(x.id);
  return res;
}

/** Envoie la veille du jour à l'archive, une fois, s'il y a une alerte. */
async function envoyerDuJour(tenantId) {
  const b = await bilan(tenantId);
  if (!b.alertes) return { envoye: false, raison: 'rien d\'urgent' };
  const r = await db.query('INSERT INTO docubot_veille (tenant_id, jour) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING jour', [tenantId, b.jour]);
  if (!r.rowCount) return { envoye: false, raison: 'déjà envoyée' };
  const ids = await comptesArchive(tenantId);
  const n = await require('./mailService').notifierComptes(tenantId, ids, 'veille_docubot', {}, b);
  return { envoye: n > 0, destinataires: n };
}

/** Chaque matin, à partir de 7 h 30 (heure de Porto-Novo, UTC+1), pour chaque organisation active. */
function demarrer() {
  const tour = async () => {
    const maintenant = new Date();
    const minutes = (maintenant.getUTCHours() + 1) * 60 + maintenant.getUTCMinutes();
    if (minutes < 7 * 60 + 30 || [0, 6].includes(maintenant.getUTCDay())) return;
    try {
      const t = await q(`SELECT DISTINCT q.tenant_id FROM requests q
                          WHERE q.created_at > now() - interval '30 days'
                            AND NOT EXISTS (SELECT 1 FROM docubot_veille v WHERE v.tenant_id = q.tenant_id AND v.jour = CURRENT_DATE)`, []);
      for (const { tenant_id: id } of t) await envoyerDuJour(id).catch((err) => console.error(`[veille] espace ${id} :`, err.message));
    } catch (err) {
      if (err.code !== '42P01') console.error('[veille]', err.message);
    }
  };
  const t = setInterval(tour, 10 * 60 * 1000);
  t.unref?.();
  setTimeout(tour, 60 * 1000).unref?.();
}

module.exports = { bilan, enTexte, envoyerDuJour, comptesArchive, demarrer, ATTENTE_JOURS, COMPLEMENT_JOURS, PRET_LONG_JOURS, SORTIES_FREQUENTES };
