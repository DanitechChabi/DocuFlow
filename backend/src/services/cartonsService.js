// ============================================================================
// Dossiers en cartons (057) : les fonds rangés par carton, importés de leurs
// classeurs (le navigateur lit le classeur, envoie les lignes).
//   non_retires      — dossiers que les clients n'ont pas retirés, ou annulés ;
//   ouverture_compte — répertoires d'ouverture de compte (matricule, client).
// On y cherche par nom, n° d'acte ou matricule : le carton dit où aller.
// ============================================================================

const crypto = require('crypto');
const db = require('../config/db');
const { NOM_SIMPLE, nomSimple } = require('../helpers/nomEntreprise');

const FONDS = {
  non_retires: 'Dossiers non retirés / annulés',
  ouverture_compte: 'Ouvertures de compte',
};
const STATUTS = { non_retire: 'Non retiré / annulé', annule: 'Annulé' };
const LIMITE = 3000;
const SEUIL_NOM = 0.6;

function erreur(statut, message) {
  const e = new Error(message);
  e.statut = statut;
  return e;
}
const texte = (v, max) => {
  const s = v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};
const sansAccents = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** « 12877 à 12879 », « 13514-13515 », « 00208-00209 », « NEANT » → numéros d'acte. */
function actesDe(brut) {
  const s = String(brut ?? '').trim();
  if (!s || /neant|n[ée]ant/i.test(s)) return [];
  const res = new Set();
  for (const m of s.matchAll(/(\d{1,6})\s*(?:à|a|-|au)\s*(\d{1,6})|(\d{1,6})/gi)) {
    if (m[3]) { res.add(Number(m[3])); continue; }
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (b >= a && b - a <= 50) for (let n = a; n <= b; n += 1) res.add(n);
    else { res.add(a); res.add(b); }
  }
  return [...res].filter((n) => n > 0 && n < 1e7);
}

/** Statut d'un dossier non retiré : « annulé » quand seule l'annulation est dite. */
function statutDe(brut) {
  const s = sansAccents(brut);
  if (!s) return 'non_retire';
  if (/retir/.test(s)) return 'non_retire';
  if (/annul/.test(s)) return 'annule';
  return 'non_retire';
}

/** « C3 », « CARTON 12 », « CARTON AOVC 5 » → « C3 », « Carton 12 », « AOVC 5 ». */
function cartonDe(brut) {
  const s = String(brut ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const aovc = /aovc\s*(\d+)/i.exec(s);
  if (aovc) return `AOVC ${Number(aovc[1])}`;
  const c = /^c\s*(\d+)$/i.exec(s);
  if (c) return `C${Number(c[1])}`;
  const carton = /carton\s*(\d+)/i.exec(s);
  if (carton) return `Carton ${Number(carton[1])}`;
  return s.slice(0, 40);
}

/**
 * Enregistre les lignes d'un classeur. Une ligne déjà importée est ignorée :
 * réimporter un classeur complété n'ajoute que ses nouvelles lignes.
 * @param {object[]} lignes [{ serie, carton, rang, denomination, matricule, actes, typologie, statut, annee, note }]
 */
async function importer(tenantId, user, { fonds, fichier, lignes } = {}) {
  if (!FONDS[fonds]) throw erreur(400, 'Fonds inconnu.');
  if (!Array.isArray(lignes) || !lignes.length) throw erreur(400, 'Aucune ligne à importer.');
  if (lignes.length > LIMITE) throw erreur(400, `Au plus ${LIMITE} lignes par envoi.`);
  const nomFichier = texte(fichier, 255);
  const valeurs = [];
  let rejetees = 0;
  for (const l of lignes) {
    const denomination = texte(l?.denomination, 255);
    const matricule = texte(l?.matricule, 60);
    const numActes = texte(l?.actes, 255);
    if (!denomination && !matricule && !actesDe(numActes).length) { rejetees += 1; continue; }
    const annee = Number(l?.annee);
    const v = {
      serie: texte(l.serie, 120), carton: cartonDe(l.carton), rang: Number.isInteger(Number(l.rang)) && l.rang !== '' && l.rang !== null ? Number(l.rang) : null,
      denomination, matricule, numActes, actes: actesDe(numActes), typologie: texte(l.typologie, 120),
      statut: fonds === 'non_retires' ? statutDe(l.statut) : null,
      annee: Number.isInteger(annee) && annee >= 1950 && annee <= 2100 ? annee : null, note: texte(l.note, 255),
    };
    v.empreinte = crypto.createHash('md5').update([fonds, v.serie, v.carton, v.denomination, v.matricule, v.numActes, v.typologie, v.annee].join('|')).digest('hex');
    valeurs.push(v);
  }
  if (!valeurs.length) return { ajoutees: 0, deja: 0, rejetees };
  const col = (k) => valeurs.map((v) => v[k]);
  const r = await db.query(
    `INSERT INTO dossiers_cartons (tenant_id, fonds, serie, carton, rang, denomination, matricule, num_actes, actes, typologie, statut, annee, note, fichier, empreinte, cree_par)
     SELECT $1, $2, x.se, x.ca, x.ra, x.de, x.ma, x.na, ARRAY(SELECT jsonb_array_elements_text(x.ac)::int), x.ty, x.st, x.an, x.no, $3, x.em, $4
       FROM unnest($5::text[], $6::text[], $7::int[], $8::text[], $9::text[], $10::text[], $11::jsonb[], $12::text[], $13::text[], $14::int[], $15::text[], $16::text[])
         AS x(se, ca, ra, de, ma, na, ac, ty, st, an, no, em)
     ON CONFLICT (tenant_id, empreinte) DO NOTHING`,
    [tenantId, fonds, nomFichier, user.id, col('serie'), col('carton'), col('rang'), col('denomination'), col('matricule'), col('numActes'),
      valeurs.map((v) => JSON.stringify(v.actes)), col('typologie'), col('statut'), col('annee'), col('note'), col('empreinte')]
  );
  if (r.rowCount) {
    await db.query('INSERT INTO audit_logs (id_user, action, request_id, tenant_id) VALUES ($1, $2, NULL, $3)',
      [user.id, `A importé ${r.rowCount} dossier${r.rowCount > 1 ? 's' : ''} en cartons (${FONDS[fonds]})${nomFichier ? ` — « ${nomFichier} »` : ''}`.slice(0, 500), tenantId]);
  }
  return { ajoutees: r.rowCount, deja: valeurs.length - r.rowCount, rejetees };
}

const COLONNES = `id, fonds, serie, carton, rang, denomination, matricule, num_actes, typologie, statut, annee, note`;

/** Recherche : nom, n° d'acte (« 13692 », « 2025/13692 »), matricule ; filtres fonds, carton, statut, année. */
async function rechercher(tenantId, { q, fonds, carton, statut, annee } = {}) {
  const conds = ['tenant_id = $1'];
  const params = [tenantId];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (fonds && FONDS[fonds]) conds.push(`fonds = ${p(fonds)}`);
  if (texte(carton, 40)) conds.push(`carton = ${p(cartonDe(carton))}`);
  if (statut && STATUTS[statut]) conds.push(`statut = ${p(statut)}`);
  if (Number(annee)) conds.push(`annee = ${p(Number(annee))}`);
  const saisie = texte(q, 100);
  let ordre = 'fonds, serie, carton, rang';
  if (saisie) {
    const acteAnnee = /^((?:19|20)\d{2})\s*\/\s*(\d+)$/.exec(saisie);
    if (acteAnnee) {
      conds.push(`(${p(Number(acteAnnee[2]))} = ANY(actes) AND (annee IS NULL OR annee BETWEEN ${p(Number(acteAnnee[1]))} AND ${p(Number(acteAnnee[1]) + 1)}))`);
    } else if (/^\d+$/.test(saisie)) {
      // Un numéro : un acte (7 chiffres au plus), ou un matricule / n° de compte.
      conds.push(saisie.length <= 7 ? `(${p(Number(saisie))} = ANY(actes) OR matricule = ${p(saisie)})` : `matricule = ${p(saisie)}`);
    } else {
      const nom = nomSimple(saisie);
      const pn = p(nom);
      const like = p(`%${nom.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      conds.push(`(${NOM_SIMPLE} LIKE ${like} OR ${NOM_SIMPLE} % ${pn})`);
      // Les noms qui contiennent la saisie d'abord, puis les plus ressemblants.
      ordre = `(${NOM_SIMPLE} LIKE ${like}) DESC, similarity(${NOM_SIMPLE}, ${pn}) DESC, fonds, carton`;
    }
  }
  if (conds.length === 1) throw erreur(400, 'Tapez un nom, un n° d\'acte ou un matricule, ou choisissez un carton.');
  const r = await db.query(`SELECT ${COLONNES} FROM dossiers_cartons WHERE ${conds.join(' AND ')} ORDER BY ${ordre} LIMIT 300`, params);
  return r.rows;
}

/** Les cartons d'un fonds : nombre de dossiers, séries, années. */
async function cartons(tenantId, fonds) {
  if (!FONDS[fonds]) throw erreur(400, 'Fonds inconnu.');
  const r = await db.query(
    `SELECT carton, count(*)::int AS dossiers, string_agg(DISTINCT serie, ', ') AS series,
            min(annee) AS de, max(annee) AS a, count(*) FILTER (WHERE statut = 'annule')::int AS annules
       FROM dossiers_cartons WHERE tenant_id = $1 AND fonds = $2
      GROUP BY carton
      ORDER BY carton IS NULL, regexp_replace(COALESCE(carton, ''), '\\d+', '', 'g'), NULLIF(regexp_replace(COALESCE(carton, ''), '\\D', '', 'g'), '')::int NULLS LAST`,
    [tenantId, fonds]
  );
  const total = await db.query('SELECT fonds, count(*)::int AS n FROM dossiers_cartons WHERE tenant_id = $1 GROUP BY fonds', [tenantId]);
  return { cartons: r.rows, totaux: Object.fromEntries(total.rows.map((x) => [x.fonds, x.n])) };
}

/**
 * Les dossiers en cartons qui correspondent à un dossier cherché (présence,
 * DocuBot) : par n° d'acte s'il y en a, sinon par nom ; 5 au plus.
 */
async function trouver(tenantId, { nom, numeros = [], annee = null }) {
  const params = [tenantId];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const conds = ['tenant_id = $1'];
  let score = '0';
  const simple = nomSimple(nom || '');
  if (simple.length >= 2) {
    const like = p(`%${simple.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const pn = p(simple);
    score = `CASE WHEN ${NOM_SIMPLE} LIKE ${like} THEN 1 ELSE similarity(${NOM_SIMPLE}, ${pn}) END`;
    if (!numeros.length) conds.push(`(${NOM_SIMPLE} LIKE ${like} OR ${NOM_SIMPLE} % ${pn})`);
  }
  const petits = numeros.filter((n) => n > 0 && n < 1e7);
  if (numeros.length) conds.push(`(${petits.length ? `actes && ${p(petits)}::int[] OR ` : ''}matricule = ANY(${p(numeros.map(String))}::text[]))`);
  if (!numeros.length && simple.length < 2) return [];
  if (annee) conds.push(`(annee IS NULL OR annee BETWEEN ${p(annee - 1)} AND ${p(annee + 1)})`);
  const r = await db.query(
    `SELECT * FROM (SELECT ${COLONNES}, (${score})::float AS score FROM dossiers_cartons WHERE ${conds.join(' AND ')}) t
      WHERE ${numeros.length ? 'true' : `score >= ${SEUIL_NOM}`}
      ORDER BY score DESC, annee DESC NULLS LAST LIMIT 5`,
    params
  );
  return r.rows.map(({ score, ...x }) => ({ ...x, libelle_fonds: FONDS[x.fonds], libelle_statut: STATUTS[x.statut] || null, nom_concorde: simple.length < 2 || score >= SEUIL_NOM }));
}

/** Les classeurs importés : fonds, lignes, cartons, dernier import. */
async function fichiers(tenantId) {
  const r = await db.query(
    `SELECT fichier, fonds, count(*)::int AS lignes, count(DISTINCT carton)::int AS cartons, to_char(max(cree_le), 'YYYY-MM-DD') AS importe_le
       FROM dossiers_cartons WHERE tenant_id = $1 GROUP BY fichier, fonds ORDER BY max(cree_le) DESC`,
    [tenantId]
  );
  return r.rows.map((x) => ({ ...x, libelle_fonds: FONDS[x.fonds] }));
}

async function supprimerFichier(tenantId, user, { fichier, fonds } = {}) {
  if (!FONDS[fonds]) throw erreur(400, 'Fonds inconnu.');
  const r = fichier === null
    ? await db.query('DELETE FROM dossiers_cartons WHERE tenant_id = $1 AND fonds = $2 AND fichier IS NULL', [tenantId, fonds])
    : await db.query('DELETE FROM dossiers_cartons WHERE tenant_id = $1 AND fonds = $2 AND fichier = $3', [tenantId, fonds, texte(fichier, 255)]);
  if (!r.rowCount) throw erreur(404, 'Aucune ligne de ce classeur n\'est enregistrée.');
  await db.query('INSERT INTO audit_logs (id_user, action, request_id, tenant_id) VALUES ($1, $2, NULL, $3)',
    [user.id, `A supprimé le classeur « ${fichier || 'sans nom'} » des dossiers en cartons (${r.rowCount} ligne${r.rowCount > 1 ? 's' : ''})`.slice(0, 500), tenantId]);
  return { supprimees: r.rowCount };
}

module.exports = { FONDS, STATUTS, LIMITE, actesDe, statutDe, cartonDe, importer, rechercher, cartons, trouver, fichiers, supprimerFichier };
