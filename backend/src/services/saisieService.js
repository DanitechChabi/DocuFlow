// ============================================================================
// saisieService — saisie en tableau des dossiers papier.
//
// Le traitement d'un fonds se termine par la saisie : une ligne par dossier,
// avec sa cote, ses dates extrêmes et sa description. Elle se fait d'ordinaire
// dans un tableau de traitement de texte, que personne ne peut interroger.
// Ici, chaque ligne devient une fiche : décrite par les propriétés de sa
// classe, nommée par la charte, rangée dans sa boîte, soumise à sa règle de
// conservation. Le répertoire et les étiquettes (migration 043) en découlent
// sans ressaisie.
//
// Deux temps. TOUTES les lignes sont contrôlées d'abord : une cellule fautive
// et rien n'est créé — chaque erreur désigne sa ligne et sa colonne. Les
// fiches sont créées ensuite, une transaction par ligne.
//
// Les valeurs arrivent telles qu'on les copie d'un tableur : « 57 000 000 »,
// « 15/03/2021 », « DAO », « oui ». Elles sont lues ici, une seule fois.
//
// Ce que la saisie ne fait PAS : démarrer le circuit de validation de la
// classe. Elle décrit des dossiers déjà traités, pas des documents entrants.
// ============================================================================
const db = require('../config/db');
const aclService = require('./aclService');
const roleService = require('./roleService');
const classeService = require('./classeService');
const metadataService = require('./metadataService');
const physique = require('./physiqueService');
const documentAuditService = require('./documentAuditService');
const { logHistory, setCanonicalReference } = require('./documentIndexService');

const { cle } = classeService;
const LIMITE = 200;
const TYPES_SAISIS = ['text', 'number', 'date', 'boolean', 'select', 'multiselect'];
const A_INDEXER = 'À indexer';

const erreur = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const vide = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && !v.length);
const court = (v) => { const s = String(v).trim(); return s.length > 40 ? `${s.slice(0, 40)}…` : s; };
const deux = (n) => String(n).padStart(2, '0');

// ------------------------------------------------------------------ lecture

/** Choix d'une liste, sous la forme { value, label }. */
function choixDe(champ) {
  const options = Array.isArray(champ.options_json) ? champ.options_json : (Array.isArray(champ.choix) ? champ.choix : []);
  return options
    .map((o) => (typeof o === 'string' ? { value: o, label: o } : { value: String(o.value ?? o.label ?? ''), label: String(o.label ?? o.value ?? '') }))
    .filter((o) => o.value);
}

/**
 * Retrouve un choix : par sa valeur, son libellé (sans accents ni casse), son
 * début ou sa fin — « DAO » comme « Dossier d'appel d'offres » désignent
 * « DAO — Dossier d'appel d'offres ». Une désignation ambiguë n'est pas lue.
 */
function trouverChoix(choix, brut) {
  const texte = String(brut).trim();
  const exact = choix.find((o) => o.value === texte || o.label === texte);
  if (exact) return exact;
  const k = cle(texte);
  if (!k) return null;
  const parCle = choix.filter((o) => cle(o.label) === k || cle(o.value) === k);
  if (parCle.length) return parCle.length === 1 ? parCle[0] : null;
  // « DAO » ou « Dossier d'appel d'offres » : le sigle seul, ou l'intitulé seul.
  const parDebut = choix.filter((o) => cle(o.label).startsWith(`${k} `));
  if (parDebut.length) return parDebut.length === 1 ? parDebut[0] : null;
  const parFin = choix.filter((o) => cle(o.label).endsWith(` ${k}`));
  return parFin.length === 1 ? parFin[0] : null;
}

/**
 * Nombre écrit à la française ou copié d'un tableur : « 57 000 000 »,
 * « 1 234,5 », « 57.000.000 », « 12 500 FCFA ». Un point suivi de trois
 * chiffres groupe les milliers (« 57.000 » = 57 000) ; la virgule est décimale.
 */
function lireNombre(brut) {
  if (typeof brut === 'number') return Number.isFinite(brut) ? brut : null;
  let s = String(brut).trim().replace(/[\s  '’]/g, '').replace(/(f\.?cfa|cfa|xof|francs?|f)\.?$/i, '');
  if (!/^[-+]?[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const virgules = (s.match(/,/g) || []).length;
  const points = (s.match(/\./g) || []).length;
  if (virgules && points) {
    // Le dernier séparateur est la décimale ; l'autre groupe les milliers.
    const decimale = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    s = s.split(decimale === ',' ? '.' : ',').join('').replace(decimale, '.');
  } else if (virgules > 1) s = s.replace(/,/g, '');
  else if (virgules === 1) s = s.replace(',', '.');
  else if (points > 1 || /^[-+]?\d{1,3}\.\d{3}$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const MOIS = {
  janvier: 1, janv: 1, jan: 1, fevrier: 2, fevr: 2, fev: 2, mars: 3, avril: 4, avr: 4, mai: 5, juin: 6,
  juillet: 7, juil: 7, aout: 8, septembre: 9, sept: 9, octobre: 10, oct: 10, novembre: 11, nov: 11, decembre: 12, dec: 12,
};

/** Date → AAAA-MM-JJ. Accepte AAAA-MM-JJ, JJ/MM/AAAA (ou . ou -), « 15 mars 2021 ». */
function lireDate(brut) {
  if (brut instanceof Date) return Number.isNaN(brut.getTime()) ? null : brut.toISOString().slice(0, 10);
  const s = String(brut).trim();
  let a; let m; let j;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (r) [a, m, j] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) [j, m, a] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = /^(\d{1,2})(?:er)?\s+(\S+)\s+(\d{4})$/i.exec(s))) [j, m, a] = [Number(r[1]), MOIS[cle(r[2])], Number(r[3])];
  else return null;
  if (!m || m > 12 || j < 1 || a < 1000 || a > 2200) return null;
  const d = new Date(Date.UTC(a, m - 1, j));
  if (d.getUTCFullYear() !== a || d.getUTCMonth() !== m - 1 || d.getUTCDate() !== j) return null;
  return `${a}-${deux(m)}-${deux(j)}`;
}

function lireBooleen(brut) {
  if (typeof brut === 'boolean') return brut;
  const k = cle(brut);
  if (['oui', 'o', 'vrai', 'x', '1', 'yes', 'y', 'true'].includes(k)) return true;
  if (['non', 'n', 'faux', '0', 'no', 'false'].includes(k)) return false;
  return null;
}

/**
 * Lit une cellule selon le type de sa propriété. Fonction pure.
 * @returns {{ valeur: any } | { erreur: string }} valeur null pour une cellule vide
 */
function lireValeur(champ, brut) {
  if (vide(brut)) return { valeur: null };
  switch (champ.type) {
    case 'number': {
      const n = lireNombre(brut);
      return n === null ? { erreur: 'Un nombre est attendu.' } : { valeur: n };
    }
    case 'date': {
      const d = lireDate(brut);
      return d ? { valeur: d } : { erreur: 'Une date est attendue, par exemple 15/03/2021.' };
    }
    case 'boolean': {
      const b = lireBooleen(brut);
      return b === null ? { erreur: 'Oui ou Non est attendu.' } : { valeur: b };
    }
    case 'select': {
      const o = trouverChoix(choixDe(champ), brut);
      return o ? { valeur: o.value } : { erreur: `« ${court(brut)} » n'est pas dans la liste.` };
    }
    case 'multiselect': {
      const choix = choixDe(champ);
      const entier = Array.isArray(brut) ? null : trouverChoix(choix, brut);
      if (entier) return { valeur: [entier.value] };
      const texte = Array.isArray(brut) ? null : String(brut);
      const morceaux = (Array.isArray(brut) ? brut : texte.split(/[;\n]/).length > 1 ? texte.split(/[;\n]/) : texte.split(','))
        .map((x) => String(x).trim()).filter(Boolean);
      const valeurs = [];
      for (const x of morceaux) {
        const o = trouverChoix(choix, x);
        if (!o) return { erreur: `« ${court(x)} » n'est pas dans la liste.` };
        if (!valeurs.includes(o.value)) valeurs.push(o.value);
      }
      return { valeur: valeurs };
    }
    default:
      return { valeur: String(brut).trim().slice(0, 4000) };
  }
}

/**
 * Dates extrêmes d'un dossier, en années : « 2019 », « 2019-2021 »,
 * « 2019 à 2021 ». Fonction pure.
 * @returns {{ debut: number|null, fin: number|null } | { erreur: string }}
 */
function lireDates(brut) {
  if (vide(brut)) return { debut: null, fin: null };
  const texte = String(brut).trim();
  const annees = (texte.match(/\d+/g) || []);
  const reste = cle(texte.replace(/\d+/g, ' ')).replace(/\b(de|du|a|au|et)\b/g, '').trim();
  if (!annees.length || annees.length > 2 || annees.some((a) => a.length !== 4) || reste) {
    return { erreur: 'Écrivez les années : 2019, ou 2019-2021.' };
  }
  const [debut, fin] = [Number(annees[0]), Number(annees[annees.length - 1])];
  if ([debut, fin].some((a) => a < 1000 || a > 2200)) return { erreur: 'Année hors de portée.' };
  if (fin < debut) return { erreur: 'La fin précède le début.' };
  return { debut, fin };
}

// Colonnes historiques de la fiche (obligatoires en base), déduites des
// propriétés de la classe : la recherche par tiers ou par numéro continue de
// trouver les dossiers saisis ici.
const MOTIFS_FICHE = {
  nom_entreprise: /\b(attributaire|titulaire|soumissionnaire|fournisseur|prestataire|entreprise|societe|raison sociale|cocontractant|beneficiaire|expediteur|destinataire|employe|salarie|demandeur|client)\b/,
  num_dossier: /^(reference( du dossier| du marche)?|(n|numero)( de| du)? (dossier|marche))$/,
  num_acte: /^(n|numero)( de| du| d)? (contrat|acte|facture|arrete|decision|commande|bon de commande|piece|courrier|enregistrement)$/,
};
const DATE_HORS_DOCUMENT = /\b(expiration|echeance|fin|limite|validite|naissance|retour|paiement)\b/;

/**
 * Fiche d'un dossier saisi, déduite de ses propriétés. Fonction pure.
 * @param {Array} colonnes colonnes de la grille (id, libelle, type, est_echeance)
 * @param {Map<number, any>} valeurs valeurs lues, par identifiant de propriété
 * @param {{ debut: number|null, fin: number|null }} dates
 */
function ficheDe(colonnes, valeurs, dates = {}, aujourdhui = new Date()) {
  const texte = (motif) => {
    const c = colonnes.find((x) => x.type === 'text' && motif.test(cle(x.libelle)) && !vide(valeurs.get(x.id)));
    return c ? String(valeurs.get(c.id)) : null;
  };
  const dateDoc = colonnes.find((x) => x.type === 'date' && !x.est_echeance && !DATE_HORS_DOCUMENT.test(cle(x.libelle)) && !vide(valeurs.get(x.id)));
  const date = dateDoc ? valeurs.get(dateDoc.id) : null;
  return {
    nom_entreprise: (texte(MOTIFS_FICHE.nom_entreprise) || A_INDEXER).slice(0, 255),
    num_dossier: (texte(MOTIFS_FICHE.num_dossier) || A_INDEXER).slice(0, 50),
    num_acte: (texte(MOTIFS_FICHE.num_acte) || A_INDEXER).slice(0, 50),
    annee: dates.debut || (date ? Number(date.slice(0, 4)) : null) || dates.fin || aujourdhui.getFullYear(),
    date_document: date,
  };
}

/** Désigne une boîte par sa cote complète, ou par son code s'il est unique. */
function trouverBoite(boites, brut) {
  const k = String(brut).trim().toLowerCase();
  const parCote = boites.filter((b) => String(b.cote).toLowerCase() === k);
  if (parCote.length === 1) return { boite: parCote[0] };
  const parCode = boites.filter((b) => String(b.code).toLowerCase() === k);
  if (parCode.length === 1) return { boite: parCode[0] };
  if (parCode.length > 1) return { erreur: `Plusieurs boîtes portent le code « ${court(brut)} » : écrivez la cote complète, par exemple ${parCode[0].cote}.` };
  return { erreur: `Boîte « ${court(brut)} » inconnue : créez-la dans Magasins.`, inconnue: String(brut).trim() };
}

// ------------------------------------------------------------------ modèle

const versColonne = (f, commune) => ({
  id: f.id, libelle: f.label, type: f.type, obligatoire: Boolean(f.required), commune,
  est_echeance: Boolean(f.est_echeance), choix: choixDe(f), defaut: f.default_value_json ?? null,
});

/** Colonnes de la grille pour une classe : ses propriétés, puis les propriétés communes. */
async function colonnesDe(run, tenantId, classeId) {
  const { rows } = await run.query(
    `SELECT f.id, f.label, f.type, f.required, f.options_json, f.default_value_json, f.est_echeance, COALESCE(s.is_default, false) AS commune
       FROM metadata_fields f JOIN metadata_schemas s ON s.id = f.schema_id
      WHERE s.tenant_id = $1 AND (s.id = $2 OR s.is_default IS TRUE) AND f.type = ANY($3)
      ORDER BY COALESCE(s.is_default, false), f.display_order, f.id`,
    [tenantId, classeId, TYPES_SAISIS]
  );
  return rows.map((f) => versColonne(f, f.commune));
}

const versBoite = (e) => ({
  id: e.id, type: e.type, code: e.code, cote: e.cote, libelle: e.libelle || null, fonds: e.fonds || null,
  type_boite: e.type_boite || null, couleur_etiquette: e.couleur_etiquette || null, nb_documents: e.nb_documents,
});

/** Ce qu'il faut pour dresser la grille : classes et leurs colonnes, boîtes. */
async function modele(tenantId, user = null) {
  const [schemas, champs, emplacements] = await Promise.all([
    db.query(
      `SELECT id, name, code, modele_nom, COALESCE(is_default, false) AS commune, dua_annees, sort_final
         FROM metadata_schemas WHERE tenant_id = $1 ORDER BY name`, [tenantId]),
    db.query(
      `SELECT f.id, f.schema_id, f.label, f.type, f.required, f.options_json, f.default_value_json, f.est_echeance
         FROM metadata_fields f JOIN metadata_schemas s ON s.id = f.schema_id
        WHERE s.tenant_id = $1 AND f.type = ANY($2) ORDER BY f.display_order, f.id`, [tenantId, TYPES_SAISIS]),
    physique.lister(tenantId),
  ]);
  const de = (schemaId, commune) => champs.rows.filter((f) => f.schema_id === schemaId).map((f) => versColonne(f, commune));
  const defaut = schemas.rows.find((s) => s.commune);
  return {
    classes: schemas.rows.filter((s) => !s.commune).map((s) => ({
      id: s.id, nom: s.name, code: s.code || null, modele_nom: s.modele_nom || null,
      conservation: s.dua_annees === null || s.dua_annees === undefined ? null : { dua_annees: s.dua_annees, sort_final: s.sort_final },
      colonnes: de(s.id, false),
    })),
    communes: defaut ? de(defaut.id, true) : [],
    boites: emplacements.filter((e) => ['boite', 'tablette'].includes(e.type)).map(versBoite),
    tablettes: emplacements.filter((e) => e.type === 'tablette').map((e) => ({ id: e.id, cote: e.cote, libelle: e.libelle || null })),
    peut_archiver: user ? await roleService.possede(tenantId, user.role, 'documents.archive') : false,
    peut_creer_boites: user ? await roleService.possede(tenantId, user.role, 'archives.manage') : false,
    limite: LIMITE,
  };
}

// --------------------------------------------------------------- contrôle

const texteDe = (v) => String(v ?? '').trim().toLowerCase();

/**
 * Doublons probables : mêmes valeurs dans toutes les propriétés OBLIGATOIRES
 * de la classe qu'un dossier déjà saisi (ou qu'une ligne précédente).
 */
async function chercherDoublons(tenantId, classeId, colonnes, lignes) {
  const cles = colonnes.filter((c) => c.obligatoire && !c.commune && c.type !== 'multiselect');
  if (!cles.length) return [];
  const signature = (valeurDe) => cles.map((c) => texteDe(valeurDe(c.id))).join('\u0001');
  const doublons = [];
  const vues = new Map();
  for (const l of lignes) {
    const s = signature((id) => l.valeurs.get(id));
    if (vues.has(s)) doublons.push({ ligne: l.index, motif: `Même dossier que la ligne ${vues.get(s) + 1}.` });
    else vues.set(s, l.index);
  }
  const premiers = [...new Set(lignes.map((l) => texteDe(l.valeurs.get(cles[0].id))))];
  const { rows } = await db.query(
    `SELECT v.document_id, v.field_id, v.value_json #>> '{}' AS valeur, d.reference_mfile, d.description
       FROM metadata_values v JOIN documents d ON d.id = v.document_id
      WHERE d.tenant_id = $1 AND d.classe_id = $2 AND d.deleted_at IS NULL AND d.elimine_at IS NULL
        AND v.field_id = ANY($3::int[])
        AND v.document_id IN (SELECT v1.document_id FROM metadata_values v1
                               WHERE v1.field_id = $4 AND lower(btrim(v1.value_json #>> '{}')) = ANY($5::text[]))`,
    [tenantId, classeId, cles.map((c) => c.id), cles[0].id, premiers]
  );
  const existants = new Map();
  for (const r of rows) {
    if (!existants.has(r.document_id)) existants.set(r.document_id, { reference: r.reference_mfile, titre: r.description, valeurs: new Map() });
    existants.get(r.document_id).valeurs.set(r.field_id, r.valeur);
  }
  const parSignature = new Map();
  for (const [id, e] of existants) parSignature.set(signature((champ) => e.valeurs.get(champ)), { document_id: id, reference: e.reference, titre: e.titre });
  for (const l of lignes) {
    const e = parSignature.get(signature((id) => l.valeurs.get(id)));
    if (e && !doublons.some((d) => d.ligne === l.index)) {
      doublons.push({ ligne: l.index, document_id: e.document_id, reference: e.reference, motif: `Déjà saisi : ${e.titre || e.reference}.` });
    }
  }
  return doublons.sort((a, b) => a.ligne - b.ligne);
}

/**
 * Contrôle un lot sans rien écrire.
 * @param {{ classe_id, emplacement_id?, dossier_id?, archiver?: boolean, lignes: Array<{ valeurs?: object, cote?, dates?, boite?, emplacement_id? }> }} corps
 * @returns {Promise<{ classe, colonnes, dossierId, lignes: Array, erreurs: Array<{ligne, colonne, message}>, doublons: Array, boites_inconnues: string[] }>}
 */
async function preparer(tenantId, corps = {}, user) {
  const saisies = Array.isArray(corps.lignes) ? corps.lignes : [];
  const cls = await classeService.classe(tenantId, corps.classe_id);
  if (!cls) throw erreur(400, 'Choisissez la classe des dossiers à saisir.');
  const colonnes = await colonnesDe(db, tenantId, cls.id);
  const boites = (await physique.lister(tenantId)).filter((e) => ['boite', 'tablette'].includes(e.type));
  const parId = new Map(boites.map((b) => [b.id, b]));

  let boiteDefaut = null;
  if (!vide(corps.emplacement_id)) {
    boiteDefaut = parId.get(Number(corps.emplacement_id));
    if (!boiteDefaut) throw erreur(400, 'La boîte choisie est introuvable : un dossier se range dans une boîte, ou directement sur une tablette.');
  }
  let dossierId = null;
  if (!vide(corps.dossier_id)) {
    dossierId = Number(corps.dossier_id);
    const d = Number.isInteger(dossierId)
      ? await db.query('SELECT id FROM document_folders WHERE id = $1 AND tenant_id = $2', [dossierId, tenantId]) : { rows: [] };
    if (!d.rows[0]) throw erreur(400, 'Dossier de classement introuvable dans votre organisation.');
    if (!(await aclService.peutEcrire(tenantId, user.id, dossierId))) {
      throw erreur(403, "Vous n'avez pas le droit de classer dans ce dossier.", { code: 'ACL_DOSSIER' });
    }
  }

  // Archiver à la saisie est un geste d'archivage : il demande sa permission.
  if (corps.archiver === true && !(await roleService.possede(tenantId, user.role, 'documents.archive'))) {
    throw erreur(403, "Vous n'avez pas la permission d'archiver : décochez « Dossiers clos ».", { code: 'PERMISSION_REFUSEE' });
  }

  const erreurs = [];
  const lignes = [];
  const inconnues = new Set();
  saisies.forEach((brute, index) => {
    const l = brute && typeof brute === 'object' ? brute : {};
    const cellules = l.valeurs && typeof l.valeurs === 'object' ? l.valeurs : {};
    const remplie = colonnes.some((c) => !vide(cellules[c.id])) || !vide(l.cote) || !vide(l.dates) || !vide(l.boite);
    if (!remplie) return; // ligne laissée vide : ignorée, son rang est conservé
    const signaler = (colonne, message) => erreurs.push({ ligne: index, colonne, message });

    const valeurs = new Map();
    for (const c of colonnes) {
      const lu = lireValeur(c, cellules[c.id]);
      if (lu.erreur) signaler(`c${c.id}`, lu.erreur);
      else if (lu.valeur === null || (Array.isArray(lu.valeur) && !lu.valeur.length)) {
        // Obligatoire dans la classe comme dans les propriétés communes : la
        // grille demande ces dernières une fois pour tout le lot.
        if (c.obligatoire) signaler(`c${c.id}`, 'Obligatoire.');
      } else valeurs.set(c.id, lu.valeur);
    }

    const dates = lireDates(l.dates);
    if (dates.erreur) signaler('dates', dates.erreur);

    const cote = vide(l.cote) ? null : String(l.cote).trim();
    if (cote && cote.length > 60) signaler('cote', '60 caractères au plus.');

    let emplacement = boiteDefaut;
    if (!vide(l.emplacement_id)) {
      emplacement = parId.get(Number(l.emplacement_id)) || null;
      if (!emplacement) signaler('boite', 'Boîte introuvable.');
    } else if (!vide(l.boite)) {
      const r = trouverBoite(boites, l.boite);
      if (r.erreur) { signaler('boite', r.erreur); if (r.inconnue) inconnues.add(r.inconnue); }
      emplacement = r.boite || null;
    }

    lignes.push({
      index, valeurs, emplacement, cote,
      debut: dates.debut ?? null, fin: dates.fin ?? null,
      metadata: [...valeurs].map(([fieldId, value]) => ({ fieldId, value })),
      fiche: ficheDe(colonnes, valeurs, dates.erreur ? {} : dates),
    });
  });

  if (!lignes.length) throw erreur(400, 'Aucune ligne à enregistrer : remplissez au moins un dossier.');
  if (lignes.length > LIMITE) throw erreur(400, `${LIMITE} lignes au plus par enregistrement : enregistrez en plusieurs fois.`);

  const doublons = erreurs.length ? [] : await chercherDoublons(tenantId, cls.id, colonnes, lignes);
  return { classe: cls, colonnes, dossierId, archiver: corps.archiver === true, lignes, erreurs, doublons, boites_inconnues: [...inconnues] };
}

// --------------------------------------------------------------- création

/** Crée la fiche d'une ligne contrôlée, puis la nomme et la range. */
async function creerFiche(tenantId, user, prep, l, { ip = null } = {}) {
  const client = await db.pool.connect();
  let id; let reference;
  try {
    await client.query('BEGIN');
    const provisoire = `SAISIE-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const ins = await client.query(
      `INSERT INTO documents (tenant_id, reference_mfile, num_dossier, num_acte, nom_entreprise, annee, date_document, type_document,
                              statut, version, created_by, dossier_id, classe_id, support)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'disponible', 1, $9, $10, $11, 'papier') RETURNING id`,
      [tenantId, provisoire, l.fiche.num_dossier, l.fiche.num_acte, l.fiche.nom_entreprise, l.fiche.annee, l.fiche.date_document,
        prep.classe.name, user.id, prep.dossierId, prep.classe.id]
    );
    id = ins.rows[0].id;
    reference = await setCanonicalReference(tenantId, id, client);
    if (l.metadata.length) await metadataService.setDocumentMetadata(tenantId, id, l.metadata, client);
    await logHistory(tenantId, id, user.id, 'Saisie en tableau', null, 'disponible', null, client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  await documentAuditService.logAction({
    tenantId, documentId: id, userId: user.id, username: user.username, action: 'DOCUMENT_SAISI',
    details: { classe: prep.classe.name, proprietes: l.metadata.map((m) => m.fieldId) }, ipAddress: ip,
  });
  // Titre (charte de nommage), numéro et rangement par défaut de la classe.
  const classement = await classeService.appliquer(tenantId, id, user.id)
    .catch((e) => { console.error('[saisie] classe non appliquée :', e.message); return null; });
  // Boîte, cote dans la boîte, dates extrêmes ; « rangé par » et journal.
  const place = await physique.placer(tenantId, id, {
    support: 'papier', emplacement_id: l.emplacement ? l.emplacement.id : null,
    cote_physique: l.cote, annee_debut: l.debut, annee_fin: l.fin,
  }, user);
  // Dossiers clos : archivés dès la saisie (lecture seule) — leur durée de
  // conservation court de leur clôture, lue dans les dates extrêmes.
  if (prep.archiver) {
    await db.query("UPDATE documents SET statut = 'archivé', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2", [id, tenantId]);
    await logHistory(tenantId, id, user.id, 'Archivage à la saisie (dossier clos)', 'disponible', 'archivé', null);
  }
  return {
    ligne: l.index, id, reference, titre: (classement && classement.nom) || null,
    boite: place.cote_topographique || null, cote: place.cote_physique || null,
  };
}

/**
 * Enregistre un lot : contrôle tout, puis crée les fiches.
 * 422 LIGNES_INVALIDES (details.erreurs) — rien n'est créé ;
 * 409 DOUBLONS (details.doublons) tant que `accepter_doublons` n'est pas posé.
 * @returns {Promise<{ crees: Array, classe: object, interrompu?: { ligne: number, message: string } }>}
 */
async function creerLot(tenantId, corps = {}, user, { ip = null } = {}) {
  const prep = await preparer(tenantId, corps, user);
  if (prep.erreurs.length) {
    const n = prep.erreurs.length;
    throw erreur(422, `${n} cellule${n > 1 ? 's' : ''} à corriger : rien n'a été enregistré.`,
      { code: 'LIGNES_INVALIDES', details: { erreurs: prep.erreurs, boites_inconnues: prep.boites_inconnues } });
  }
  if (prep.doublons.length && !corps.accepter_doublons) {
    const n = prep.doublons.length;
    throw erreur(409, `${n} ligne${n > 1 ? 's ressemblent' : ' ressemble'} à un dossier déjà saisi.`,
      { code: 'DOUBLONS', details: { doublons: prep.doublons } });
  }
  const crees = [];
  let interrompu = null;
  for (const l of prep.lignes) {
    try {
      crees.push(await creerFiche(tenantId, user, prep, l, { ip }));
    } catch (err) {
      console.error(`[saisie] ligne ${l.index + 1} non enregistrée :`, err);
      interrompu = { ligne: l.index, message: `La ligne ${l.index + 1} n'a pas pu être enregistrée. Les lignes précédentes le sont ; reprenez à partir de celle-ci.` };
      break;
    }
  }
  if (crees.length) {
    // Une propriété « échéance » a pu être saisie : l'échéancier suit (035).
    await require('./echeanceService').deriver({ tenantId }).catch(() => {});
    await db.query(
      `INSERT INTO audit_logs (tenant_id, actor_id, actor_username, action, object_type, object_id, details_json, ip_address)
       VALUES ($1, $2, $3, 'SAISIE_TABLEAU', 'classe', $4, $5, $6)`,
      [tenantId, user.id, user.username || null, prep.classe.id,
        JSON.stringify({ classe: prep.classe.name, dossiers: crees.length, boites: [...new Set(crees.map((c) => c.boite).filter(Boolean))] }), ip]
    ).catch((e) => console.error('[saisie] journal :', e.message));
  }
  return { crees, classe: { id: prep.classe.id, nom: prep.classe.name }, ...(interrompu ? { interrompu } : {}) };
}

module.exports = {
  LIMITE, TYPES_SAISIS,
  trouverChoix, lireNombre, lireDate, lireBooleen, lireValeur, lireDates, ficheDe, trouverBoite,
  modele, preparer, creerLot,
};
