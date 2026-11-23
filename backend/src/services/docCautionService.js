// ============================================================================
// docCautionService — Doc Caution (063) : le dossier partagé des actes (Word,
// PDF), lu par l'application.
//
// Circuit des remboursements : le DE envoie un courrier avec les références du
// marché ; l'archive retrouve l'acte dans Doc Caution, puis, avec le n° d'acte,
// le dossier. Ici, la référence du marché suffit : l'acte est retrouvé dans le
// texte des fichiers, et sa présence aux archives est donnée dans la foulée.
//
// Deux sources :
//   - le dossier partagé lui-même (serveur interne) : DOC_CAUTION_DIR, relu
//     toutes les 30 min (fichiers nouveaux ou modifiés seulement) ;
//   - des fichiers déposés depuis le navigateur (version en ligne).
// Seul le texte est gardé ; l'acte s'ouvre depuis Doc Caution.
// ============================================================================
const fs = require('fs');
const path = require('path');
const db = require('../config/db');

const EXTENSIONS = new Set(['pdf', 'docx', 'doc', 'txt']);
const MAX_TEXTE = 200000;

function erreur(statut, message) { const e = new Error(message); e.statut = statut; return e; }
const sansAccents = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
/** Minuscules, sans accents, sans espaces ni ponctuation : « N° 2026/123-MEF » → « n2026123mef ». */
const compacter = (s) => sansAccents(s).toLowerCase().replace(/[^a-z0-9]/g, '');

/** Le n° d'acte et son année : dans le texte (« Acte n° 14614 / 2025 »), sinon dans le nom du fichier. */
function numeroActe(nomFichier, texte) {
  const t = sansAccents(texte || '');
  const m = /\b(?:acte|caution(?:nement)?|garantie)\s*(?:de\s+[a-z ]{3,30}?\s*)?(?:n\s*[°o.]?|no\.?|numero)\s*[:\-]?\s*(\d{2,6})\s*(?:[/\-]\s*((?:19|20)\d{2}))?/i.exec(t);
  if (m) return { num: m[1].replace(/^0+(?=\d)/, ''), annee: m[2] ? Number(m[2]) : null };
  const base = path.parse(nomFichier).name;
  const n = (base.match(/\d{2,6}/g) || []).find((x) => !/^(19|20)\d{2}$/.test(x));
  const a = /(?:^|\D)((?:19|20)\d{2})(?:\D|$)/.exec(base);
  return { num: n ? n.replace(/^0+(?=\d)/, '') : null, annee: a ? Number(a[1]) : null };
}

/** Les références de marché citées (« Marché n° 2026/015/MEF/DNCMP », « Contrat n° … »). */
function referencesMarche(texte) {
  const t = String(texte || '').replace(/\s+/g, ' ');
  const re = /\b(?:march[ée]|contrat|lettre de commande|convention|bon de commande|DAO|AAO|appel d'offres?|r[ée]f[ée]rence)s?\s*(?:n\s*[°ºo.]?|no\.?|num[ée]ro)?\s*[:\-]?\s*((?:[A-Z0-9][A-Za-z0-9/._\-]*)(?:\s+(?:[A-Z0-9][A-Za-z0-9/._\-]*[0-9/][A-Za-z0-9/._\-]*|[A-Z]{2,}[/\-][A-Za-z0-9/._\-]*)){0,6})/g;
  const res = new Set();
  for (const m of t.matchAll(re)) {
    const ref = m[1].replace(/[.\-/]+$/, '').trim();
    if (ref.length >= 4 && /\d/.test(ref)) res.add(ref.slice(0, 120));
    if (res.size >= 10) break;
  }
  return [...res];
}

/** Le client, d'après le nom du fichier (sans numéros, années ni sigles de typologie). */
function clientDuFichier(nomFichier) {
  const base = path.parse(nomFichier).name
    .replace(/[_]+/g, ' ')
    .replace(/\b(acte|actes|caution|cautions|cbe|cad|cp|cd|crg|att|gb|cm|s|n°|no|n)\b/gi, ' ')
    .replace(/\d+/g, ' ')
    .replace(/[()[\]{}#.,;:+\-/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return base.length >= 2 ? base.slice(0, 200) : null;
}

/** Lit un fichier (Word, PDF, texte ; OCR pour un scan) et l'enregistre. */
async function ingerer(tenantId, { chemin, buffer, origine = 'depot', modifie_le = null }) {
  const nom = path.basename(chemin);
  const ext = path.extname(nom).slice(1).toLowerCase();
  if (!EXTENSIONS.has(ext)) return { ignore: true };
  let texte = '';
  let err = null;
  if (ext === 'doc') err = 'Ancien format Word (.doc) : enregistrez-le en .docx ou en PDF pour qu\'il soit lu.';
  else {
    try { texte = await require('./ragService').texteDuFichier(buffer, ext); } catch (e) { err = `Lecture impossible : ${e.message}`.slice(0, 300); }
    if (!err && !texte.replace(/\s/g, '').length) err = 'Aucun texte lisible (scan illisible ou fichier vide).';
  }
  texte = texte.slice(0, MAX_TEXTE);
  const { num, annee } = numeroActe(nom, texte);
  const refs = referencesMarche(texte);
  const empreinte = require('crypto').createHash('sha1').update(buffer).digest('hex');
  await db.query(
    `INSERT INTO doc_caution_actes (tenant_id, chemin, nom_fichier, origine, taille, modifie_le, empreinte, num_acte, annee, client, references_marche, texte, texte_compact, erreur, indexe_le)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
     ON CONFLICT (tenant_id, chemin) DO UPDATE SET nom_fichier = $3, origine = $4, taille = $5, modifie_le = $6, empreinte = $7, num_acte = $8, annee = $9,
       client = $10, references_marche = $11, texte = $12, texte_compact = $13, erreur = $14, indexe_le = now()`,
    [tenantId, String(chemin).slice(0, 1000), nom.slice(0, 500), origine, buffer.length, modifie_le, empreinte, num, annee, clientDuFichier(nom),
      refs, texte || null, compacter(`${nom} ${texte}`) || null, err]
  );
  return { lu: !err, num_acte: num, references: refs.length, erreur: err };
}

/** Extrait de texte autour de ce qui a été trouvé. */
function extrait(texte, q) {
  const t = String(texte || '').replace(/\s+/g, ' ');
  if (!t) return '';
  const plat = sansAccents(t).toLowerCase();
  const mots = sansAccents(q).toLowerCase().split(/[^a-z0-9]+/).filter((m) => m.length >= 3).sort((a, b) => b.length - a.length);
  const i = mots.map((m) => plat.indexOf(m)).find((x) => x >= 0) ?? -1;
  if (i < 0) return t.slice(0, 220);
  const d = Math.max(0, i - 90);
  return `${d > 0 ? '…' : ''}${t.slice(d, d + 260)}${d + 260 < t.length ? '…' : ''}`;
}

/**
 * Cherche un acte par référence de marché, n° d'acte, client ou n'importe quel
 * passage du texte. Rend aussi, pour chaque acte, sa présence aux archives.
 */
async function rechercher(tenantId, q, { avecPresence = true } = {}) {
  const brut = String(q || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const c = compacter(brut);
  if (c.length < 3) throw erreur(400, 'Tapez au moins trois caractères : la référence du marché, un n° d\'acte ou un nom.');
  const conds = ['tenant_id = $1'];
  const params = [tenantId, `%${c}%`];
  if (/^\d{2,6}$/.test(brut)) {
    params.push(brut.replace(/^0+(?=\d)/, ''));
    conds.push('(texte_compact LIKE $2 OR num_acte = $3)');
  } else {
    // La référence entière, quelle que soit sa mise en forme ; à défaut, tous ses morceaux.
    const morceaux = sansAccents(brut).toLowerCase().split(/[^a-z0-9]+/).filter((m) => m.length >= 2);
    const tous = morceaux.length > 1 ? morceaux.map((m) => { params.push(`%${m}%`); return `texte_compact LIKE $${params.length}`; }).join(' AND ') : null;
    conds.push(`(texte_compact LIKE $2${tous ? ` OR (${tous})` : ''})`);
  }
  const r = await db.query(
    `SELECT id, chemin, nom_fichier, origine, num_acte, annee, client, references_marche, texte, erreur, modifie_le,
            (texte_compact LIKE $2) AS exact
       FROM doc_caution_actes WHERE ${conds.join(' AND ')}
      ORDER BY (texte_compact LIKE $2) DESC, annee DESC NULLS LAST, modifie_le DESC NULLS LAST LIMIT 50`,
    params
  );
  const entrees = require('./entreeService');
  const res = [];
  for (const [i, a] of r.rows.entries()) {
    const ligne = {
      id: a.id, chemin: a.chemin, nom_fichier: a.nom_fichier, origine: a.origine, num_acte: a.num_acte, annee: a.annee, client: a.client,
      references_marche: a.references_marche || [], exact: a.exact, extrait: extrait(a.texte, brut), erreur: a.erreur,
    };
    if (avecPresence && i < 10 && a.num_acte) {
      ligne.presence = await entrees.presence(tenantId, { num_acte: a.annee ? `${a.annee}/${a.num_acte}` : a.num_acte, nom_entreprise: a.client || '' }).catch(() => null);
    }
    res.push(ligne);
  }
  return res;
}

async function etat(tenantId) {
  const r = (await db.query(
    `SELECT count(*)::int AS fichiers, count(*) FILTER (WHERE erreur IS NULL)::int AS lus, count(num_acte)::int AS avec_acte,
            count(*) FILTER (WHERE erreur IS NOT NULL)::int AS illisibles, max(indexe_le) AS dernier
       FROM doc_caution_actes WHERE tenant_id = $1`, [tenantId]
  )).rows[0];
  const illisibles = (await db.query(
    'SELECT nom_fichier, erreur FROM doc_caution_actes WHERE tenant_id = $1 AND erreur IS NOT NULL ORDER BY nom_fichier LIMIT 30', [tenantId]
  )).rows;
  return { ...r, illisibles, dossier: Boolean(dossierPartage()) };
}

async function viderDepots(tenantId) {
  const r = await db.query("DELETE FROM doc_caution_actes WHERE tenant_id = $1 AND origine = 'depot'", [tenantId]);
  return { supprimes: r.rowCount };
}

// ---------------------------------------------------------------------------
// Le dossier partagé (serveur interne).
// ---------------------------------------------------------------------------
const dossierPartage = () => {
  const d = String(process.env.DOC_CAUTION_DIR || '').trim();
  return d || null;
};

function* parcourir(racine, rel = '') {
  let entrees = [];
  try { entrees = fs.readdirSync(path.join(racine, rel), { withFileTypes: true }); } catch { return; }
  for (const e of entrees) {
    if (e.name.startsWith('~$') || e.name.startsWith('.')) continue;
    const r = path.join(rel, e.name);
    if (e.isDirectory()) yield* parcourir(racine, r);
    else if (EXTENSIONS.has(path.extname(e.name).slice(1).toLowerCase())) yield r;
  }
}

/** Relit le dossier partagé : nouveaux et modifiés lus, disparus retirés. */
async function synchroniser(tenantId, racine = dossierPartage()) {
  if (!racine) throw erreur(503, 'Le dossier Doc Caution n\'est pas raccordé (DOC_CAUTION_DIR).');
  if (!fs.existsSync(racine)) throw erreur(503, `Dossier Doc Caution introuvable ou inaccessible : ${racine}`);
  const connus = new Map((await db.query("SELECT chemin, taille, modifie_le FROM doc_caution_actes WHERE tenant_id = $1 AND origine = 'dossier'", [tenantId])).rows
    .map((x) => [x.chemin, x]));
  const vus = new Set();
  const bilan = { lus: 0, inchanges: 0, retires: 0, erreurs: 0 };
  for (const rel of parcourir(racine)) {
    const chemin = rel.split(path.sep).join('/');
    vus.add(chemin);
    let st;
    try { st = fs.statSync(path.join(racine, rel)); } catch { continue; }
    const k = connus.get(chemin);
    if (k && Number(k.taille) === st.size && k.modifie_le && Math.abs(new Date(k.modifie_le) - st.mtime) < 1000) { bilan.inchanges += 1; continue; }
    try {
      const r = await ingerer(tenantId, { chemin, buffer: fs.readFileSync(path.join(racine, rel)), origine: 'dossier', modifie_le: st.mtime });
      if (r.erreur) bilan.erreurs += 1; else bilan.lus += 1;
    } catch { bilan.erreurs += 1; }
  }
  for (const chemin of connus.keys()) {
    if (!vus.has(chemin)) { await db.query("DELETE FROM doc_caution_actes WHERE tenant_id = $1 AND chemin = $2 AND origine = 'dossier'", [tenantId, chemin]); bilan.retires += 1; }
  }
  return bilan;
}

/** Chemin réel d'un acte du dossier partagé (jamais hors du dossier). */
async function fichier(tenantId, id) {
  const a = (await db.query('SELECT chemin, nom_fichier, origine FROM doc_caution_actes WHERE tenant_id = $1 AND id = $2', [tenantId, Number(id)])).rows[0];
  if (!a) throw erreur(404, 'Acte introuvable.');
  const racine = dossierPartage();
  if (a.origine !== 'dossier' || !racine) throw erreur(404, 'Le fichier n\'est pas conservé par l\'application : ouvrez-le dans Doc Caution.');
  const complet = path.resolve(racine, a.chemin);
  if (!complet.startsWith(path.resolve(racine) + path.sep)) throw erreur(400, 'Chemin invalide.');
  if (!fs.existsSync(complet)) throw erreur(404, 'Le fichier n\'est plus dans Doc Caution.');
  return { complet, nom: a.nom_fichier };
}

let minuterie = null;
function demarrer() {
  if (minuterie || !dossierPartage()) return;
  const tour = async () => {
    const slug = process.env.DOC_CAUTION_ORGANISATION || 'afgc';
    const t = (await db.query('SELECT id FROM tenants WHERE slug = $1', [slug]).catch(() => ({ rows: [] }))).rows[0];
    if (!t) return;
    const b = await synchroniser(t.id).catch((e) => { console.error('[doc caution]', e.message); return null; });
    if (b && (b.lus || b.retires)) console.log(`[doc caution] ${b.lus} lu(s), ${b.retires} retiré(s), ${b.erreurs} illisible(s)`);
  };
  minuterie = setInterval(() => tour().catch(() => {}), 30 * 60 * 1000);
  minuterie.unref?.();
  setTimeout(() => tour().catch(() => {}), 90 * 1000).unref?.();
}

module.exports = { compacter, numeroActe, referencesMarche, clientDuFichier, ingerer, rechercher, etat, viderDepots, synchroniser, fichier, demarrer };
