// ============================================================================
// rechercheService — recherche avancée, recherches enregistrées et alertes
// (migration 035 ; modèle : recherche avancée d'Alfresco, vues et
// notifications de M-Files).
//
//   CRITÈRES     normaliserCriteres : ce que le client envoie est relu, borné
//                et typé ; une valeur invalide est refusée (400), jamais
//                « interprétée ». Les critères se combinent tous (ET).
//   SQL          construireRequete : fonction PURE qui traduit des critères
//                normalisés en clause WHERE. Toute valeur passe en paramètre
//                lié ($n) ; le texte de la requête ne contient que des
//                fragments écrits ici (colonnes, opérateurs, tris en liste
//                blanche). C'est ce qui rend l'injection impossible, et ce que
//                les tests vérifient.
//   PÉRIMÈTRE    toujours borné par l'ACL de dossier de CELUI qui exécute
//                (aclService.dossiersAccessibles → lisibles), hors corbeille
//                et hors documents éliminés (colonne documents.elimine_at,
//                détectée une fois : elle vient d'une autre migration).
//   RÉSULTATS    pagination, tri (pertinence ts_rank_cd, dates, référence),
//                extraits surlignés (ts_headline, rendus en SEGMENTS : le
//                navigateur n'interprète jamais de HTML venu d'un document),
//                facettes (classe, année, statut, dossier) sur l'ensemble
//                filtré.
//   ENREGISTRÉES nom + critères, privées ou partagées (lecture seule pour
//                les autres), épinglées ; ALERTE quotidienne à l'auteur sur
//                les documents nouvellement entrés dans les résultats.
//
// Le dictionnaire plein texte est 'french', comme l'index de la 027.
// ============================================================================
const db = require('../config/db');
const aclService = require('./aclService');

const MAX_PAR_PAGE = 100;
const MAX_CHAMPS = 20;
const MAX_TAGS = 20;
const PROFONDEUR_MAX = 50; // garde-fou de la descente des sous-dossiers
const ALERTE_INTERVALLE_H = 24;
const MAX_NOUVEAUX_LISTES = 5;

const erreur400 = (message) => Object.assign(new Error(message), { status: 400 });

// ------------------------------------------------------- colonnes optionnelles

// documents.elimine_at (élimination réglementaire, migration d'un autre
// chantier) : présente ou non selon la base. Vérifié une fois, comme
// contentIndexService.colonnesTexte — une requête en échec dans une
// transaction l'annulerait tout entière.
let eliminationPromesse = null;
function colonneElimination() {
  if (!eliminationPromesse) {
    eliminationPromesse = db.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'documents' AND column_name = 'elimine_at') AS ok`
    ).then((r) => r.rows[0].ok).catch(() => { eliminationPromesse = null; return false; });
  }
  return eliminationPromesse;
}

let tablesPromesse = null;
/** La migration 035 est-elle passée ? */
function migrationPassee() {
  if (!tablesPromesse) {
    tablesPromesse = db.query("SELECT to_regclass('recherches_enregistrees') IS NOT NULL AS ok")
      .then((r) => r.rows[0].ok).catch(() => { tablesPromesse = null; return false; });
  }
  return tablesPromesse;
}

// ------------------------------------------------------------------ critères

const TRIS = ['pertinence', 'date_desc', 'date_asc', 'creation_desc', 'reference', 'entreprise'];
const INTEGRITES = ['anomalie', 'alteree', 'introuvable', 'non_verifiee', 'intacte'];
const TYPES_FICHIER = ['pdf', 'image', 'bureautique', 'texte', 'aucun'];
const OPERATEURS = ['contient', 'egal', 'entre', 'parmi', 'vrai', 'faux', 'rempli', 'vide'];

const texte = (v, max, nom) => {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string' && typeof v !== 'number') throw erreur400(`Critère « ${nom} » : texte attendu.`);
  const s = String(v).trim();
  if (s.length > max) throw erreur400(`Critère « ${nom} » : ${max} caractères au plus.`);
  return s;
};
const entier = (v, nom, { min = 1, max = 2147483647 } = {}) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw erreur400(`Critère « ${nom} » : nombre entier attendu.`);
  return n;
};
const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** Date ISO (AAAA-MM-JJ) réellement existante, ou null. */
function dateIso(v, nom) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).slice(0, 10);
  const d = new Date(`${s}T00:00:00Z`);
  if (!ISO.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw erreur400(`Critère « ${nom} » : date invalide (AAAA-MM-JJ attendu).`);
  }
  return s;
}
const nombre = (v, nom) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw erreur400(`Critère « ${nom} » : nombre attendu.`);
  return n;
};
const booleen = (v) => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : null);

/**
 * Critères bruts (corps JSON, recherche enregistrée) → critères normalisés.
 * Seules les clés connues sont retenues ; les vides disparaissent. Fonction
 * pure : lève une erreur 400 sur toute valeur invalide.
 */
function normaliserCriteres(brut = {}) {
  if (brut === null || typeof brut !== 'object' || Array.isArray(brut)) throw erreur400('Critères de recherche invalides.');
  const c = {};
  const champ = (cle, v) => { if (v !== '' && v !== null && v !== undefined && !(Array.isArray(v) && !v.length)) c[cle] = v; };

  champ('texte', texte(brut.texte, 300, 'texte'));
  champ('phrase', texte(brut.phrase, 200, 'expression exacte'));
  champ('reference', texte(brut.reference, 100, 'référence'));
  champ('entreprise', texte(brut.entreprise, 255, 'entreprise'));
  champ('num_dossier', texte(brut.num_dossier, 50, 'n° de dossier'));
  champ('num_acte', texte(brut.num_acte, 50, "n° d'acte"));
  champ('auteur', texte(brut.auteur, 100, 'auteur'));
  champ('cree_par', entier(brut.cree_par, 'créé par'));
  if (brut.classe_id === 'aucune') c.classe_id = 'aucune';
  else champ('classe_id', entier(brut.classe_id, 'classe'));
  champ('dossier_id', entier(brut.dossier_id, 'dossier'));
  if (c.dossier_id) c.sous_dossiers = brut.sous_dossiers !== false && brut.sous_dossiers !== 'false';

  if (brut.statuts !== undefined && brut.statuts !== null) {
    const liste = Array.isArray(brut.statuts) ? brut.statuts : [brut.statuts];
    if (liste.length > 10) throw erreur400('Critère « statut » : 10 valeurs au plus.');
    champ('statuts', [...new Set(liste.map((s) => texte(s, 20, 'statut')).filter(Boolean))]);
  }
  let amin = entier(brut.annee_min, 'année', { min: 1000, max: 9999 });
  let amax = entier(brut.annee_max, 'année', { min: 1000, max: 9999 });
  const annee = entier(brut.annee, 'année', { min: 1000, max: 9999 });
  if (annee) { amin = annee; amax = annee; }
  if (amin && amax && amin > amax) [amin, amax] = [amax, amin];
  champ('annee_min', amin);
  champ('annee_max', amax);

  for (const [cle, nom] of [['date_document_du', 'date du document (du)'], ['date_document_au', 'date du document (au)'],
    ['cree_du', 'versé du'], ['cree_au', 'versé au']]) {
    champ(cle, dateIso(brut[cle], nom));
  }

  if (brut.tags !== undefined && brut.tags !== null) {
    const liste = Array.isArray(brut.tags) ? brut.tags : String(brut.tags).split(',');
    if (liste.length > MAX_TAGS) throw erreur400(`Critère « étiquettes » : ${MAX_TAGS} au plus.`);
    champ('tags', [...new Set(liste.map((t) => texte(t, 100, 'étiquette')).filter(Boolean))]);
    if (c.tags) c.tags_mode = brut.tags_mode === 'un' ? 'un' : 'tous';
  }

  if (brut.champs !== undefined && brut.champs !== null) {
    if (!Array.isArray(brut.champs)) throw erreur400('Critère « propriétés » : liste attendue.');
    if (brut.champs.length > MAX_CHAMPS) throw erreur400(`${MAX_CHAMPS} propriétés au plus dans une recherche.`);
    const champs = [];
    for (const f of brut.champs) {
      if (!f || typeof f !== 'object') throw erreur400('Critère de propriété invalide.');
      const id = entier(f.id, 'propriété');
      if (!id) continue;
      const op = f.op ? String(f.op) : 'contient';
      if (!OPERATEURS.includes(op)) throw erreur400(`Opérateur inconnu : « ${op} ».`);
      const n = { id, op };
      if (op === 'contient' || op === 'egal') {
        const v = texte(f.valeur, 200, 'valeur de propriété');
        if (!v) continue; // critère vide : ignoré
        n.valeur = v;
      } else if (op === 'entre') {
        // Bornes numériques ou dates : le type du champ tranche à la construction.
        const brutMin = f.min ?? f.du;
        const brutMax = f.max ?? f.au;
        const estDate = [brutMin, brutMax].some((x) => typeof x === 'string' && ISO.test(x.slice(0, 10)) && x.length >= 10);
        n.min = estDate ? dateIso(brutMin, 'propriété (du)') : nombre(brutMin, 'propriété (min)');
        n.max = estDate ? dateIso(brutMax, 'propriété (au)') : nombre(brutMax, 'propriété (max)');
        if (n.min === null && n.max === null) continue;
        n.bornes = estDate ? 'date' : 'nombre';
      } else if (op === 'parmi') {
        const liste = (Array.isArray(f.valeurs) ? f.valeurs : [f.valeur]).map((x) => texte(x, 200, 'valeur de propriété')).filter(Boolean);
        if (!liste.length) continue;
        if (liste.length > 50) throw erreur400('50 valeurs au plus par propriété.');
        n.valeurs = [...new Set(liste)];
      }
      champs.push(n);
    }
    champ('champs', champs);
  }

  const gel = booleen(brut.gel);
  if (gel !== null) c.gel = gel;
  if (brut.integrite) {
    if (!INTEGRITES.includes(brut.integrite)) throw erreur400(`Critère « intégrité » inconnu : ${brut.integrite}.`);
    c.integrite = brut.integrite;
  }
  if (brut.type_fichier) {
    if (!TYPES_FICHIER.includes(brut.type_fichier)) throw erreur400(`Type de fichier inconnu : ${brut.type_fichier}.`);
    c.type_fichier = brut.type_fichier;
  }
  if (brut.tri && TRIS.includes(brut.tri)) c.tri = brut.tri;
  return c;
}

/** Les critères ne retiennent-ils rien (recherche « tout ») ? */
const criteresVides = (c) => Object.keys(c).filter((k) => !['tri', 'sous_dossiers', 'tags_mode'].includes(k)).length === 0;

// ----------------------------------------------------------------- SQL (pur)

// Repli des accents pour les comparaisons « contient » : « BATIR » trouve
// « BÂTIR PLUS SA ». Deux chaînes de même longueur, écrites ici (aucune
// donnée cliente) ; lower() traite d'abord les majuscules accentuées.
const ACCENTS = 'àáâãäåçèéêëìíîïñòóôõöùúûüýÿœæ';
const SANS = 'aaaaaaceeeeiiiinooooouuuuyyoa';
const sansAccents = (expr) => `translate(lower(${expr}), '${ACCENTS}', '${SANS}')`;
/** Motif LIKE « contient », jokers du client neutralisés. */
const motifContient = (s) => `%${String(s).replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
const replier = (s) => {
  let r = String(s).toLowerCase();
  for (let i = 0; i < ACCENTS.length; i += 1) r = r.split(ACCENTS[i]).join(SANS[i]);
  return r;
};

const VALEUR = "(mv.value_json #>> '{}')";
const NON_VIDE = "NOT (mv.value_json IS NULL OR mv.value_json = 'null'::jsonb OR mv.value_json = '\"\"'::jsonb OR mv.value_json = '[]'::jsonb)";
const MIMES_BUREAUTIQUE = "(f.mime_type LIKE 'application/vnd.openxmlformats%' OR f.mime_type LIKE 'application/vnd.oasis.opendocument%' OR f.mime_type IN ('application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint', 'application/rtf'))";

/**
 * Critères normalisés → requête. Fonction PURE.
 * @param {object} c critères (normaliserCriteres)
 * @param {object} ctx
 * @param {number} ctx.tenantId
 * @param {number[]} ctx.lisibles dossiers lisibles de l'exécutant
 * @param {Map<number,{type:string}>} [ctx.champs] définitions des propriétés citées
 * @param {boolean} [ctx.elimination] la colonne documents.elimine_at existe
 * @param {boolean} [ctx.archivage] la migration 031 est passée (gel, intégrité)
 * @returns {{ where: string, params: any[], rang: string, tsq: string|null, tri: string, plein_texte: boolean }}
 */
function construireRequete(c, { tenantId, lisibles = [], champs = new Map(), elimination = false, archivage = true } = {}) {
  const params = [tenantId];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const conds = ['d.tenant_id = $1', 'd.deleted_at IS NULL'];
  if (elimination) conds.push('d.elimine_at IS NULL');
  conds.push(`(d.dossier_id IS NULL OR d.dossier_id = ANY(${p(lisibles.map(Number))}::int[]))`);

  const requetes = [];
  if (c.texte) {
    const q = `websearch_to_tsquery('french', ${p(c.texte)})`;
    requetes.push(q);
    // L'index (027) couvre la fiche et le contenu ; la référence et les
    // propriétés texte « cherchables » de la classe s'y ajoutent.
    conds.push(`(d.search_vector @@ ${q}
      OR d.reference_mfile ILIKE ${p(motifContient(c.texte))}
      OR EXISTS (SELECT 1 FROM metadata_values mv JOIN metadata_fields mf ON mf.id = mv.field_id
                  WHERE mv.document_id = d.id AND mf.type = 'text' AND mf.searchable IS NOT FALSE
                    AND to_tsvector('french', ${VALEUR}) @@ ${q}))`);
  }
  if (c.phrase) {
    const q = `phraseto_tsquery('french', ${p(c.phrase)})`;
    requetes.push(q);
    // Une expression faite de mots vides (« de la ») ne donne aucun lexème :
    // repli sur la chaîne exacte dans la description et le contenu.
    conds.push(`(CASE WHEN numnode(${q}) > 0 THEN d.search_vector @@ ${q}
      ELSE (coalesce(d.description, '') || ' ' || coalesce(d.contenu_texte, '')) ILIKE ${p(motifContient(c.phrase))} END)`);
  }
  const contient = (colonne, valeur) => conds.push(`${sansAccents(colonne)} LIKE ${p(motifContient(replier(valeur)))}`);
  if (c.reference) conds.push(`d.reference_mfile ILIKE ${p(motifContient(c.reference))}`);
  if (c.entreprise) contient('d.nom_entreprise', c.entreprise);
  if (c.num_dossier) contient('d.num_dossier', c.num_dossier);
  if (c.num_acte) contient('d.num_acte', c.num_acte);
  if (c.auteur) contient("coalesce(d.auteur, '')", c.auteur);
  if (c.cree_par) conds.push(`d.created_by = ${p(c.cree_par)}`);
  if (c.classe_id === 'aucune') conds.push('d.classe_id IS NULL');
  else if (c.classe_id) conds.push(`d.classe_id = ${p(c.classe_id)}`);
  if (c.dossier_id) {
    const dossier = p(c.dossier_id);
    if (c.sous_dossiers === false) conds.push(`d.dossier_id = ${dossier}`);
    else {
      // Un dossier INCLUT ses sous-dossiers (comme la liste des documents) ;
      // descente bornée et protégée des cycles hérités.
      conds.push(`d.dossier_id IN (
        WITH RECURSIVE sous AS (
          SELECT id, 0 AS profondeur, ARRAY[id] AS vus FROM document_folders WHERE id = ${dossier} AND tenant_id = $1
          UNION ALL
          SELECT e.id, s.profondeur + 1, s.vus || e.id FROM document_folders e JOIN sous s ON e.parent_id = s.id
           WHERE e.tenant_id = $1 AND s.profondeur < ${PROFONDEUR_MAX} AND NOT (e.id = ANY(s.vus))
        ) SELECT id FROM sous)`);
    }
  }
  if (c.statuts) conds.push(`d.statut = ANY(${p(c.statuts)}::text[])`);
  if (c.annee_min) conds.push(`d.annee >= ${p(c.annee_min)}`);
  if (c.annee_max) conds.push(`d.annee <= ${p(c.annee_max)}`);
  if (c.date_document_du) conds.push(`d.date_document >= ${p(c.date_document_du)}::date`);
  if (c.date_document_au) conds.push(`d.date_document <= ${p(c.date_document_au)}::date`);
  if (c.cree_du) conds.push(`d.created_at >= ${p(c.cree_du)}::date`);
  if (c.cree_au) conds.push(`d.created_at < ${p(c.cree_au)}::date + 1`);
  if (c.tags) conds.push(c.tags_mode === 'un' ? `d.tags && ${p(c.tags)}::text[]` : `d.tags @> ${p(c.tags)}::text[]`);

  for (const f of c.champs || []) {
    const def = champs.get(f.id);
    if (!def) throw erreur400(`Propriété inconnue : ${f.id}.`);
    const t = def.type;
    const existe = (cond) => `EXISTS (SELECT 1 FROM metadata_values mv WHERE mv.document_id = d.id AND mv.field_id = ${p(f.id)} AND ${cond})`;
    const refus = () => erreur400(`Opérateur « ${f.op} » sans objet pour la propriété « ${def.label || f.id} » (${t}).`);
    if (f.op === 'rempli') { conds.push(existe(NON_VIDE)); continue; }
    if (f.op === 'vide') { conds.push(`NOT ${existe(NON_VIDE)}`); continue; }
    if (t === 'text') {
      if (f.op === 'contient') conds.push(existe(`${sansAccents(VALEUR)} LIKE ${p(motifContient(replier(f.valeur)))}`));
      else if (f.op === 'egal') conds.push(existe(`lower(${VALEUR}) = lower(${p(f.valeur)})`));
      else throw refus();
    } else if (t === 'number') {
      // CASE : l'ordre d'évaluation est garanti — une valeur texte héritée ne
      // fait jamais échouer la conversion.
      const num = "(CASE WHEN jsonb_typeof(mv.value_json) = 'number' THEN (mv.value_json)::numeric END)";
      if (f.op === 'egal') {
        const v = Number(f.valeur);
        if (!Number.isFinite(v)) throw erreur400(`Propriété « ${def.label || f.id} » : nombre attendu.`);
        conds.push(existe(`${num} = ${p(v)}::numeric`));
      } else if (f.op === 'entre' && f.bornes === 'nombre') {
        const bornes = [];
        if (f.min !== null) bornes.push(`${num} >= ${p(f.min)}::numeric`);
        if (f.max !== null) bornes.push(`${num} <= ${p(f.max)}::numeric`);
        conds.push(existe(bornes.join(' AND ')));
      } else throw refus();
    } else if (t === 'date') {
      // Dates stockées en texte ISO : la comparaison de chaînes AAAA-MM-JJ
      // suit l'ordre chronologique, sans conversion qui pourrait échouer.
      const jour = `(CASE WHEN ${VALEUR} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN left(${VALEUR}, 10) END)`;
      if (f.op === 'entre' && f.bornes === 'date') {
        const bornes = [];
        if (f.min !== null) bornes.push(`${jour} >= ${p(f.min)}`);
        if (f.max !== null) bornes.push(`${jour} <= ${p(f.max)}`);
        conds.push(existe(bornes.join(' AND ')));
      } else if (f.op === 'egal') conds.push(existe(`${jour} = ${p(dateIso(f.valeur, def.label || 'date'))}`));
      else throw refus();
    } else if (t === 'select') {
      if (f.op === 'egal') conds.push(existe(`${VALEUR} = ${p(f.valeur)}`));
      else if (f.op === 'parmi') conds.push(existe(`${VALEUR} = ANY(${p(f.valeurs)}::text[])`));
      else throw refus();
    } else if (t === 'multiselect') {
      if (f.op === 'parmi' || f.op === 'egal') conds.push(existe(`mv.value_json ?| ${p(f.valeurs || [f.valeur])}::text[]`));
      else throw refus();
    } else if (t === 'boolean') {
      if (f.op === 'vrai') conds.push(existe("mv.value_json = 'true'::jsonb"));
      else if (f.op === 'faux') conds.push(existe("mv.value_json = 'false'::jsonb"));
      else throw refus();
    } else if (t === 'user' || t === 'document') {
      const v = Number(f.valeur);
      if (f.op !== 'egal' || !Number.isInteger(v)) throw refus();
      conds.push(existe(`mv.value_json = to_jsonb(${p(v)}::int)`));
    } else {
      throw refus();
    }
  }

  if (archivage) {
    if (c.gel === true) conds.push('EXISTS (SELECT 1 FROM document_gels g WHERE g.document_id = d.id AND g.leve_at IS NULL)');
    if (c.gel === false) conds.push('NOT EXISTS (SELECT 1 FROM document_gels g WHERE g.document_id = d.id AND g.leve_at IS NULL)');
    if (c.integrite === 'anomalie') conds.push("EXISTS (SELECT 1 FROM document_files f WHERE f.document_id = d.id AND f.integrite_statut IN ('alteree', 'introuvable'))");
    if (c.integrite === 'alteree' || c.integrite === 'introuvable') conds.push(`EXISTS (SELECT 1 FROM document_files f WHERE f.document_id = d.id AND f.integrite_statut = '${c.integrite}')`);
    if (c.integrite === 'non_verifiee') conds.push('EXISTS (SELECT 1 FROM document_files f WHERE f.document_id = d.id AND f.integrite_statut IS NULL)');
    if (c.integrite === 'intacte') {
      conds.push("EXISTS (SELECT 1 FROM document_files f WHERE f.document_id = d.id) AND NOT EXISTS (SELECT 1 FROM document_files f WHERE f.document_id = d.id AND f.integrite_statut IS DISTINCT FROM 'intacte')");
    }
  } else if (c.gel !== undefined || c.integrite) {
    throw erreur400("Les critères d'archivage (gel, intégrité) exigent la migration 031.");
  }
  if (c.type_fichier) {
    const filtre = {
      pdf: "f.mime_type = 'application/pdf'",
      image: "f.mime_type LIKE 'image/%'",
      bureautique: MIMES_BUREAUTIQUE,
      texte: "f.mime_type LIKE 'text/%'",
    }[c.type_fichier];
    conds.push(c.type_fichier === 'aucun'
      ? 'NOT EXISTS (SELECT 1 FROM document_files f WHERE f.document_id = d.id)'
      : `EXISTS (SELECT 1 FROM document_files f WHERE f.document_id = d.id AND ${filtre})`);
  }

  const tsq = requetes.length ? requetes.join(' && ') : null;
  const rang = tsq ? `ts_rank_cd(d.search_vector, ${tsq})` : '0';
  const ORDRES = {
    pertinence: tsq ? 'rang DESC, d.created_at DESC, d.id DESC' : 'd.created_at DESC, d.id DESC',
    date_desc: 'd.date_document DESC NULLS LAST, d.created_at DESC, d.id DESC',
    date_asc: 'd.date_document ASC NULLS LAST, d.created_at ASC, d.id ASC',
    creation_desc: 'd.created_at DESC, d.id DESC',
    reference: 'd.reference_mfile ASC, d.id ASC',
    entreprise: 'd.nom_entreprise ASC, d.id ASC',
  };
  return {
    where: conds.join('\n  AND '),
    params,
    rang,
    tsq,
    tri: ORDRES[c.tri] || ORDRES.pertinence,
    plein_texte: Boolean(tsq),
  };
}

// --------------------------------------------------------------- surlignage

const DEBUT = '\u0001';
const FIN = '\u0002';

/**
 * Extrait ts_headline (marqueurs \x01 … \x02) → segments
 * [{ t: 'texte', s: false }, { t: 'mot', s: true }]. Fonction pure. Le client
 * les rend comme du TEXTE : aucun HTML venu d'un document n'est jamais
 * interprété, et rien n'est à échapper.
 */
function segmentsSurlignes(extrait, max = 600) {
  const segments = [];
  let tampon = '';
  let surligne = false;
  let longueur = 0;
  const pousser = () => {
    if (tampon) segments.push({ t: tampon, s: surligne });
    tampon = '';
  };
  for (const car of String(extrait || '')) {
    if (car === DEBUT) { pousser(); surligne = true; continue; }
    if (car === FIN) { pousser(); surligne = false; continue; }
    if (longueur >= max) break;
    tampon += car;
    longueur += 1;
  }
  pousser();
  // Espaces multiples (balises retirées par ts_headline) resserrés.
  return segments.map((s) => ({ ...s, t: s.t.replace(/\s+/g, ' ') })).filter((s) => s.t);
}

// ---------------------------------------------------------------- exécution

/** Définitions des propriétés citées, de CETTE organisation seulement. */
async function chargerChamps(tenantId, c) {
  const ids = [...new Set((c.champs || []).map((f) => f.id))];
  if (!ids.length) return new Map();
  const { rows } = await db.query(
    `SELECT f.id, f.label, f.type, f.options_json FROM metadata_fields f
       JOIN metadata_schemas s ON s.id = f.schema_id
      WHERE f.id = ANY($1::int[]) AND s.tenant_id = $2`,
    [ids, tenantId]
  );
  if (rows.length !== ids.length) throw erreur400('Une propriété citée est inconnue de votre organisation.');
  return new Map(rows.map((r) => [r.id, r]));
}

/** Contexte d'exécution : périmètre ACL de l'utilisateur, colonnes présentes. */
async function contexte(tenantId, userId, c) {
  const [{ lisibles }, elimination, archivage, champs] = await Promise.all([
    aclService.dossiersAccessibles(tenantId, userId),
    colonneElimination(),
    require('./integriteService').migrationPassee(),
    chargerChamps(tenantId, c),
  ]);
  return { tenantId, lisibles: [...lisibles], elimination, archivage, champs };
}

/**
 * Recherche avancée.
 * @returns {Promise<{ resultats, total, page, par_page, pages, facettes, criteres }>}
 */
async function rechercher(tenantId, user, brut = {}, { page = 1, parPage = 20, tri } = {}) {
  const c = normaliserCriteres(brut);
  if (tri && TRIS.includes(tri)) c.tri = tri;
  const ctx = await contexte(tenantId, user.id, c);
  const r = construireRequete(c, ctx);
  const limite = Math.min(Math.max(Number(parPage) || 20, 1), MAX_PAR_PAGE);
  const numero = Math.max(Number(page) || 1, 1);

  // Facettes et total : un seul passage sur l'ensemble filtré.
  const fac = await db.query(
    `WITH f AS MATERIALIZED (SELECT d.classe_id, d.annee, d.statut, d.dossier_id FROM documents d WHERE ${r.where})
     SELECT GROUPING(classe_id) AS gc, GROUPING(annee) AS ga, GROUPING(statut) AS gs, GROUPING(dossier_id) AS gd,
            classe_id, annee, statut, dossier_id, count(*)::int AS n
       FROM f GROUP BY GROUPING SETS ((classe_id), (annee), (statut), (dossier_id), ())`,
    r.params
  );
  let total = 0;
  const brutes = { classe: [], annee: [], statut: [], dossier: [] };
  for (const l of fac.rows) {
    if (l.gc && l.ga && l.gs && l.gd) total = l.n;
    else if (!l.gc) brutes.classe.push({ valeur: l.classe_id, n: l.n });
    else if (!l.ga) brutes.annee.push({ valeur: l.annee, n: l.n });
    else if (!l.gs) brutes.statut.push({ valeur: l.statut, n: l.n });
    else if (!l.gd) brutes.dossier.push({ valeur: l.dossier_id, n: l.n });
  }

  const liste = await db.query(
    `SELECT d.id, d.reference_mfile, d.nom_entreprise, d.num_dossier, d.num_acte, d.annee, d.statut,
            d.type_document, left(d.description, 300) AS description, d.date_document, d.created_at, d.tags, d.auteur,
            d.classe_id, c.name AS classe_nom, d.dossier_id, fo.name AS dossier_nom,
            (SELECT count(*)::int FROM document_files df WHERE df.document_id = d.id) AS nb_fichiers,
            ${r.rang} AS rang
       FROM documents d
       LEFT JOIN metadata_schemas c ON c.id = d.classe_id AND c.tenant_id = d.tenant_id
       LEFT JOIN document_folders fo ON fo.id = d.dossier_id AND fo.tenant_id = d.tenant_id
      WHERE ${r.where}
      ORDER BY ${r.tri}
      LIMIT ${limite} OFFSET ${(numero - 1) * limite}`,
    r.params
  );
  const ids = liste.rows.map((x) => x.id);

  // Archivage (gel, anomalie) et extraits : pour la page seulement.
  const etats = new Map();
  if (ids.length && ctx.archivage) {
    const { rows } = await db.query(
      `SELECT d.id,
              EXISTS (SELECT 1 FROM document_gels g WHERE g.document_id = d.id AND g.leve_at IS NULL) AS gele,
              EXISTS (SELECT 1 FROM document_files f WHERE f.document_id = d.id AND f.integrite_statut IN ('alteree', 'introuvable')) AS anomalie
         FROM documents d WHERE d.id = ANY($1::int[]) AND d.tenant_id = $2`,
      [ids, tenantId]
    );
    for (const e of rows) etats.set(e.id, e);
  }
  const extraits = new Map();
  if (ids.length && r.tsq) {
    // Même requête plein texte, rejouée sur la page : ts_headline est coûteux,
    // il n'est jamais calculé sur l'ensemble des résultats.
    const params = [tenantId, ids];
    const q = [];
    if (c.texte) { params.push(c.texte); q.push(`websearch_to_tsquery('french', $${params.length})`); }
    if (c.phrase) { params.push(c.phrase); q.push(`phraseto_tsquery('french', $${params.length})`); }
    const { rows } = await db.query(
      `SELECT d.id, ts_headline('french',
                left(translate(coalesce(d.description, '') || E'\\n' || coalesce(d.contenu_texte, ''), E'\\x01\\x02', '  '), 60000),
                ${q.join(' && ')},
                'StartSel=' || chr(1) || ', StopSel=' || chr(2) || ', MaxFragments=2, MaxWords=22, MinWords=8, FragmentDelimiter=" … "') AS extrait
         FROM documents d WHERE d.id = ANY($2::int[]) AND d.tenant_id = $1`,
      params
    );
    for (const e of rows) {
      const segments = segmentsSurlignes(e.extrait);
      if (segments.some((s) => s.s)) extraits.set(e.id, segments);
    }
  }

  const facettes = await libellerFacettes(tenantId, brutes);
  return {
    resultats: liste.rows.map((d) => ({
      ...d,
      rang: Number(d.rang) || 0,
      gele: Boolean(etats.get(d.id)?.gele),
      anomalie: Boolean(etats.get(d.id)?.anomalie),
      extrait: extraits.get(d.id) || null,
    })),
    total,
    page: numero,
    par_page: limite,
    pages: Math.ceil(total / limite),
    facettes,
    criteres: c,
  };
}

async function libellerFacettes(tenantId, brutes) {
  const classes = brutes.classe.map((x) => x.valeur).filter(Boolean);
  const dossiers = brutes.dossier.map((x) => x.valeur).filter(Boolean);
  const [cl, fo] = await Promise.all([
    classes.length ? db.query('SELECT id, name FROM metadata_schemas WHERE tenant_id = $1 AND id = ANY($2::int[])', [tenantId, classes]) : { rows: [] },
    dossiers.length ? db.query('SELECT id, name FROM document_folders WHERE tenant_id = $1 AND id = ANY($2::int[])', [tenantId, dossiers]) : { rows: [] },
  ]);
  const nomClasse = new Map(cl.rows.map((r) => [r.id, r.name]));
  const nomDossier = new Map(fo.rows.map((r) => [r.id, r.name]));
  const parN = (a, b) => b.n - a.n;
  return {
    classe: brutes.classe.map((x) => ({ ...x, valeur: x.valeur ?? 'aucune', libelle: x.valeur ? (nomClasse.get(x.valeur) || `Classe ${x.valeur}`) : 'Sans classe' })).sort(parN),
    annee: brutes.annee.filter((x) => x.valeur !== null).map((x) => ({ ...x, libelle: String(x.valeur) })).sort((a, b) => b.valeur - a.valeur),
    statut: brutes.statut.filter((x) => x.valeur !== null).map((x) => ({ ...x, libelle: x.valeur })).sort(parN),
    dossier: brutes.dossier.map((x) => ({ ...x, valeur: x.valeur ?? 'aucun', libelle: x.valeur ? (nomDossier.get(x.valeur) || `Dossier ${x.valeur}`) : 'Non classé' })).sort(parN).slice(0, 15),
  };
}

/**
 * Référentiel du formulaire : classes et leurs propriétés, dossiers visibles
 * (avec leur chemin), statuts, années, auteurs. Borné au périmètre : un
 * dossier restreint invisible n'apparaît pas.
 */
async function referentiel(tenantId, user) {
  const { visibles } = await aclService.dossiersAccessibles(tenantId, user.id);
  const [classes, champs, dossiers, annees, auteurs, statuts] = await Promise.all([
    db.query('SELECT id, name, code, is_default FROM metadata_schemas WHERE tenant_id = $1 ORDER BY is_default DESC, name', [tenantId]),
    db.query(
      `SELECT f.id, f.schema_id, f.label, f.type, f.options_json, f.est_echeance
         FROM metadata_fields f JOIN metadata_schemas s ON s.id = f.schema_id
        WHERE s.tenant_id = $1 ORDER BY f.schema_id, f.display_order, f.id`, [tenantId]
    ).catch(() => db.query(
      `SELECT f.id, f.schema_id, f.label, f.type, f.options_json, false AS est_echeance
         FROM metadata_fields f JOIN metadata_schemas s ON s.id = f.schema_id
        WHERE s.tenant_id = $1 ORDER BY f.schema_id, f.display_order, f.id`, [tenantId])),
    db.query(
      `WITH RECURSIVE arbre AS (
         SELECT id, parent_id, name::text AS chemin, 0 AS profondeur, ARRAY[id] AS vus
           FROM document_folders WHERE tenant_id = $1 AND (parent_id IS NULL OR parent_id NOT IN (SELECT id FROM document_folders WHERE tenant_id = $1))
         UNION ALL
         SELECT e.id, e.parent_id, a.chemin || ' / ' || e.name, a.profondeur + 1, a.vus || e.id
           FROM document_folders e JOIN arbre a ON e.parent_id = a.id
          WHERE e.tenant_id = $1 AND a.profondeur < ${PROFONDEUR_MAX} AND NOT (e.id = ANY(a.vus))
       ) SELECT id, parent_id, chemin, profondeur FROM arbre ORDER BY chemin`, [tenantId]),
    db.query('SELECT DISTINCT annee FROM documents WHERE tenant_id = $1 AND deleted_at IS NULL AND annee IS NOT NULL ORDER BY annee DESC', [tenantId]),
    db.query(
      `SELECT u.id, u.full_name FROM users u
        WHERE u.tenant_id = $1 AND EXISTS (SELECT 1 FROM documents d WHERE d.tenant_id = $1 AND d.created_by = u.id)
        ORDER BY u.full_name`, [tenantId]),
    db.query('SELECT DISTINCT statut FROM documents WHERE tenant_id = $1 AND deleted_at IS NULL AND statut IS NOT NULL ORDER BY statut', [tenantId]),
  ]);
  const parClasse = new Map();
  for (const f of champs.rows) {
    if (!parClasse.has(f.schema_id)) parClasse.set(f.schema_id, []);
    parClasse.get(f.schema_id).push({
      id: f.id, label: f.label, type: f.type, est_echeance: f.est_echeance,
      options: (Array.isArray(f.options_json) ? f.options_json : []).map((o) => (typeof o === 'string' ? { value: o, label: o } : { value: o.value, label: o.label || o.value })),
    });
  }
  const STATUTS_CONNUS = ['à indexer', 'disponible', 'en validation', 'prêt', 'archivé'];
  return {
    classes: classes.rows.map((c) => ({ ...c, champs: parClasse.get(c.id) || [] })),
    dossiers: dossiers.rows.filter((d) => visibles.has(d.id)),
    annees: annees.rows.map((r) => r.annee),
    auteurs: auteurs.rows,
    statuts: [...new Set([...STATUTS_CONNUS, ...statuts.rows.map((r) => r.statut)])],
    tris: TRIS,
    integrites: INTEGRITES,
    types_fichier: TYPES_FICHIER,
  };
}

// ---------------------------------------------------- recherches enregistrées

const versRecherche = (r, userId) => ({
  id: r.id,
  nom: r.nom,
  description: r.description,
  criteres: r.criteres || {},
  partagee: r.partagee,
  proprietaire: r.user_id === userId,
  auteur: r.auteur_nom || null,
  // L'épingle et l'alerte sont celles de l'auteur : elles ne concernent pas
  // les autres lecteurs d'une recherche partagée.
  epinglee: r.user_id === userId ? r.epinglee : false,
  alerte: r.user_id === userId ? r.alerte : false,
  alerte_verifiee_at: r.user_id === userId ? r.alerte_verifiee_at : null,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

/** Les miennes, puis celles que l'organisation partage (lecture seule). */
async function listerRecherches(tenantId, user, { epinglees = false } = {}) {
  const { rows } = await db.query(
    `SELECT r.*, u.full_name AS auteur_nom FROM recherches_enregistrees r
       LEFT JOIN users u ON u.id = r.user_id
      WHERE r.tenant_id = $1 AND (r.user_id = $2 OR (r.partagee AND NOT $3::boolean))
        AND (NOT $3::boolean OR r.epinglee)
      ORDER BY (r.user_id = $2) DESC, r.epinglee DESC, lower(r.nom)`,
    [tenantId, user.id, epinglees]
  );
  return rows.map((r) => versRecherche(r, user.id));
}

async function chargerRecherche(tenantId, user, id, { ecriture = false } = {}) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw erreur400('Identifiant de recherche invalide.');
  const { rows } = await db.query(
    `SELECT r.*, u.full_name AS auteur_nom FROM recherches_enregistrees r LEFT JOIN users u ON u.id = r.user_id
      WHERE r.id = $1 AND r.tenant_id = $2 AND (r.user_id = $3 OR r.partagee)`,
    [n, tenantId, user.id]
  );
  const r = rows[0];
  if (!r) throw Object.assign(new Error('Recherche introuvable.'), { status: 404 });
  if (ecriture && r.user_id !== user.id) {
    throw Object.assign(new Error("Cette recherche est partagée par un collègue : vous pouvez l'exécuter ou l'enregistrer sous un autre nom, pas la modifier."), { status: 403, code: 'RECHERCHE_EN_LECTURE' });
  }
  return r;
}

function lireEnTete(corps, { partiel = false } = {}) {
  const e = {};
  if (!partiel || corps.nom !== undefined) {
    const nom = texte(corps.nom, 120, 'nom');
    if (!nom) throw erreur400('Donnez un nom à la recherche.');
    e.nom = nom;
  }
  if (corps.description !== undefined) e.description = texte(corps.description, 1000, 'description') || null;
  if (!partiel || corps.criteres !== undefined) {
    const c = normaliserCriteres(corps.criteres || {});
    if (criteresVides(c)) throw erreur400('La recherche ne retient aucun critère : rien à enregistrer.');
    e.criteres = c;
  }
  for (const k of ['partagee', 'epinglee', 'alerte']) {
    if (corps[k] !== undefined) e[k] = booleen(corps[k]) === true;
  }
  return e;
}

async function creerRecherche(tenantId, user, corps = {}) {
  const e = lireEnTete(corps);
  await chargerChamps(tenantId, e.criteres); // propriétés de l'organisation
  let r;
  try {
    const { rows } = await db.query(
      `INSERT INTO recherches_enregistrees (tenant_id, user_id, nom, description, criteres, partagee, epinglee, alerte)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [tenantId, user.id, e.nom, e.description || null, JSON.stringify(e.criteres), Boolean(e.partagee), Boolean(e.epinglee), Boolean(e.alerte)]
    );
    r = rows[0];
  } catch (err) {
    if (err.code === '23505') throw Object.assign(new Error('Vous avez déjà une recherche de ce nom.'), { status: 409 });
    throw err;
  }
  if (r.alerte) await initialiserAlerte(tenantId, r);
  return versRecherche(r, user.id);
}

async function modifierRecherche(tenantId, user, id, corps = {}) {
  const avant = await chargerRecherche(tenantId, user, id, { ecriture: true });
  const e = lireEnTete(corps, { partiel: true });
  if (e.criteres) await chargerChamps(tenantId, e.criteres);
  const cles = Object.keys(e);
  if (!cles.length) return versRecherche(avant, user.id);
  const valeurs = cles.map((k) => (k === 'criteres' ? JSON.stringify(e[k]) : e[k]));
  let r;
  try {
    const { rows } = await db.query(
      `UPDATE recherches_enregistrees SET ${cles.map((k, i) => `${k} = $${i + 3}`).join(', ')}, updated_at = now()
        WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [avant.id, tenantId, ...valeurs]
    );
    r = rows[0];
  } catch (err) {
    if (err.code === '23505') throw Object.assign(new Error('Vous avez déjà une recherche de ce nom.'), { status: 409 });
    throw err;
  }
  // Alerte activée, ou critères changés sous alerte : le point de départ est
  // refait — l'existant n'est pas « nouveau ».
  const criteresChanges = e.criteres && JSON.stringify(e.criteres) !== JSON.stringify(avant.criteres);
  if (r.alerte && (!avant.alerte || criteresChanges)) await initialiserAlerte(tenantId, r);
  if (!r.alerte && avant.alerte) await db.query('DELETE FROM recherche_alertes_vus WHERE recherche_id = $1', [r.id]);
  return versRecherche(r, user.id);
}

async function supprimerRecherche(tenantId, user, id) {
  const r = await chargerRecherche(tenantId, user, id, { ecriture: true });
  await db.query('DELETE FROM recherches_enregistrees WHERE id = $1 AND tenant_id = $2', [r.id, tenantId]);
}

// ------------------------------------------------------------------- alertes

/**
 * Documents correspondant à une recherche pour son AUTEUR (son périmètre
 * ACL du moment), absents de l'ensemble déjà connu de l'alerte.
 */
async function nouveauxPourAlerte(tenantId, recherche, { limite = 5000 } = {}) {
  const c = normaliserCriteres(recherche.criteres || {});
  const ctx = await contexte(tenantId, recherche.user_id, c);
  const r = construireRequete(c, ctx);
  const { rows } = await db.query(
    `SELECT d.id, d.reference_mfile, d.nom_entreprise FROM documents d
      WHERE ${r.where}
        AND NOT EXISTS (SELECT 1 FROM recherche_alertes_vus v WHERE v.recherche_id = ${r.params.length + 1} AND v.document_id = d.id)
      ORDER BY d.id LIMIT ${Number(limite)}`.replace(`= ${r.params.length + 1} AND`, `= $${r.params.length + 1} AND`),
    [...r.params, recherche.id]
  );
  return rows;
}

async function marquerVus(rechercheId, ids) {
  if (!ids.length) return;
  await db.query(
    `INSERT INTO recherche_alertes_vus (recherche_id, document_id)
     SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING`,
    [rechercheId, ids]
  );
}

/**
 * Point de départ d'une alerte : ce qui correspond déjà est « connu », sans
 * notification. Seuls les documents qui entreront ensuite seront signalés.
 */
async function initialiserAlerte(tenantId, recherche) {
  await db.query('DELETE FROM recherche_alertes_vus WHERE recherche_id = $1', [recherche.id]);
  const existants = await nouveauxPourAlerte(tenantId, recherche, { limite: 50000 });
  await marquerVus(recherche.id, existants.map((d) => d.id));
  await db.query('UPDATE recherches_enregistrees SET alerte_verifiee_at = now() WHERE id = $1', [recherche.id]);
  return existants.length;
}

/**
 * Passage des alertes : chaque recherche sous alerte est rejouée au plus une
 * fois par période (24 h, sauf `forcer`), avec le périmètre de son auteur au
 * moment du passage. Les documents nouvellement correspondants lui sont
 * notifiés en UNE notification, puis retenus comme connus.
 * @param {{ tenantId?: number, forcer?: boolean, lot?: number }} [opts]
 * @returns {Promise<{ verifiees: number, notifiees: number, documents: number }>}
 */
async function verifierAlertes({ tenantId = null, forcer = false, lot = 50 } = {}) {
  const bilan = { verifiees: 0, notifiees: 0, documents: 0 };
  if (!(await migrationPassee())) return bilan;
  const { rows } = await db.query(
    `SELECT r.*, u.role, u.tenant_id AS user_tenant FROM recherches_enregistrees r JOIN users u ON u.id = r.user_id
      WHERE r.alerte AND ($1::int IS NULL OR r.tenant_id = $1)
        AND ($2::boolean OR r.alerte_verifiee_at IS NULL OR r.alerte_verifiee_at < now() - make_interval(hours => ${ALERTE_INTERVALLE_H}))
      ORDER BY r.alerte_verifiee_at NULLS FIRST LIMIT $3`,
    [tenantId, forcer, lot]
  );
  const roleService = require('./roleService');
  for (const r of rows) {
    try {
      await db.query('UPDATE recherches_enregistrees SET alerte_verifiee_at = now() WHERE id = $1', [r.id]);
      bilan.verifiees += 1;
      // L'auteur doit encore pouvoir lire la GED : sinon rien ne lui est dit.
      if (r.user_tenant !== r.tenant_id || !(await roleService.possede(r.tenant_id, r.role, 'documents.view'))) continue;
      const nouveaux = await nouveauxPourAlerte(r.tenant_id, r);
      if (!nouveaux.length) continue;
      await marquerVus(r.id, nouveaux.map((d) => d.id));
      const n = nouveaux.length;
      const cites = nouveaux.slice(0, MAX_NOUVEAUX_LISTES).map((d) => `${d.reference_mfile} — ${d.nom_entreprise}`);
      const titre = `Recherche « ${r.nom} » : ${n} nouveau${n > 1 ? 'x' : ''} document${n > 1 ? 's' : ''}`.slice(0, 255);
      const message = `${cites.join(' ; ')}${n > MAX_NOUVEAUX_LISTES ? ` … et ${n - MAX_NOUVEAUX_LISTES} autre(s).` : '.'}`;
      await db.query(
        `INSERT INTO notifications (id_user, title, message, type, tenant_id, document_id) VALUES ($1, $2, $3, 'recherche', $4, $5)`,
        [r.user_id, titre, message, r.tenant_id, n === 1 ? nouveaux[0].id : null]
      );
      await db.query('UPDATE recherches_enregistrees SET alerte_derniere_notif_at = now() WHERE id = $1', [r.id]);
      bilan.notifiees += 1;
      bilan.documents += n;
    } catch (err) {
      console.warn(`[recherche] alerte ${r.id} différée : ${err.message}`);
    }
  }
  return bilan;
}

/**
 * Tâche de fond : un passage toutes les 30 minutes ; chaque recherche n'est
 * rejouée qu'une fois par jour. Ne retient pas le processus.
 */
function demarrerAlertes() {
  const tour = async () => {
    let delai = 30 * 60000;
    try {
      const b = await verifierAlertes();
      if (b.notifiees) console.log(`[recherche] ${b.notifiees} alerte(s) envoyée(s) (${b.documents} document(s))`);
    } catch (err) {
      console.warn('[recherche] alertes différées :', err.message);
      delai = 10 * 60000;
    }
    setTimeout(tour, delai).unref();
  };
  setTimeout(tour, 180000).unref();
}

module.exports = {
  TRIS, INTEGRITES, TYPES_FICHIER, OPERATEURS, ACCENTS, SANS,
  normaliserCriteres, criteresVides, construireRequete, segmentsSurlignes, motifContient, replier,
  colonneElimination, migrationPassee, chargerChamps,
  rechercher, referentiel,
  listerRecherches, chargerRecherche, creerRecherche, modifierRecherche, supprimerRecherche,
  initialiserAlerte, verifierAlertes, demarrerAlertes, versRecherche,
};
