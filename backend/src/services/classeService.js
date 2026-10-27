// ============================================================================
// classeService — classes de documents (modèle M-Files).
//
// Une CLASSE (Facture, Contrat, Prorogation…) est un schéma de métadonnées
// non défaut : elle porte ses propres propriétés, qui s'ajoutent aux
// PROPRIÉTÉS COMMUNES (le schéma par défaut). Elle porte aussi :
//   — la CHARTE DE NOMMAGE (modele_nom) : le titre du document est calculé à
//     partir de ses propriétés, comme le « Nom ou titre » calculé de M-Files ;
//   — le RANGEMENT (dossier_defaut_id, sous_dossier_annee) : sa place dans le
//     plan de classement.
//
// `appliquer` est rejoué après chaque modification de la fiche ou des
// propriétés : le titre suit les valeurs. Le compteur n'est attribué qu'une
// fois ; le rangement ne déplace jamais un document déjà classé à la main.
// ============================================================================
const db = require('../config/db');
const aclService = require('./aclService');
const { CLASSES, PLANS } = require('../config/modelesClasses');
const { CONSERVATION, COMMUNICABILITE, AVERTISSEMENT } = require('../config/referentielBenin');

/** Clé de comparaison d'un libellé : sans accents, sans casse, « N° » → « n ». */
function cle(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/n[°º]/g, 'n ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Jetons de la fiche, sous plusieurs écritures.
const JETONS_FICHE = {
  entreprise: 'nom_entreprise',
  'nom entreprise': 'nom_entreprise',
  'n dossier': 'num_dossier',
  'n de dossier': 'num_dossier',
  'numero de dossier': 'num_dossier',
  'n acte': 'num_acte',
  'n d acte': 'num_acte',
  reference: 'reference_mfile',
};

/** Valeur lisible d'une propriété (liste → libellé, booléen → Oui/Non). */
function lisible(valeur, champ) {
  if (valeur === null || valeur === undefined || valeur === '') return '';
  if (typeof valeur === 'boolean') return valeur ? 'Oui' : 'Non';
  if (Array.isArray(valeur)) return valeur.map((v) => lisible(v, champ)).filter(Boolean).join(', ');
  const options = Array.isArray(champ?.options_json) ? champ.options_json : [];
  const opt = options.find((o) => (typeof o === 'string' ? o : o.value) === valeur);
  if (opt) return typeof opt === 'string' ? opt : (opt.label || opt.value);
  if (champ?.type === 'date') return String(valeur).slice(0, 10);
  return String(valeur);
}

/**
 * Charte de nommage → titre. Fonction pure.
 *   {code} {classe} {année} {date} {compteur} {compteur:3}
 *   {Libellé d'une propriété} (de la classe ou commune)
 *   {entreprise} {n° de dossier} {n° d'acte} {référence}
 * Un jeton vide disparaît avec son séparateur : « FAC-2026- — X » ne sort pas.
 * @param {string} modele
 * @param {{ code?, classe?, annee?, date?, compteur?, proprietes?: object, fiche?: object }} ctx
 */
function rendreNom(modele, ctx = {}) {
  if (!modele || !String(modele).trim()) return '';
  const proprietes = ctx.proprietes || {};
  const fiche = ctx.fiche || {};
  const brut = String(modele).replace(/\{([^{}]+)\}/g, (_, jeton) => {
    const [nom, arg] = jeton.split(':');
    const k = cle(nom);
    if (k === 'compteur') {
      if (ctx.compteur === null || ctx.compteur === undefined) return '';
      return String(ctx.compteur).padStart(Number(arg) || 4, '0');
    }
    if (k === 'code') return ctx.code || '';
    if (k === 'classe') return ctx.classe || '';
    if (k === 'annee') return ctx.annee ? String(ctx.annee) : '';
    if (k === 'date') return ctx.date ? String(ctx.date).slice(0, 10) : '';
    if (proprietes[k] !== undefined) return proprietes[k];
    if (JETONS_FICHE[k]) {
      const v = fiche[JETONS_FICHE[k]];
      return v && String(v).trim() !== 'À indexer' ? String(v) : '';
    }
    return '';
  });
  // Séparateurs orphelins laissés par des jetons vides.
  return brut
    .replace(/\s+/g, ' ')
    .replace(/[\s\-—–_/|·]*[\-—–_/|·][\s\-—–_/|·]*/g, (m) => {
      // Une suite de séparateurs se réduit à un seul : le plus marqué.
      const seps = m.replace(/\s/g, '');
      if (seps.length < 2) return m;
      const sep = ['—', '–', '|', '·', '/', '-', '_'].find((c) => seps.includes(c));
      return /\s/.test(m) ? ` ${sep} ` : sep;
    })
    .replace(/^[\s\-—–_/|·]+|[\s\-—–_/|·]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/** Classe de l'organisation (hors propriétés communes), ou null. */
async function classe(tenantId, classeId, run = db) {
  if (!Number.isInteger(Number(classeId))) return null;
  const { rows } = await run.query(
    'SELECT * FROM metadata_schemas WHERE id = $1 AND tenant_id = $2 AND is_default IS NOT TRUE',
    [Number(classeId), tenantId]
  );
  return rows[0] || null;
}

/** Propriétés d'un document, indexées par clé de libellé, en valeurs lisibles. */
async function proprietesDocument(run, tenantId, documentId) {
  const { rows } = await run.query(
    `SELECT f.label, f.type, f.options_json, v.value_json
       FROM metadata_values v
       JOIN metadata_fields f ON f.id = v.field_id
       JOIN metadata_schemas s ON s.id = f.schema_id AND s.tenant_id = $2
      WHERE v.document_id = $1`,
    [documentId, tenantId]
  );
  const props = {};
  for (const r of rows) {
    const v = lisible(r.value_json, r.options_json ? r : null);
    if (v) props[cle(r.label)] = v;
  }
  return props;
}

const anneeDe = (doc) => {
  if (doc.date_document) return new Date(doc.date_document).getFullYear();
  if (doc.annee) return Number(doc.annee);
  return new Date().getFullYear();
};

/** Dossier de rangement d'une classe (sous-dossier de l'année créé au besoin). */
async function dossierDeRangement(run, tenantId, userId, cls, annee) {
  if (!cls.dossier_defaut_id) return null;
  let cible = cls.dossier_defaut_id;
  if (cls.sous_dossier_annee) {
    const nom = String(annee);
    const existant = await run.query(
      'SELECT id FROM document_folders WHERE tenant_id = $1 AND parent_id = $2 AND name = $3 LIMIT 1',
      [tenantId, cible, nom]
    );
    if (existant.rows[0]) cible = existant.rows[0].id;
    else {
      const cree = await run.query(
        'INSERT INTO document_folders (tenant_id, parent_id, name, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
        [tenantId, cible, nom, userId || null]
      );
      cible = cree.rows[0].id;
    }
  }
  return cible;
}

/**
 * Applique la classe d'un document : type, numéro, titre, rangement.
 * @returns {Promise<null|{ nom: string|null, dossier_id: number|null, numero: number|null }>}
 */
async function appliquer(tenantId, documentId, userId) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT * FROM documents WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
      [documentId, tenantId]
    );
    const doc = rows[0];
    const cls = doc && doc.classe_id ? await classe(tenantId, doc.classe_id, client) : null;
    if (!cls) { await client.query('COMMIT'); return null; }

    const annee = anneeDe(doc);
    const maj = { type_document: cls.name };

    // Compteur : une fois pour toutes, à la première application.
    let numero = doc.numero_classe;
    if (numero == null && /\{\s*compteur/i.test(cls.modele_nom || '')) {
      const c = await client.query(
        `INSERT INTO classe_compteurs (schema_id, annee, valeur) VALUES ($1, $2, 1)
         ON CONFLICT (schema_id, annee) DO UPDATE SET valeur = classe_compteurs.valeur + 1
         RETURNING valeur`,
        [cls.id, annee]
      );
      numero = c.rows[0].valeur;
      maj.numero_classe = numero;
    }

    let nom = null;
    if (cls.modele_nom) {
      nom = rendreNom(cls.modele_nom, {
        code: cls.code, classe: cls.name, annee, date: doc.date_document ? new Date(doc.date_document).toISOString() : null,
        compteur: numero, proprietes: await proprietesDocument(client, tenantId, documentId), fiche: doc,
      });
      if (nom) maj.description = nom;
    }

    // Rangement : seulement un document non classé, et dans le périmètre de
    // l'utilisateur — la classe ne contourne pas les droits sur les dossiers.
    let dossierId = doc.dossier_id;
    if (!doc.dossier_id && cls.dossier_defaut_id) {
      const peut = !userId || await aclService.peutEcrire(tenantId, userId, cls.dossier_defaut_id);
      if (peut) {
        dossierId = await dossierDeRangement(client, tenantId, userId, cls, annee);
        if (dossierId) maj.dossier_id = dossierId;
      }
    }

    const cles = Object.keys(maj).filter((k) => String(maj[k] ?? '') !== String(doc[k] ?? ''));
    if (cles.length) {
      await client.query(
        `UPDATE documents SET ${cles.map((k, i) => `${k} = $${i + 1}`).join(', ')}, updated_at = CURRENT_TIMESTAMP
          WHERE id = $${cles.length + 1} AND tenant_id = $${cles.length + 2}`,
        [...cles.map((k) => maj[k]), documentId, tenantId]
      );
    }
    await client.query('COMMIT');
    // Un sous-dossier d'année a pu être créé : le cache des périmètres doit le
    // connaître, sinon le document rangé serait refusé jusqu'à 60 s.
    if (maj.dossier_id) aclService.invalidate();
    return { nom, dossier_id: dossierId || null, numero: numero ?? null };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Aperçu d'une charte sans rien écrire (écran d'administration, poste
 * d'indexation). Le compteur montré est le PROCHAIN numéro.
 * @param {{ modele: string, classe_id?: number, valeurs?: object, fiche?: object }} entree
 */
async function apercu(tenantId, { modele, classe_id: classeId, valeurs = {}, fiche = {} }) {
  const cls = classeId ? await classe(tenantId, classeId) : null;
  const annee = fiche.date_document ? new Date(fiche.date_document).getFullYear() : Number(fiche.annee) || new Date().getFullYear();
  const ids = Object.keys(valeurs).map(Number).filter(Number.isInteger);
  const proprietes = {};
  if (ids.length) {
    const { rows } = await db.query(
      `SELECT f.id, f.label, f.type, f.options_json FROM metadata_fields f
         JOIN metadata_schemas s ON s.id = f.schema_id AND s.tenant_id = $2 WHERE f.id = ANY($1)`,
      [ids, tenantId]
    );
    for (const f of rows) {
      const v = lisible(valeurs[f.id], f);
      if (v) proprietes[cle(f.label)] = v;
    }
  }
  let compteur = null;
  if (/\{\s*compteur/i.test(modele || '')) {
    compteur = 1;
    if (cls) {
      const c = await db.query('SELECT valeur FROM classe_compteurs WHERE schema_id = $1 AND annee = $2', [cls.id, annee]);
      compteur = (c.rows[0]?.valeur || 0) + 1;
    }
  }
  return rendreNom(modele, {
    code: cls?.code || fiche.code || 'CODE', classe: cls?.name || fiche.classe || '', annee,
    date: fiche.date_document || null, compteur, proprietes, fiche,
  });
}

// ---------------------------------------------------------------------------
// Modèles DocuFlow
// ---------------------------------------------------------------------------

/**
 * Règle de conservation proposée pour un code de classe (référentiel béninois),
 * avec le libellé de sa communicabilité — null si le référentiel n'en a pas.
 */
function regleConservation(code) {
  const r = CONSERVATION[code];
  if (!r) return null;
  const comm = COMMUNICABILITE[r.communicabilite] || null;
  return { ...r, communicabilite_libelle: comm?.libelle || null };
}

/** Catalogue présenté à l'organisation, avec ce qu'elle a déjà installé. */
async function catalogue(tenantId) {
  const { rows } = await db.query('SELECT lower(name) AS n, code FROM metadata_schemas WHERE tenant_id = $1', [tenantId]);
  const noms = new Set(rows.map((r) => r.n));
  const dossiers = (await db.query('SELECT name FROM document_folders WHERE tenant_id = $1', [tenantId])).rows.map((r) => r.name);
  return {
    classes: CLASSES.map((c) => ({
      code: c.code, nom: c.nom, categorie: c.categorie, modele_nom: c.modele_nom,
      champs: c.champs.map(([label, type, requis]) => ({ label, type, requis: Boolean(requis) })),
      conservation: regleConservation(c.code),
      installee: noms.has(c.nom.toLowerCase()),
    })),
    avertissement_conservation: AVERTISSEMENT,
    plans: PLANS.map((p) => ({
      code: p.code, nom: p.nom, arbre: p.arbre,
      installe: p.arbre.every(([racine]) => dossiers.includes(racine)),
    })),
  };
}

/** Dossier existant dont le nom, sans son code de classement, correspond. */
async function trouverDossier(run, tenantId, noms) {
  const { rows } = await run.query('SELECT id, name FROM document_folders WHERE tenant_id = $1 ORDER BY id', [tenantId]);
  const sansCode = (n) => cle(String(n).replace(/^\s*\d+[\s.-]*/, ''));
  for (const voulu of noms || []) {
    const trouve = rows.find((r) => sansCode(r.name) === cle(voulu));
    if (trouve) return trouve.id;
  }
  return null;
}

/**
 * Installe des classes du catalogue. Une classe du même nom déjà présente est
 * laissée telle quelle (l'organisation l'a peut-être adaptée).
 * @returns {Promise<{ installees: string[], ignorees: string[] }>}
 */
async function installerClasses(tenantId, codes) {
  const voulues = CLASSES.filter((c) => (codes || []).includes(c.code));
  const installees = [];
  const ignorees = [];
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    for (const c of voulues) {
      const existe = await client.query('SELECT id FROM metadata_schemas WHERE tenant_id = $1 AND lower(name) = lower($2)', [tenantId, c.nom]);
      if (existe.rows[0]) { ignorees.push(c.nom); continue; }
      const dossier = await trouverDossier(client, tenantId, c.dossiers);
      const s = await client.query(
        `INSERT INTO metadata_schemas (tenant_id, name, description, is_default, code, mots_cles, modele_nom, dossier_defaut_id, sous_dossier_annee, nature_conformite)
         VALUES ($1, $2, $3, FALSE, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [tenantId, c.nom, `Modèle DocuFlow — ${c.categorie}`, c.code, c.mots_cles, c.modele_nom, dossier, Boolean(c.annee && dossier), c.nature || null]
      );
      // Règle de conservation proposée (référentiel béninois) : posée d'office,
      // l'archiviste l'ajuste et la fait valider par la DAN (D. 2007-532, art. 40).
      const regle = CONSERVATION[c.code];
      if (regle) {
        await client.query(
          `UPDATE metadata_schemas SET dua_annees = $2, dua_point_depart = $3, sort_final = $4, dua_reference = $5, communicabilite = $6 WHERE id = $1`,
          [s.rows[0].id, regle.dua, regle.depart, regle.sort, regle.ref, regle.communicabilite]
        );
      }
      const pris = new Set();
      let ordre = 0;
      for (const [label, type, requis, options] of c.champs) {
        let name = cle(label).replace(/ /g, '_') || 'champ';
        while (pris.has(name)) name += '_';
        pris.add(name);
        ordre += 1;
        const opts = (options || []).map((o) => ({ value: cle(o).replace(/ /g, '_'), label: o }));
        await client.query(
          `INSERT INTO metadata_fields (schema_id, name, label, type, required, display_order, options_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [s.rows[0].id, name, label, type, Boolean(requis), ordre, JSON.stringify(opts)]
        );
      }
      installees.push(c.nom);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return { installees, ignorees };
}

/**
 * Installe un plan de classement : crée les dossiers manquants (rien n'est
 * renommé ni déplacé), puis rattache aux dossiers du plan les classes qui
 * n'ont pas encore de rangement.
 * @returns {Promise<{ crees: number, classesRattachees: number }|null>} null si plan inconnu
 */
async function installerPlan(tenantId, code, userId) {
  const plan = PLANS.find((p) => p.code === code);
  if (!plan) return null;
  const client = await db.pool.connect();
  let crees = 0;
  let classesRattachees = 0;
  try {
    await client.query('BEGIN');
    const assurer = async (nom, parentId) => {
      const r = await client.query(
        `SELECT id FROM document_folders WHERE tenant_id = $1 AND name = $2 AND parent_id IS NOT DISTINCT FROM $3 LIMIT 1`,
        [tenantId, nom, parentId]
      );
      if (r.rows[0]) return r.rows[0].id;
      crees += 1;
      return (await client.query(
        'INSERT INTO document_folders (tenant_id, parent_id, name, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
        [tenantId, parentId, nom, userId || null]
      )).rows[0].id;
    };
    for (const [racine, enfants] of plan.arbre) {
      const id = await assurer(racine, null);
      for (const e of enfants) await assurer(e, id);
    }
    // Classes du catalogue sans rangement : on les rattache au plan.
    const sans = await client.query(
      'SELECT id, name FROM metadata_schemas WHERE tenant_id = $1 AND is_default IS NOT TRUE AND dossier_defaut_id IS NULL', [tenantId]);
    for (const s of sans.rows) {
      const modele = CLASSES.find((c) => c.nom.toLowerCase() === s.name.toLowerCase());
      const noms = modele ? modele.dossiers : [s.name];
      const dossier = await trouverDossier(client, tenantId, noms);
      if (dossier) {
        await client.query('UPDATE metadata_schemas SET dossier_defaut_id = $1, sous_dossier_annee = $2 WHERE id = $3',
          [dossier, Boolean(modele?.annee), s.id]);
        classesRattachees += 1;
      }
    }
    await client.query('COMMIT');
    if (crees) aclService.invalidate();
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return { crees, classesRattachees };
}

/**
 * Pose la règle de conservation du référentiel sur les classes de
 * l'organisation qui n'en ont PAS encore (reconnues par leur code, à défaut
 * leur nom). Une règle déjà saisie n'est jamais écrasée.
 * @returns {Promise<{ appliquees: string[], deja: string[], inconnues: string[] }>}
 */
async function appliquerReferentiel(tenantId, user) {
  // Chargé ici : archivageService journalise la règle (DUA_MODIFIEE) comme
  // une saisie à la main, et n'importe pas ce module.
  const archivage = require('./archivageService');
  const { rows } = await db.query(
    'SELECT id, name, code, dua_annees FROM metadata_schemas WHERE tenant_id = $1 AND is_default IS NOT TRUE ORDER BY name', [tenantId]);
  const appliquees = []; const deja = []; const inconnues = [];
  for (const r of rows) {
    const modele = CLASSES.find((c) => (r.code && c.code === r.code) || c.nom.toLowerCase() === String(r.name).toLowerCase());
    const regle = modele && CONSERVATION[modele.code];
    if (!regle) { inconnues.push(r.name); continue; }
    if (r.dua_annees != null) { deja.push(r.name); continue; }
    await archivage.definirDua(tenantId, r.id, {
      dua_annees: regle.dua, dua_point_depart: regle.depart, sort_final: regle.sort, dua_reference: regle.ref,
      communicabilite: regle.communicabilite,
    }, user);
    appliquees.push(r.name);
  }
  return { appliquees, deja, inconnues };
}

module.exports = {
  appliquerReferentiel, regleConservation,
  cle, rendreNom, lisible, classe, appliquer, apercu, catalogue, installerClasses, installerPlan, trouverDossier,
};
