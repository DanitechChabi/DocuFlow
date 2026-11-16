// ============================================================================
// entreeService — l'entrée des dossiers aux archives (édition AFGC, 049).
//
// Les « points des dossiers retirés » (un classeur Excel par an, une journée
// après l'autre) deviennent des dossiers entrés. L'archive les traite par
// SEMAINE DE PRODUCTION, du vendredi au jeudi, jours fériés exclus, et les
// classe par LETTRE avant de les mettre en boîte. Chaque dossier se retrouve
// par son nom, l'un de ses n° d'acte (« 1964 » dans « 1963-1964-1965 »,
// « 2026/58 »), son type, sa période ou l'agent.
// ============================================================================
const crypto = require('crypto');
const db = require('../config/db');
const settingsService = require('./settingsService');

function erreur(statut, message) {
  const e = new Error(message);
  e.statut = statut;
  return e;
}

const LIMITE = 3000;
const texte = (v, max) => {
  const s = v === undefined || v === null ? '' : String(v).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};
const nombre = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[\s  ]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
const iso = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
const jour = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').slice(0, 10));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1 ? d : null;
};

/** Vendredi qui ouvre la semaine de production d'une date (AAAA-MM-JJ). */
function semaineDe(dateIso) {
  const d = jour(dateIso);
  if (!d) return null;
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - 5 + 7) % 7));
  return iso(d);
}

/** Les numéros d'acte d'une cellule : « 1963-1964-1965 », « 71 à 74 », « 2026/58 », « 13802 ». */
function actesDe(brut) {
  const s = String(brut ?? '').trim();
  if (!s) return [];
  const res = new Set();
  const plage = /(\d+)\s*(?:à|a|au)\s*(\d+)/gi;
  let reste = s;
  for (const m of s.matchAll(plage)) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (b >= a && b - a <= 200) for (let k = a; k <= b; k += 1) res.add(k);
    reste = reste.replace(m[0], ' ');
  }
  // « 2026/58 » : l'année n'est pas un n° d'acte.
  reste = reste.replace(/\b(19|20)\d{2}\s*\/\s*(\d+)/g, ' $2 ');
  for (const m of reste.matchAll(/\d+/g)) {
    const n = Number(m[0]);
    if (n > 0 && n < 2147483647) res.add(n);
  }
  return [...res];
}

/** Lettre de classement : la première lettre du nom (A à Z), « # » s'il commence par un chiffre. */
function lettreDe(nom) {
  const c = String(nom || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().match(/[A-Z0-9]/);
  if (!c) return null;
  return /\d/.test(c[0]) ? '#' : c[0];
}

/** Dimanche de Pâques (algorithme grégorien). */
function paques(annee) {
  const a = annee % 19; const b = Math.floor(annee / 100); const c = annee % 100;
  const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31); const j = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(annee, mois - 1, j));
}

/** Jours fériés d'une année (AAAA-MM-JJ) : le réglage, plus Pâques, Ascension, Pentecôte. */
async function feriesDe(tenantId, annee) {
  const brut = String(await settingsService.get(tenantId, 'jours_feries', '') || '');
  const res = new Set();
  for (const t of brut.split(/[\s,;]+/).filter(Boolean)) {
    if (/^\d{2}-\d{2}$/.test(t)) res.add(`${annee}-${t}`);
    else if (/^\d{4}-\d{2}-\d{2}$/.test(t) && t.startsWith(String(annee))) res.add(t);
  }
  const p = paques(annee);
  for (const decalage of [1, 39, 50]) {
    const d = new Date(p); d.setUTCDate(d.getUTCDate() + decalage); res.add(iso(d));
  }
  return res;
}

/**
 * Enregistre des lignes lues dans un ou plusieurs points (le navigateur lit le
 * classeur). Une ligne déjà importée est ignorée : réimporter un classeur
 * complété en cours d'année n'ajoute que ses nouvelles lignes.
 * @param {object[]} lignes [{ date, rubrique, ordre, actes, denomination, type, montant, ht, ttc, agent }]
 */
async function importer(tenantId, user, { fichier, lignes } = {}) {
  if (!Array.isArray(lignes) || !lignes.length) throw erreur(400, 'Aucune ligne à importer.');
  if (lignes.length > LIMITE) throw erreur(400, `Au plus ${LIMITE} lignes par envoi.`);
  const nomFichier = texte(fichier, 255);
  const valeurs = [];
  let rejetees = 0;
  for (const l of lignes) {
    const date = jour(l?.date) ? String(l.date).slice(0, 10) : null;
    const denomination = texte(l?.denomination, 255);
    const numActes = texte(l?.actes, 255);
    if (!date || (!denomination && !numActes)) { rejetees += 1; continue; }
    const v = {
      date, semaine: semaineDe(date), rubrique: texte(l.rubrique, 150), ordre: Number.isInteger(Number(l.ordre)) && l.ordre !== '' && l.ordre !== null ? Number(l.ordre) : null,
      numActes, actes: actesDe(numActes), denomination, lettre: lettreDe(denomination), type: texte(l.type, 100),
      montant: nombre(l.montant), ht: nombre(l.ht), ttc: nombre(l.ttc), agent: texte(l.agent, 100),
    };
    v.empreinte = crypto.createHash('md5').update([v.date, v.rubrique, v.ordre, v.numActes, v.denomination, v.type].join('|')).digest('hex');
    valeurs.push(v);
  }
  if (!valeurs.length) return { ajoutees: 0, deja: 0, rejetees };
  const col = (k) => valeurs.map((v) => v[k]);
  const r = await db.query(
    `INSERT INTO dossiers_entres (tenant_id, date_point, semaine, rubrique, num_ordre, num_actes, actes, denomination, lettre,
       type_garantie, montant, commission_ht, commission_ttc, agent, fichier, empreinte, cree_par)
     SELECT $1, x.d::date, x.s::date, x.r, x.o, x.n, ARRAY(SELECT jsonb_array_elements_text(x.a)::int), x.den, x.l, x.t, x.m, x.h, x.c, x.ag, $2, x.e, $3
       FROM unnest($4::text[], $5::text[], $6::text[], $7::int[], $8::text[], $9::jsonb[], $10::text[], $11::text[], $12::text[],
                   $13::numeric[], $14::numeric[], $15::numeric[], $16::text[], $17::text[])
         AS x(d, s, r, o, n, a, den, l, t, m, h, c, ag, e)
     ON CONFLICT (tenant_id, empreinte) DO NOTHING`,
    [tenantId, nomFichier, user.id, col('date'), col('semaine'), col('rubrique'), col('ordre'), col('numActes'),
      valeurs.map((v) => JSON.stringify(v.actes)), col('denomination'), col('lettre'), col('type'),
      col('montant'), col('ht'), col('ttc'), col('agent'), col('empreinte')]
  );
  if (r.rowCount) {
    await db.query('INSERT INTO audit_logs (id_user, action, request_id, tenant_id) VALUES ($1, $2, NULL, $3)',
      [user.id, `A importé ${r.rowCount} dossier${r.rowCount > 1 ? 's' : ''} entré${r.rowCount > 1 ? 's' : ''}${nomFichier ? ` (« ${nomFichier} »)` : ''}`.slice(0, 500), tenantId]);
  }
  return { ajoutees: r.rowCount, deja: valeurs.length - r.rowCount, rejetees };
}

/** Les semaines de production d'une année : du vendredi au jeudi, jours ouvrés, nombre de dossiers. */
async function semaines(tenantId, { annee } = {}) {
  const an = Number(annee) || new Date().getFullYear();
  const r = await db.query(
    `SELECT to_char(semaine, 'YYYY-MM-DD') AS semaine, count(*)::int AS dossiers,
            json_agg(DISTINCT to_char(date_point, 'YYYY-MM-DD')) AS jours_avec_point
       FROM dossiers_entres
      WHERE tenant_id = $1 AND semaine BETWEEN $2::date - 6 AND $3::date
      GROUP BY semaine ORDER BY semaine DESC`,
    [tenantId, `${an}-01-01`, `${an}-12-31`]
  );
  const feries = new Set([...(await feriesDe(tenantId, an - 1)), ...(await feriesDe(tenantId, an)), ...(await feriesDe(tenantId, an + 1))]);
  return r.rows.map((s) => {
    const debut = jour(s.semaine);
    const jours = [];
    const feriesSemaine = [];
    for (let k = 0; k < 7; k += 1) {
      const d = new Date(debut); d.setUTCDate(d.getUTCDate() + k);
      const j = iso(d);
      if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
      if (feries.has(j)) feriesSemaine.push(j); else jours.push(j);
    }
    const fin = new Date(debut); fin.setUTCDate(fin.getUTCDate() + 6);
    return { semaine: s.semaine, au: iso(fin), dossiers: s.dossiers, jours_ouvres: jours, feries: feriesSemaine, jours_avec_point: (s.jours_avec_point || []).sort() };
  });
}

/** Les dossiers d'une semaine, dans l'ordre du classement : par lettre, puis par nom. */
async function semaine(tenantId, debut) {
  const s = semaineDe(debut);
  if (!s) throw erreur(400, 'Semaine invalide.');
  const r = await db.query(
    `SELECT id, to_char(date_point, 'YYYY-MM-DD') AS date_point, rubrique, num_ordre, num_actes, denomination, lettre,
            type_garantie, montant, agent
       FROM dossiers_entres WHERE tenant_id = $1 AND semaine = $2::date
      ORDER BY lettre NULLS LAST, upper(denomination), date_point, num_ordre`,
    [tenantId, s]
  );
  const fin = jour(s); fin.setUTCDate(fin.getUTCDate() + 6);
  return { semaine: s, au: iso(fin), dossiers: r.rows };
}

/** Recherche : nom, n° d'acte (« 1964 », « 2026/58 »), type, agent, période. */
async function rechercher(tenantId, { q, type, agent, du, au } = {}) {
  const conds = ['tenant_id = $1'];
  const params = [tenantId];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const saisie = texte(q, 100);
  if (saisie) {
    const acteAnnee = /^((?:19|20)\d{2})\s*\/\s*(\d+)$/.exec(saisie);
    if (acteAnnee) {
      conds.push(`${p(Number(acteAnnee[2]))} = ANY(actes)`, `extract(year FROM date_point) = ${p(Number(acteAnnee[1]))}`);
    } else if (/^\d+$/.test(saisie)) {
      // Un numéro : l'acte exact (« 1964 » ne ramène pas « 11964 »).
      conds.push(`${p(Number(saisie))} = ANY(actes)`);
    } else {
      conds.push(`denomination ILIKE ${p(`%${saisie.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)}`);
    }
  }
  if (texte(type, 100)) conds.push(`type_garantie = ${p(texte(type, 100))}`);
  if (texte(agent, 100)) conds.push(`upper(agent) = upper(${p(texte(agent, 100))})`);
  if (jour(du)) conds.push(`date_point >= ${p(String(du).slice(0, 10))}::date`);
  if (jour(au)) conds.push(`date_point <= ${p(String(au).slice(0, 10))}::date`);
  if (conds.length === 1) throw erreur(400, 'Tapez un nom ou un n° d\'acte, ou choisissez un filtre.');
  const r = await db.query(
    `SELECT id, to_char(date_point, 'YYYY-MM-DD') AS date_point, to_char(semaine, 'YYYY-MM-DD') AS semaine, rubrique, num_ordre,
            num_actes, denomination, lettre, type_garantie, montant, agent
       FROM dossiers_entres WHERE ${conds.join(' AND ')}
      ORDER BY date_point DESC, num_ordre LIMIT 300`,
    params
  );
  return r.rows;
}

/** Valeurs des filtres : types de garantie, agents, années présentes. */
async function filtres(tenantId) {
  const [types, agents, annees] = await Promise.all([
    db.query('SELECT type_garantie AS v, count(*)::int AS n FROM dossiers_entres WHERE tenant_id = $1 AND type_garantie IS NOT NULL GROUP BY 1 ORDER BY 2 DESC', [tenantId]),
    db.query('SELECT upper(agent) AS v, count(*)::int AS n FROM dossiers_entres WHERE tenant_id = $1 AND agent IS NOT NULL GROUP BY 1 ORDER BY 2 DESC', [tenantId]),
    db.query('SELECT DISTINCT extract(year FROM date_point)::int AS v FROM dossiers_entres WHERE tenant_id = $1 ORDER BY 1 DESC', [tenantId]),
  ]);
  return { types: types.rows, agents: agents.rows, annees: annees.rows.map((x) => x.v) };
}

module.exports = { importer, semaines, semaine, rechercher, filtres, semaineDe, actesDe, lettreDe, feriesDe, paques, LIMITE };
