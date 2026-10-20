// ============================================================================
// indexSuggestionService — indexation assistée : proposer les métadonnées.
//
// À partir du texte du document (couche texte ou OCR, migrations 027-028) et
// du nom de son fichier, propose une valeur pour les champs de la fiche :
// titre, type, date, année, références, nom — et les MÉTADONNÉES TYPÉES de
// l'organisation, cherchées par leur propre libellé (« Matricule : 4521 »,
// « Date d'effet : 1er mars 2022 »). Ce dernier point rend l'assistant
// indépendant du secteur : il parle le vocabulaire que l'organisation a défini.
//
// Une proposition n'est jamais appliquée d'office : l'archiviste l'accepte
// (une par une ou toutes), comme les suggestions de métadonnées de M-Files.
// Chacune dit où elle a été trouvée (extrait) et sa confiance :
//   haute   — trouvée derrière son libellé, ou dans le titre du document ;
//   moyenne — déduite (premier mot-clé, année la plus fréquente…).
// ============================================================================
const db = require('../config/db');

const MOIS = {
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7,
  aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
};
const TYPES_PAR_DEFAUT = ['Acte', 'Contrat', 'Rapport', 'PV', 'Lettre', 'Dossier', 'Autre'];
// Formes longues d'un type abrégé, pour le reconnaître dans un texte.
const SYNONYMES = { pv: ['proces-verbal', 'proces verbal'], acte: ['acte'], lettre: ['lettre', 'courrier'] };
const LONGUEUR_ANALYSEE = 20000;

/** Minuscules sans accents, caractère par caractère (mêmes positions). */
function normaliser(texte) {
  let s = '';
  for (const c of texte) {
    const n = c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    s += n.length === 1 ? n : c.toLowerCase().slice(0, 1) || ' ';
  }
  return s;
}

const echapper = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Choix d'une liste, sous une forme unique { value, label } : la base stocke
 * des objets ({ value: 'contrat', label: 'Contrat' }), d'anciens champs de
 * simples chaînes. On compare sur le LIBELLÉ (ce qu'on lit dans un document),
 * on propose la VALEUR (ce que le serveur enregistre et valide).
 */
const choix = (options) => (Array.isArray(options) ? options : [])
  .map((o) => (typeof o === 'string' ? { value: o, label: o } : { value: o.value ?? o.label, label: o.label ?? o.value }))
  .filter((o) => o.value !== undefined && o.value !== null);

/** Extrait d'une soixantaine de caractères autour d'une position. */
function extrait(texte, debut, fin) {
  const a = Math.max(0, debut - 30);
  const b = Math.min(texte.length, fin + 30);
  return `${a > 0 ? '…' : ''}${texte.slice(a, b).replace(/\s+/g, ' ').trim()}${b < texte.length ? '…' : ''}`;
}

/** Date réelle → AAAA-MM-JJ, sinon null. */
function dateIso(a, m, j) {
  const an = a < 100 ? (a > 50 ? 1900 + a : 2000 + a) : a;
  if (an < 1900 || an > 2100) return null;
  const d = new Date(Date.UTC(an, m - 1, j));
  if (d.getUTCMonth() !== m - 1 || d.getUTCDate() !== j) return null;
  return `${an}-${String(m).padStart(2, '0')}-${String(j).padStart(2, '0')}`;
}

/** Toutes les dates du texte, dans l'ordre : [{ iso, index, fin }]. */
function trouverDates(texte, norm) {
  const dates = [];
  const ajout = (iso, index, fin) => { if (iso) dates.push({ iso, index, fin }); };
  let m;
  const numerique = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/g;
  while ((m = numerique.exec(texte))) ajout(dateIso(+m[3], +m[2], +m[1]), m.index, m.index + m[0].length);
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  while ((m = iso.exec(texte))) ajout(dateIso(+m[1], +m[2], +m[3]), m.index, m.index + m[0].length);
  const lettres = new RegExp(`\\b(\\d{1,2})(?:er)?\\s+(${Object.keys(MOIS).join('|')})\\s+(\\d{4})\\b`, 'g');
  while ((m = lettres.exec(norm))) ajout(dateIso(+m[3], MOIS[m[2]], +m[1]), m.index, m.index + m[0].length);
  return dates.sort((x, y) => x.index - y.index);
}

/** Date contenue dans une valeur courte (« 1er mars 2022 », « 01/03/2022 »). */
function dateDans(valeur) {
  const [d] = trouverDates(valeur, normaliser(valeur));
  return d ? d.iso : null;
}

/**
 * Propositions pour un texte. Fonction pure.
 * @param {string} brut  texte du document
 * @param {object} ctx   { nomFichier, types: string[], champs: [{ id, label, type, options }] }
 * @returns {Array<{ champ, libelle, valeur, confiance, extrait }>}
 */
function proposer(brut, { nomFichier = '', types = TYPES_PAR_DEFAUT, champs = [], classes = [] } = {}) {
  const texte = String(brut || '').slice(0, LONGUEUR_ANALYSEE);
  const norm = normaliser(texte);
  const props = [];
  const proposerUne = (p) => {
    if (p.valeur === null || p.valeur === undefined || String(p.valeur).trim() === '') return;
    if (!props.some((x) => x.champ === p.champ)) props.push({ ...p, valeur: typeof p.valeur === 'string' ? p.valeur.trim() : p.valeur });
  };

  // --- Titre : la première ligne qui dit ce qu'est le document. Les en-têtes
  // institutionnels (« RÉPUBLIQUE DU BÉNIN », « MAIRIE DE … ») sont sautés.
  const lignes = texte.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length >= 8).slice(0, 12);
  const entete = /^(republique|ministere|mairie|prefecture|direction|service|commune|departement|cabinet|fraternite|liberte)\b/;
  const titre = lignes.find((l) => !entete.test(normaliser(l)) && l.length >= 15)
    || lignes.find((l) => l.length >= 15);
  if (titre) {
    const i = texte.indexOf(titre);
    proposerUne({ champ: 'description', libelle: 'Titre / description', valeur: titre.slice(0, 150), confiance: 'moyenne', extrait: extrait(texte, i, i + titre.length) });
  }

  // --- Type : un type connu de l'organisation, le plus tôt dans le texte (le
  // titre) ou dans le nom du fichier.
  const fichierNorm = normaliser(String(nomFichier).replace(/[_-]+/g, ' '));
  let meilleur = null;
  for (const t of types) {
    const formes = [normaliser(t), ...(SYNONYMES[normaliser(t)] || [])];
    for (const f of formes) {
      if (f.length < 2) continue;
      const re = new RegExp(`\\b${echapper(f)}s?\\b`);
      const m = re.exec(norm.slice(0, 1500));
      if (m && (!meilleur || m.index < meilleur.index)) meilleur = { type: t, index: m.index, fin: m.index + m[0].length, source: 'texte' };
      if (!m && !meilleur && re.test(fichierNorm)) meilleur = { type: t, index: -1, source: 'fichier' };
    }
  }
  if (meilleur && meilleur.type !== 'Autre') {
    proposerUne({
      champ: 'type_document', libelle: 'Type de document', valeur: meilleur.type,
      confiance: meilleur.source === 'texte' && meilleur.index < 300 ? 'haute' : 'moyenne',
      extrait: meilleur.source === 'texte' ? extrait(texte, meilleur.index, meilleur.fin) : `Nom du fichier : ${nomFichier}`,
    });
  }

  // --- Classe : son nom ou un de ses mots de reconnaissance, le plus tôt dans
  // le texte ; à égalité, la forme la plus longue (« facture client » l'emporte
  // sur « facture »). À défaut, le nom du fichier.
  let classe = null;
  for (const c of classes) {
    const formes = [c.nom, ...String(c.mots_cles || '').split(',')].map((f) => normaliser(f.trim())).filter((f) => f.length >= 3);
    for (const f of formes) {
      const re = new RegExp(`(^|[^a-z0-9])${echapper(f)}s?(?![a-z0-9])`);
      const m = re.exec(norm.slice(0, 1500));
      if (m) {
        const index = m.index + m[1].length;
        if (!classe || classe.source !== 'texte' || index < classe.index || (index === classe.index && f.length > classe.longueur)) {
          classe = { c, index, fin: index + f.length, longueur: f.length, source: 'texte' };
        }
      } else if (!classe && re.test(fichierNorm)) {
        classe = { c, index: -1, longueur: f.length, source: 'fichier' };
      }
    }
  }
  if (classe) {
    proposerUne({
      champ: 'classe_id', libelle: 'Classe', valeur: classe.c.id, affichage: classe.c.nom,
      confiance: classe.source === 'texte' && classe.index < 300 ? 'haute' : 'moyenne',
      extrait: classe.source === 'texte' ? extrait(texte, classe.index, classe.fin) : `Nom du fichier : ${nomFichier}`,
    });
  }

  // --- Date du document : celle qui suit « le », « en date du », « fait à … le » ;
  // à défaut, la première du texte.
  // Priorité : la date de signature (« fait à …, le »), puis « le » /
  // « en date du », puis « du » — « la délibération du 14 mars » cite une
  // autre pièce et ne date pas celle-ci.
  const dates = trouverDates(texte, norm);
  const ANNONCES = [/fait a [^\n]{0,40}?le\s*$/, /(?:\ble|en date du)\s*$/, /\bdu\s*$/];
  const rang = (d) => {
    const avant = norm.slice(Math.max(0, d.index - 50), d.index);
    const i = ANNONCES.findIndex((re) => re.test(avant));
    return i === -1 ? 99 : i;
  };
  const datee = dates.filter((d) => rang(d) < 99).sort((a, b) => rang(a) - rang(b) || a.index - b.index)[0];
  const retenue = datee || dates[0];
  if (retenue) {
    proposerUne({ champ: 'date_document', libelle: 'Date du document', valeur: retenue.iso, confiance: datee ? 'haute' : 'moyenne', extrait: extrait(texte, retenue.index, retenue.fin) });
  }

  // --- Année : celle de la date retenue ; sinon la plus fréquente du texte.
  if (retenue) {
    proposerUne({ champ: 'annee', libelle: 'Année', valeur: Number(retenue.iso.slice(0, 4)), confiance: datee ? 'haute' : 'moyenne', extrait: extrait(texte, retenue.index, retenue.fin) });
  } else {
    const compte = {};
    const annees = /\b(19[5-9]\d|20\d{2})\b/g;
    let m;
    let premiere = null;
    while ((m = annees.exec(texte))) {
      compte[m[1]] = (compte[m[1]] || 0) + 1;
      if (!premiere) premiere = m;
    }
    const [an] = Object.entries(compte).sort((a, b) => b[1] - a[1])[0] || [];
    if (an && Number(an) <= new Date().getFullYear() + 1) {
      const i = texte.indexOf(an);
      proposerUne({ champ: 'annee', libelle: 'Année', valeur: Number(an), confiance: 'moyenne', extrait: extrait(texte, i, i + 4) });
    }
  }

  // --- Références.
  const reference = (champ, libelle, re) => {
    const m = re.exec(texte);
    if (m && /\d/.test(m[1])) proposerUne({ champ, libelle, valeur: m[1].replace(/[.,;:]+$/, ''), confiance: 'haute', extrait: extrait(texte, m.index, m.index + m[0].length) });
  };
  // Forme RCCM (« RB/COT/2020 B 451 ») d'abord, avec ou sans libellé : ses
  // espaces internes couperaient la forme générique.
  reference('num_dossier', 'N° de dossier', /\b(?:RCCM|dossier)\s*(?:n[°o]\.?\s*)?[:.]?\s*([A-Z]{2}\/[A-Z]{2,5}\/\d{2,4}(?:\s?[A-Z])?\s?\d+)/i);
  reference('num_dossier', 'N° de dossier', /\b(?:dossier|r[ée]f[ée]rence|r[ée]f\.?)\s*(?:n[°o]\.?\s*)?[:.]?\s*([A-Z0-9][A-Z0-9/\-.]{2,30})/i);
  reference('num_acte', 'N° d\'acte', /\b(?:acte|arr[êe]t[ée]|d[ée]cision|d[ée]lib[ée]ration|contrat)[^\n]{0,30}?\bn[°o]\.?\s*[:.]?\s*([A-Z0-9][A-Z0-9/\-.]{1,30})/i);

  // --- Nom (entreprise, sujet) : derrière son libellé, ou une forme sociale.
  const libelleNom = /\b(?:soci[ée]t[ée]|entreprise|raison sociale|d[ée]nomination|bailleur|preneur|employeur|fournisseur|b[ée]n[ée]ficiaire|soumissionnaire|cocontractant|demandeur)\s*:\s*([^\n,;]{2,60})/i.exec(texte);
  if (libelleNom) {
    proposerUne({ champ: 'nom_entreprise', libelle: 'Entreprise / sujet', valeur: libelleNom[1].replace(/[.]+$/, ''), confiance: 'haute', extrait: extrait(texte, libelleNom.index, libelleNom.index + libelleNom[0].length) });
  } else {
    // Classes Unicode : \w et \b ignorent les lettres accentuées, et
    // « BÉNIN AGRO SARL » devenait « NIN AGRO SARL ».
    const forme = /(?<![\p{L}\d])((?:\p{Lu}[\p{L}\d&'.-]*\s+){0,3}\p{Lu}[\p{L}\d&'.-]*)\s+(SARL|SA|SAS|SASU|GIE|SCI|SNC|ETS)(?![\p{L}\d])/u.exec(texte);
    if (forme) proposerUne({ champ: 'nom_entreprise', libelle: 'Entreprise / sujet', valeur: `${forme[1]} ${forme[2]}`, confiance: 'moyenne', extrait: extrait(texte, forme.index, forme.index + forme[0].length) });
  }

  // --- Métadonnées typées de l'organisation, cherchées par leur libellé.
  // Une propriété qui porte le nom d'un champ de la fiche (« Type de
  // document », « Année »…) reçoit la même proposition, si elle est admise :
  // l'archiviste n'a pas à accepter deux fois la même information.
  const JUMEAUX = { 'type de document': 'type_document', 'annee': 'annee', 'date du document': 'date_document', 'date': 'date_document' };
  for (const champ of champs) {
    const jumeau = props.find((x) => x.champ === JUMEAUX[normaliser(champ.label || '').trim()]);
    if (jumeau) {
      const v = champ.type === 'select'
        ? choix(champ.options).find((o) => [o.label, o.value].some((x) => normaliser(String(x)) === normaliser(String(jumeau.valeur))))?.value
        : jumeau.valeur;
      const affichage = champ.type === 'select' ? choix(champ.options).find((o) => o.value === v)?.label : undefined;
      if (v !== undefined && v !== null) proposerUne({ ...jumeau, champ: `meta:${champ.id}`, libelle: champ.label, valeur: v, ...(affichage ? { affichage } : {}) });
    }
  }
  for (const champ of champs) {
    if (!champ.label || ['boolean', 'user', 'document', 'multiselect'].includes(champ.type)) continue;
    const lib = normaliser(champ.label).trim();
    if (lib.length < 3) continue;
    const re = new RegExp(`\\b${echapper(lib)}\\s*(?:n[°o]\\.?\\s*)?[:\\-–]?\\s*([^\\n;|]{1,80})`);
    const m = re.exec(norm);
    const options = choix(champ.options);
    const cle = `meta:${champ.id}`;
    if (m) {
      const debutValeur = m.index + m[0].length - m[1].length;
      // La valeur s'arrête au séparateur suivant : « Matricule : 4521, Service :
      // Comptabilité » ne doit pas donner « 4521, Service : Comptabilité ».
      let valeur = texte.slice(debutValeur, debutValeur + m[1].length).split(/\s{2,}|\.\s|[,;]\s|\s[—–-]\s/)[0].trim();
      if (champ.type === 'date') valeur = dateDans(valeur);
      else if (champ.type === 'number') valeur = (/-?\d+(?:[.,]\d+)?/.exec(valeur.replace(/\s/g, '')) || [])[0]?.replace(',', '.') ?? null;
      else if (champ.type === 'select') valeur = options.find((o) => normaliser(valeur).includes(normaliser(String(o.label))))?.value ?? null;
      if (valeur !== null && valeur !== '') {
        const affichage = champ.type === 'select' ? options.find((o) => o.value === valeur)?.label : undefined;
        proposerUne({ champ: cle, libelle: champ.label, valeur, ...(affichage ? { affichage } : {}), confiance: 'haute', extrait: extrait(texte, m.index, m.index + m[0].length) });
        continue;
      }
    }
    // Liste de choix sans libellé dans le texte : un choix cité tel quel.
    if (champ.type === 'select') {
      for (const o of options) {
        const n = normaliser(String(o.label));
        if (n.length < 4) continue;
        const mo = new RegExp(`\\b${echapper(n)}\\b`).exec(norm);
        if (mo) {
          proposerUne({ champ: cle, libelle: champ.label, valeur: o.value, affichage: o.label, confiance: 'moyenne', extrait: extrait(texte, mo.index, mo.index + n.length) });
          break;
        }
      }
    }
  }

  return props;
}

/**
 * Propositions pour un document de l'organisation.
 * @returns {Promise<{ texte: 'disponible'|'en_attente'|'aucun', propositions: Array }|null>} null si absent
 */
async function propositionsPour(tenantId, documentId) {
  const d = await db.query(
    'SELECT id, dossier_id, contenu_texte, description FROM documents WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
    [documentId, tenantId]
  );
  const doc = d.rows[0];
  if (!doc) return null;

  const f = await db.query(
    `SELECT original_name, mime_type, texte_extrait IS NOT NULL AS a_texte, texte_extrait_at,
            ${await colonneOcr() ? 'ocr_tente_at' : 'NULL::timestamptz AS ocr_tente_at'}
       FROM document_files WHERE document_id = $1 ORDER BY version DESC`,
    [documentId]
  );
  const fichiers = f.rows;
  const enAttente = fichiers.some((x) => !x.a_texte && (!x.texte_extrait_at
    || (!x.ocr_tente_at && /^(image\/|application\/pdf)/.test(x.mime_type || ''))));

  // Types : ceux que l'organisation emploie déjà, sa liste de demande, et la
  // liste par défaut — l'assistant propose des valeurs familières.
  const settingsService = require('./settingsService');
  const reglages = await settingsService.getAll(tenantId);
  const deDemande = (Array.isArray(reglages.request_document_types) ? reglages.request_document_types : [])
    .map((o) => (typeof o === 'string' ? o : o.label || o.value)).filter(Boolean);
  const usages = (await db.query(
    `SELECT type_document FROM documents WHERE tenant_id = $1 AND type_document IS NOT NULL AND deleted_at IS NULL
      GROUP BY type_document ORDER BY COUNT(*) DESC LIMIT 30`, [tenantId])).rows.map((r) => r.type_document);
  const types = [...new Set([...usages, ...deDemande, ...TYPES_PAR_DEFAUT])];

  const champs = (await db.query(
    `SELECT f.id, f.label, f.type, f.options_json AS options
       FROM metadata_fields f JOIN metadata_schemas s ON s.id = f.schema_id
      WHERE s.tenant_id = $1 ORDER BY s.is_default DESC, f.display_order`, [tenantId])).rows;

  // Classes de l'organisation (migration 029 : code, mots de reconnaissance).
  const classes = (await db.query(
    `SELECT id, name AS nom, ${await colonneClasse() ? 'mots_cles' : 'NULL AS mots_cles'}
       FROM metadata_schemas WHERE tenant_id = $1 AND is_default IS NOT TRUE ORDER BY name`, [tenantId])).rows;

  const texte = doc.contenu_texte || '';
  return {
    texte: texte ? 'disponible' : enAttente ? 'en_attente' : 'aucun',
    propositions: proposer(texte, { nomFichier: fichiers[0]?.original_name || '', types, champs, classes }),
    // La liste que la fiche propose : la même que celle dont l'assistant tire
    // ses propositions — une proposition est toujours choisissable.
    types,
  };
}

let colonneClassePromesse = null;
function colonneClasse() {
  if (!colonneClassePromesse) {
    colonneClassePromesse = db.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'metadata_schemas' AND column_name = 'mots_cles'")
      .then((r) => r.rows.length > 0).catch(() => { colonneClassePromesse = null; return false; });
  }
  return colonneClassePromesse;
}

let colonneOcrPromesse = null;
function colonneOcr() {
  if (!colonneOcrPromesse) {
    colonneOcrPromesse = db.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'document_files' AND column_name = 'ocr_tente_at'")
      .then((r) => r.rows.length > 0).catch(() => { colonneOcrPromesse = null; return false; });
  }
  return colonneOcrPromesse;
}

module.exports = { proposer, propositionsPour, normaliser, trouverDates, TYPES_PAR_DEFAUT };
