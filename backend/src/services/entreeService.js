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
const { ARMOIRE_SQL } = require('./rangementService');
const nomsProches = require('./nomsProchesService');

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

// Lettre de classement : voir helpers/lettreClassement (mots génériques et chiffres sautés).
const { lettreDe, nomDeClassement, cleDe, lettreValide } = require('../helpers/lettreClassement');

/** Les lettres corrigées à la main, par nom simplifié (migration 063 ; vide si absente). */
async function lettresCorrigees(tenantId) {
  const r = await db.query('SELECT nom_simple, lettre FROM lettres_classement WHERE tenant_id = $1', [tenantId]).catch(() => ({ rows: [] }));
  return new Map(r.rows.map((x) => [x.nom_simple, x.lettre]));
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
  const corrigees = await lettresCorrigees(tenantId);
  const valeurs = [];
  let rejetees = 0;
  for (const l of lignes) {
    const date = jour(l?.date) ? String(l.date).slice(0, 10) : null;
    const denomination = texte(l?.denomination, 255);
    const numActes = texte(l?.actes, 255);
    if (!date || (!denomination && !numActes)) { rejetees += 1; continue; }
    const v = {
      date, semaine: semaineDe(date), rubrique: texte(l.rubrique, 150), ordre: Number.isInteger(Number(l.ordre)) && l.ordre !== '' && l.ordre !== null ? Number(l.ordre) : null,
      numActes, actes: actesDe(numActes), denomination, lettre: corrigees.get(cleDe(denomination)) || lettreDe(denomination), type: texte(l.type, 100),
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
    // Les nouveaux noms rejoignent l'index de la recherche approchée, en arrière-plan.
    nomsProches.indexer(tenantId);
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
    `SELECT d.id, to_char(d.date_point, 'YYYY-MM-DD') AS date_point, d.rubrique, d.num_ordre, d.num_actes, d.denomination, d.lettre,
            d.type_garantie, d.montant, d.agent, ${ARMOIRE_SQL('d')} AS armoire
       FROM dossiers_entres d WHERE d.tenant_id = $1 AND d.semaine = $2::date
      ORDER BY lettre NULLS LAST, upper(denomination), date_point, num_ordre`,
    [tenantId, s]
  );
  const fin = jour(s); fin.setUTCDate(fin.getUTCDate() + 6);
  // Dans une lettre, l'ordre suit le nom de classement (« Société Gbèdé » parmi les G, à « Gbèdé »).
  const cle = (d) => nomDeClassement(d.denomination);
  const dossiers = r.rows.map((d, i) => ({ d, i, l: d.lettre || '~', c: cle(d) }))
    .sort((x, y) => (x.l === y.l ? (x.c === y.c ? x.i - y.i : x.c < y.c ? -1 : 1) : x.l < y.l ? -1 : 1))
    .map((x) => x.d);
  return { semaine: s, au: iso(fin), dossiers };
}

/**
 * Entrées déjà importées dont la lettre diffère de la règle actuelle (les
 * corrections à la main sont respectées). `appliquer` : les met à jour.
 */
async function lettresAnciennes(tenantId, user, { appliquer = false } = {}) {
  const corrigees = await lettresCorrigees(tenantId);
  const r = await db.query('SELECT id, denomination, lettre FROM dossiers_entres WHERE tenant_id = $1 AND denomination IS NOT NULL', [tenantId]);
  const parNom = new Map();
  for (const d of r.rows) {
    const nouvelle = corrigees.get(cleDe(d.denomination)) || lettreDe(d.denomination);
    if (!nouvelle || nouvelle === d.lettre) continue;
    const cle = `${d.denomination}|${d.lettre || ''}|${nouvelle}`;
    if (!parNom.has(cle)) parNom.set(cle, { denomination: d.denomination, actuelle: d.lettre, nouvelle, ids: [] });
    parNom.get(cle).ids.push(d.id);
  }
  const liste = [...parNom.values()].sort((x, y) => y.ids.length - x.ids.length || String(x.denomination).localeCompare(String(y.denomination), 'fr'));
  const total = liste.reduce((n, x) => n + x.ids.length, 0);
  if (!appliquer) return { total, entreprises: liste.length, exemples: liste.slice(0, 50).map(({ ids, ...x }) => ({ ...x, entrees: ids.length })) };
  if (!total) return { total: 0, modifiees: 0 };
  const ids = liste.flatMap((x) => x.ids);
  const lettres = liste.flatMap((x) => x.ids.map(() => x.nouvelle));
  const u = await db.query(
    `UPDATE dossiers_entres d SET lettre = x.l FROM unnest($2::int[], $3::text[]) AS x(id, l) WHERE d.tenant_id = $1 AND d.id = x.id`,
    [tenantId, ids, lettres]);
  await db.query('INSERT INTO audit_logs (id_user, action, request_id, tenant_id) VALUES ($1, $2, NULL, $3)',
    [user.id, `A appliqué la règle des lettres de classement aux entrées déjà importées (${u.rowCount} entrée${u.rowCount > 1 ? 's' : ''})`, tenantId]);
  return { total, modifiees: u.rowCount };
}

/**
 * Corrige la lettre de classement d'une entreprise : toutes ses entrées, et
 * les suivantes (la correction est retenue). `lettre` vide : retour à la règle.
 */
async function corrigerLettre(tenantId, user, { denomination, lettre } = {}) {
  const nom = texte(denomination, 255);
  if (!nom) throw erreur(400, 'Indiquez l\'entreprise dont la lettre change.');
  const automatique = lettre === null || lettre === undefined || String(lettre).trim() === '';
  const choisie = automatique ? lettreDe(nom) : lettreValide(lettre);
  if (!choisie) throw erreur(400, 'Lettre invalide : une lettre de A à Z, ou « # ».');
  const cle = cleDe(nom);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    if (automatique) await client.query('DELETE FROM lettres_classement WHERE tenant_id = $1 AND nom_simple = $2', [tenantId, cle]);
    else {
      await client.query(
        `INSERT INTO lettres_classement (tenant_id, nom_simple, lettre, corrige_par) VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, nom_simple) DO UPDATE SET lettre = EXCLUDED.lettre, corrige_par = EXCLUDED.corrige_par, corrige_le = now()`,
        [tenantId, cle, choisie, user.id]);
    }
    const r = await client.query(`UPDATE dossiers_entres SET lettre = $3 WHERE tenant_id = $1 AND ${NOM_SIMPLE} = $2 AND lettre IS DISTINCT FROM $3`, [tenantId, cle, choisie]);
    await client.query('INSERT INTO audit_logs (id_user, action, request_id, tenant_id) VALUES ($1, $2, NULL, $3)',
      [user.id, `A classé « ${nom} » ${automatique ? 'selon la règle' : 'à la main'} sous la lettre ${choisie} (${r.rowCount} entrée${r.rowCount > 1 ? 's' : ''})`.slice(0, 500), tenantId]);
    await client.query('COMMIT');
    return { lettre: choisie, automatique, modifiees: r.rowCount };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e.code === '42P01') throw erreur(503, 'La correction des lettres arrive avec la prochaine mise à jour de la base.');
    throw e;
  } finally {
    client.release();
  }
}

/** Recherche : nom, n° d'acte (« 1964 », « 2026/58 »), type, agent, période. */
async function rechercher(tenantId, { q, type, agent, du, au } = {}) {
  const conds = ['tenant_id = $1'];
  const params = [tenantId];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const saisie = texte(q, 100);
  let condNom = null;
  let nomCherche = null;
  if (saisie) {
    const acteAnnee = /^((?:19|20)\d{2})\s*\/\s*(\d+)$/.exec(saisie);
    if (acteAnnee) {
      conds.push(`${p(Number(acteAnnee[2]))} = ANY(actes)`, `extract(year FROM date_point) = ${p(Number(acteAnnee[1]))}`);
    } else if (/^\d+$/.test(saisie)) {
      // Un numéro : l'acte exact (« 1964 » ne ramène pas « 11964 »).
      conds.push(`${p(Number(saisie))} = ANY(actes)`);
    } else {
      condNom = `denomination ILIKE ${p(`%${saisie.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)}`;
      conds.push(condNom);
      nomCherche = saisie;
    }
  }
  if (texte(type, 100)) conds.push(`type_garantie = ${p(texte(type, 100))}`);
  if (texte(agent, 100)) conds.push(`upper(agent) = upper(${p(texte(agent, 100))})`);
  if (jour(du)) conds.push(`date_point >= ${p(String(du).slice(0, 10))}::date`);
  if (jour(au)) conds.push(`date_point <= ${p(String(au).slice(0, 10))}::date`);
  if (conds.length === 1) throw erreur(400, 'Tapez un nom ou un n° d\'acte, ou choisissez un filtre.');
  const requete = (conditions, ordre = 'date_point DESC, num_ordre') => db.query(
    `SELECT d.id, to_char(d.date_point, 'YYYY-MM-DD') AS date_point, to_char(d.semaine, 'YYYY-MM-DD') AS semaine, d.rubrique, d.num_ordre,
            d.num_actes, d.denomination, d.lettre, d.type_garantie, d.montant, d.agent, ${ARMOIRE_SQL('d')} AS armoire
       FROM dossiers_entres d WHERE ${conditions.join(' AND ')}
      ORDER BY ${ordre} LIMIT 300`,
    params
  );
  const r = await requete(conds);
  // Aucun nom écrit ainsi : les noms proches (« Crédo B.T.P » → « CREDO BTP SARL »), à vérifier.
  if (!r.rows.length && nomCherche) {
    const proches = await nomsProches.proches(tenantId, nomSimple(nomCherche));
    if (proches.length) {
      const pn = p(proches.map((x) => x.nom));
      const conds2 = conds.map((c) => (c === condNom ? `(${condNom} OR ${NOM_SIMPLE} = ANY(${pn}::text[]))` : c));
      const r2 = await requete(conds2, `array_position(${pn}::text[], ${NOM_SIMPLE}), date_point DESC, num_ordre`);
      return r2.rows.map((x) => ({ ...x, approche: true }));
    }
  }
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

// ---------------------------------------------------------------------------
// Présence d'un dossier demandé aux archives : est-il entré, et quand ?
// La semaine de production et la date du point sont ce dont l'archiviste a
// besoin pour aller le chercher ; le demandeur le voit en demandant.
// ---------------------------------------------------------------------------

const { NOM_SIMPLE, nomSimple } = require('../helpers/nomEntreprise');

/**
 * Le n° d'acte d'une demande : « 2026/58 » ou « CBE-2026-0058 » → 58 de
 * 2026 ; « 71 à 74 », « 1963-1964 » → ces numéros ; « 13802 » → 13802.
 */
function acteDemande(brut) {
  const s = String(brut ?? '').trim();
  const m = /^((?:19|20)\d{2})\s*\/\s*(\d+)$/.exec(s) || /(?:^|\D)((?:19|20)\d{2})\s*[-/.]\s*(\d{1,6})$/.exec(s);
  if (m && (/[^\d\s/-]/.test(s) || s.includes('/'))) return { numeros: [Number(m[2])], annee: Number(m[1]) };
  return { numeros: actesDe(s).filter((n) => n < 1e9), annee: null };
}

const MAX_PRESENCES = 200;
// Ressemblance minimale de deux noms (trigrammes) : une faute de frappe passe
// (« Zenit » / « Zénith » : 0,8), deux sociétés voisines non (0,48).
const SEUIL_NOM = 0.6;

/** Une recherche : par n° d'acte (le nom ne fait que classer) ou par nom. */
async function chercherEntrees(tenantId, { nom, numeros, annee }) {
  const params = [tenantId];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const conds = ['tenant_id = $1'];
  let scoreNom = '0';
  if (nom.length >= 2) {
    const like = p(`%${nom.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const pn = p(nom);
    scoreNom = `CASE WHEN ${NOM_SIMPLE} LIKE ${like} THEN 1 ELSE similarity(${NOM_SIMPLE}, ${pn}) END`;
    if (!numeros.length) conds.push(`(${NOM_SIMPLE} LIKE ${like} OR ${NOM_SIMPLE} % ${pn})`);
  }
  if (numeros.length) conds.push(`actes && ${p(numeros)}::int[]`);
  let ordreAnnee = '0';
  if (annee) {
    conds.push(`date_point BETWEEN ${p(`${annee}-01-01`)}::date AND ${p(`${annee + 1}-12-31`)}::date`);
    ordreAnnee = `CASE WHEN extract(year FROM date_point) = ${p(annee)} THEN 0 ELSE 1 END`;
  }
  const r = await db.query(
    `SELECT *, count(*) OVER ()::int AS total FROM (
       SELECT to_char(date_point, 'YYYY-MM-DD') AS date_point, to_char(semaine, 'YYYY-MM-DD') AS semaine,
              to_char(semaine + 6, 'YYYY-MM-DD') AS au, rubrique, num_actes, denomination, lettre, type_garantie,
              ${ARMOIRE_SQL('dossiers_entres')} AS armoire,
              (${scoreNom})::float AS score_nom, ${ordreAnnee} AS ordre_annee,
              ${nom.length >= 2 ? `(${NOM_SIMPLE} = ${p(nom)})` : 'false'} AS exact
         FROM dossiers_entres WHERE ${conds.join(' AND ')}
     ) t
     WHERE ${numeros.length ? 'true' : `score_nom >= ${SEUIL_NOM}`}
     ORDER BY exact DESC, score_nom DESC, ordre_annee, date_point DESC
     LIMIT 5`,
    params
  );
  const avecNom = nom.length >= 2;
  // Aucun nom ne ressemble par les lettres : les noms proches par le sens (055), à vérifier.
  if (!r.rows.length && !numeros.length && nom.length >= 3) {
    const proches = await nomsProches.proches(tenantId, nom);
    if (proches.length) {
      const pr = [tenantId, proches.map((x) => x.nom)];
      const anneeCond = annee ? ` AND date_point BETWEEN $3::date AND $4::date` : '';
      if (annee) pr.push(`${annee}-01-01`, `${annee + 1}-12-31`);
      const r2 = await db.query(
        `SELECT to_char(date_point, 'YYYY-MM-DD') AS date_point, to_char(semaine, 'YYYY-MM-DD') AS semaine,
                to_char(semaine + 6, 'YYYY-MM-DD') AS au, rubrique, num_actes, denomination, lettre, type_garantie,
                ${ARMOIRE_SQL('dossiers_entres')} AS armoire, count(*) OVER ()::int AS total
           FROM dossiers_entres WHERE tenant_id = $1 AND ${NOM_SIMPLE} = ANY($2::text[])${anneeCond}
          ORDER BY array_position($2::text[], ${NOM_SIMPLE}), date_point DESC LIMIT 5`,
        pr
      );
      return {
        total: r2.rows[0]?.total || 0,
        entrees: r2.rows.map(({ total: _t, ...e }) => ({ ...e, nom_concorde: false, approche: true })),
      };
    }
  }
  return {
    total: r.rows[0]?.total || 0,
    entrees: r.rows.map(({ score_nom: s, ordre_annee: _o, total: _t, exact: _x, ...e }) => ({ ...e, nom_concorde: !avecNom || s >= SEUIL_NOM })),
  };
}

/**
 * Les entrées qui correspondent à un dossier demandé ({ nom_entreprise,
 * num_acte, annee }). Par n° d'acte s'il y en a un, sinon par nom. Si l'acte
 * n'est entré que sous un autre nom, le nom est cherché à son tour ; à
 * défaut, l'acte trouvé reste signalé « à vérifier ». L'année (celle de
 * l'acte ou le champ année) retient le point de cette année ou de la
 * suivante : un acte de décembre est souvent retiré en janvier. Seuls la
 * dénomination, les actes, le type et le classement sont rendus — ni
 * montants, ni commissions, ni agent.
 */
async function presence(tenantId, demande = {}) {
  const nom = nomSimple(texte(demande.nom_entreprise, 255));
  const acte = acteDemande(texte(demande.num_acte, 100));
  const anneeChamp = Number(String(demande.annee ?? '').trim());
  const annee = acte.annee || (Number.isInteger(anneeChamp) && anneeChamp >= 1950 && anneeChamp <= 2100 ? anneeChamp : null);
  if (!acte.numeros.length && nom.length < 3) return { recherche: false, total: 0, entrees: [] };
  let res = await chercherEntrees(tenantId, { nom, numeros: acte.numeros, annee });
  if (acte.numeros.length && nom.length >= 3 && !res.entrees.some((e) => e.nom_concorde)) {
    const parNom = await chercherEntrees(tenantId, { nom, numeros: [], annee });
    if (parNom.total) res = parNom;
  }
  // Les points des dossiers retirés d'abord ; les dossiers en cartons (non
  // retirés, ouvertures de compte) seulement en complément, et seulement ceux
  // qui correspondent bien (057).
  const cartons = await require('./cartonsService').trouver(tenantId, { nom, numeros: acte.numeros, annee })
    .then((l) => l.filter((c) => c.nom_concorde).slice(0, 3)).catch(() => []);
  return { recherche: true, ...res, cartons };
}

/** Présence de plusieurs dossiers d'un coup ({ cle, nom_entreprise, num_acte, annee }[]) → { cle: résultat }. */
async function presences(tenantId, dossiers) {
  if (!Array.isArray(dossiers)) throw erreur(400, 'Liste de dossiers attendue.');
  if (dossiers.length > MAX_PRESENCES) throw erreur(400, `Au plus ${MAX_PRESENCES} dossiers à la fois.`);
  const res = {};
  // Par paquets de 10 : la base n'est pas inondée, la réponse reste rapide.
  for (let i = 0; i < dossiers.length; i += 10) {
    const paquet = dossiers.slice(i, i + 10);
    const resultats = await Promise.all(paquet.map((d) => presence(tenantId, d || {})));
    paquet.forEach((d, k) => { res[String(d?.cle ?? i + k)] = resultats[k]; });
  }
  return res;
}

// ---------------------------------------------------------------------------
// Classeurs importés : la liste, et leur suppression (un classeur périmé, mal
// lu ou importé par erreur). Les lignes d'un classeur partent toutes ; le
// classeur corrigé peut être réimporté aussitôt.
// ---------------------------------------------------------------------------

/** Les classeurs importés : nom, nombre de lignes, période couverte, dernier import. */
async function fichiers(tenantId) {
  const r = await db.query(
    `SELECT d.fichier, count(*)::int AS lignes,
            to_char(min(d.date_point), 'YYYY-MM-DD') AS du, to_char(max(d.date_point), 'YYYY-MM-DD') AS au,
            max(d.created_at) AS importe_le,
            (array_agg(u.full_name ORDER BY d.created_at DESC))[1] AS importe_par
       FROM dossiers_entres d LEFT JOIN users u ON u.id = d.cree_par
      WHERE d.tenant_id = $1
      GROUP BY d.fichier
      ORDER BY max(d.created_at) DESC, d.fichier`,
    [tenantId]
  );
  return r.rows;
}

/**
 * Supprime les lignes d'un classeur (`fichier` : son nom, ou null pour les
 * lignes importées sans nom), ou de tous (`tous: true`). Journalisé.
 */
async function supprimerFichier(tenantId, user, { fichier, tous } = {}) {
  let r;
  let libelle;
  if (tous === true) {
    r = await db.query('DELETE FROM dossiers_entres WHERE tenant_id = $1', [tenantId]);
    libelle = 'tous les classeurs';
  } else if (fichier === null || (typeof fichier === 'string' && fichier.trim())) {
    r = fichier === null
      ? await db.query('DELETE FROM dossiers_entres WHERE tenant_id = $1 AND fichier IS NULL', [tenantId])
      : await db.query('DELETE FROM dossiers_entres WHERE tenant_id = $1 AND fichier = $2', [tenantId, fichier]);
    libelle = fichier === null ? 'les lignes importées sans nom de classeur' : `le classeur « ${fichier} »`;
  } else {
    throw erreur(400, 'Indiquez le classeur à supprimer.');
  }
  if (!r.rowCount) throw erreur(404, 'Aucune ligne de ce classeur n\'est enregistrée.');
  await db.query('INSERT INTO audit_logs (id_user, action, request_id, tenant_id) VALUES ($1, $2, NULL, $3)',
    [user.id, `A supprimé ${libelle} de l'entrée des dossiers (${r.rowCount} ligne${r.rowCount > 1 ? 's' : ''})`.slice(0, 500), tenantId]);
  nomsProches.indexer(tenantId);
  return { supprimees: r.rowCount };
}

module.exports = {
  fichiers, supprimerFichier,
  importer, semaines, semaine, rechercher, filtres, presence, presences,
  semaineDe, actesDe, lettreDe, corrigerLettre, lettresAnciennes, feriesDe, paques, nomSimple, acteDemande, LIMITE, MAX_PRESENCES,
};
