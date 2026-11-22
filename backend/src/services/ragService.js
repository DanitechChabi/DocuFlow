// ============================================================================
// ragService — DocuBot répond à partir du contenu des documents (RAG).
//
// 1. Indexer : le texte d'un document (GED : documents.contenu_texte ; M-Files :
//    fichiers téléchargés par l'API REST, texte lu, OCR pour un scan) est
//    découpé en morceaux d'environ 900 caractères qui se chevauchent, gardés
//    dans rag_passages avec, si le modèle local est là, leur vecteur (e5).
// 2. Retrouver : recherche plein texte en français (PostgreSQL), puis les
//    candidats sont reclassés par le sens (vecteurs) quand c'est possible.
// 3. Répondre : Ollama rédige à partir des seuls passages retrouvés, avec les
//    numéros des sources ; sans Ollama, les passages eux-mêmes sont rendus.
// Rien ne quitte le serveur : ni le texte, ni la question.
// ============================================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../config/db');
const ia = require('./iaService');
const ollama = require('./ollamaService');
const mfiles = require('./mfilesApiService');

const TAILLE = 900;
const CHEVAUCHEMENT = 150;
const MAX_MORCEAUX = 400;          // par document
const MAX_FICHIER = 25 * 1024 * 1024;
const EXTENSIONS = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword', txt: 'text/plain', csv: 'text/csv', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', tif: 'image/tiff', tiff: 'image/tiff' };

function erreur(statut, message) { const e = new Error(message); e.statut = statut; return e; }

/** Découpe un texte en morceaux qui se chevauchent, en coupant aux phrases. */
function decouper(texte, taille = TAILLE, chevauchement = CHEVAUCHEMENT) {
  const t = String(texte || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!t) return [];
  const morceaux = [];
  let debut = 0;
  while (debut < t.length && morceaux.length < MAX_MORCEAUX) {
    let fin = Math.min(debut + taille, t.length);
    if (fin < t.length) {
      const coupe = Math.max(t.lastIndexOf('. ', fin), t.lastIndexOf('\n', fin));
      if (coupe > debut + taille * 0.5) fin = coupe + 1;
    }
    const m = t.slice(debut, fin).trim();
    if (m.length >= 20) morceaux.push(m);
    if (fin >= t.length) break;
    debut = Math.max(fin - chevauchement, debut + 1);
  }
  return morceaux;
}

const cosinus = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 1) s += a[i] * b[i]; return s; };

/** Remplace les morceaux d'une source. */
async function enregistrer(tenantId, { source, ref, version = null, titre, texte }) {
  const morceaux = decouper(texte);
  const vecs = morceaux.length ? await ia.vecteurs(morceaux.map((m) => `${titre || ''}\n${m}`.slice(0, 1500)), { prefixe: 'passage' }).catch(() => null) : null;
  await db.query('DELETE FROM rag_passages WHERE tenant_id = $1 AND source = $2 AND source_ref = $3', [tenantId, source, String(ref)]);
  for (let i = 0; i < morceaux.length; i += 1) {
    await db.query(
      'INSERT INTO rag_passages (tenant_id, source, source_ref, version, titre, morceau, texte, vecteur) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [tenantId, source, String(ref), version === null ? null : String(version), titre ? String(titre).slice(0, 500) : null, i, morceaux[i], vecs ? Array.from(vecs[i]) : null]
    );
  }
  return morceaux.length;
}

/** Documents de la GED dont le texte n'est pas encore indexé (ou a changé). */
async function indexerGed(tenantId, { limite = 50 } = {}) {
  const r = await db.query(
    `SELECT d.id, concat_ws(' — ', NULLIF(d.nom_entreprise, ''), NULLIF(d.type_document, ''), CASE WHEN d.num_acte <> '' THEN 'acte ' || d.num_acte END, NULLIF(d.description, '')) AS titre, d.contenu_texte, md5(d.contenu_texte) AS empreinte
       FROM documents d
      WHERE d.tenant_id = $1 AND d.deleted_at IS NULL AND COALESCE(d.contenu_texte, '') <> ''
        AND NOT EXISTS (SELECT 1 FROM rag_passages p WHERE p.tenant_id = d.tenant_id AND p.source = 'ged'
                          AND p.source_ref = d.id::text AND p.version = md5(d.contenu_texte))
      ORDER BY d.id DESC LIMIT $2`,
    [tenantId, limite]
  ).catch((err) => { if (err.code === '42703' || err.code === '42P01') return { rows: [] }; throw err; });
  let n = 0;
  for (const d of r.rows) { await enregistrer(tenantId, { source: 'ged', ref: d.id, version: d.empreinte, titre: d.titre, texte: d.contenu_texte }); n += 1; }
  return n;
}

/** Le texte d'un fichier téléchargé de M-Files (texte, sinon OCR pour un scan). */
async function texteDuFichier(buffer, extension) {
  const mime = EXTENSIONS[extension];
  if (!mime || buffer.length > MAX_FICHIER) return '';
  const tmp = path.join(os.tmpdir(), `mfiles-${process.pid}-${Date.now()}.${extension}`);
  try {
    let texte = '';
    if (!mime.startsWith('image/')) {
      fs.writeFileSync(tmp, buffer);
      texte = await require('./textExtractionService').extractText(tmp, mime);
    }
    if (texte.replace(/\s/g, '').length < 50) {
      const ocr = require('./ocrService');
      if (ocr.ocrisable(mime)) texte = (await ocr.lireScan(buffer, mime, { maxPages: 15 }).catch(() => '')) || texte;
    }
    return String(texte || '');
  } finally { fs.rmSync(tmp, { force: true }); }
}

/** Indexe un objet M-Files (ses fichiers lisibles), si sa version a changé. */
async function indexerObjetMfiles(tenantId, o, { forcer = false } = {}) {
  const deja = (await db.query('SELECT indexe_version FROM mfiles_objets WHERE tenant_id = $1 AND objet_type = $2 AND objet_id = $3', [tenantId, o.type, o.id])).rows[0];
  await db.query(
    `INSERT INTO mfiles_objets (tenant_id, objet_type, objet_id, version, titre, classe, fichiers, modifie_le, vu_le)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (tenant_id, objet_type, objet_id) DO UPDATE SET version = $4, titre = $5, classe = $6, fichiers = $7, modifie_le = $8, vu_le = now()`,
    [tenantId, o.type, o.id, o.version ?? null, String(o.titre || '').slice(0, 500), o.classe === null || o.classe === undefined ? null : String(o.classe), JSON.stringify(o.fichiers || []), o.modifie_le || null]
  );
  if (!forcer && deja && deja.indexe_version !== null && deja.indexe_version === (o.version ?? null)) return { indexe: false, raison: 'deja' };
  let textes = [];
  try {
    for (const f of (o.fichiers || []).filter((x) => EXTENSIONS[x.extension]).slice(0, 5)) {
      const { buffer } = await mfiles.contenu(tenantId, o.type, o.id, f.id);
      const t = await texteDuFichier(buffer, f.extension);
      if (t.trim()) textes.push(t);
    }
  } catch (err) {
    await db.query('UPDATE mfiles_objets SET erreur_index = $4 WHERE tenant_id = $1 AND objet_type = $2 AND objet_id = $3', [tenantId, o.type, o.id, err.message.slice(0, 500)]);
    throw err;
  }
  textes = textes.join('\n\n');
  const n = await enregistrer(tenantId, { source: 'mfiles', ref: `${o.type}-${o.id}`, version: o.version, titre: o.titre, texte: textes || o.titre });
  await db.query('UPDATE mfiles_objets SET indexe_version = $4, indexe_le = now(), erreur_index = NULL WHERE tenant_id = $1 AND objet_type = $2 AND objet_id = $3', [tenantId, o.type, o.id, o.version ?? null]);
  return { indexe: true, morceaux: n, sansTexte: !textes };
}

/** Indexe les résultats d'une recherche M-Files (ex. « CBE 2025 »). */
async function indexerRechercheMfiles(tenantId, q, { limite = 100 } = {}) {
  const { resultats } = await mfiles.rechercher(tenantId, q, { limite });
  const bilan = { trouves: resultats.length, indexes: 0, deja: 0, sansTexte: 0, erreurs: 0 };
  for (const o of resultats) {
    try {
      const r = await indexerObjetMfiles(tenantId, o);
      if (!r.indexe) bilan.deja += 1; else { bilan.indexes += 1; if (r.sansTexte) bilan.sansTexte += 1; }
    } catch { bilan.erreurs += 1; }
  }
  return bilan;
}

/**
 * Passages les plus utiles pour une question.
 * @param {{ sources?: string[], k?: number }} options
 */
async function retrouver(tenantId, question, { sources = ['ged', 'mfiles'], k = 6 } = {}) {
  const q = String(question || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (q.length < 3) return [];
  const r = await db.query(
    `SELECT id, source, source_ref, titre, morceau, texte, vecteur,
            ts_rank_cd(to_tsvector('french', texte), websearch_to_tsquery('french', $2)) AS rang
       FROM rag_passages
      WHERE tenant_id = $1 AND source = ANY($3)
        AND to_tsvector('french', texte) @@ websearch_to_tsquery('french', $2)
      ORDER BY rang DESC LIMIT 80`,
    [tenantId, q, sources]
  );
  let candidats = r.rows;
  // Aucun mot commun (« OR » implicite) : on élargit à n'importe quel mot significatif.
  if (!candidats.length) {
    const mots = [...new Set(q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]{4,}/g) || [])].slice(0, 8);
    if (!mots.length) return [];
    candidats = (await db.query(
      `SELECT id, source, source_ref, titre, morceau, texte, vecteur,
              ts_rank_cd(to_tsvector('french', texte), to_tsquery('french', $2)) AS rang
         FROM rag_passages WHERE tenant_id = $1 AND source = ANY($3) AND to_tsvector('french', texte) @@ to_tsquery('french', $2)
        ORDER BY rang DESC LIMIT 80`,
      [tenantId, mots.join(' | '), sources]
    )).rows;
  }
  const vq = candidats.some((c) => c.vecteur) ? (await ia.vecteurs([q]).catch(() => null))?.[0] : null;
  const maxRang = Math.max(...candidats.map((c) => Number(c.rang)), 1e-9);
  const notes = candidats.map((c) => ({ ...c, note: Number(c.rang) / maxRang * (vq && c.vecteur ? 0.4 : 1) + (vq && c.vecteur ? 0.6 * cosinus(vq, c.vecteur) : 0) }));
  notes.sort((a, b) => b.note - a.note);
  // Deux morceaux au plus par document, pour varier les sources.
  const parDoc = new Map();
  const choix = [];
  for (const c of notes) {
    const cle = `${c.source}:${c.source_ref}`;
    if ((parDoc.get(cle) || 0) >= 2) continue;
    parDoc.set(cle, (parDoc.get(cle) || 0) + 1);
    choix.push({ source: c.source, ref: c.source_ref, titre: c.titre, texte: c.texte, note: Math.round(c.note * 100) / 100 });
    if (choix.length >= k) break;
  }
  return choix;
}

/** Lien de la source dans l'application ou dans M-Files. */
async function lienDe(tenantId, p) {
  if (p.source === 'ged') return `/documents/liste?doc=${p.ref}`;
  const c = await mfiles.config(tenantId);
  const [type, id] = p.ref.split('-');
  return c ? mfiles.lienWeb(c, type, id) : null;
}

/**
 * Réponse à une question sur le contenu des documents.
 * @returns {{ texte, sources: [{ n, titre, source, lien, extrait }] }|null}
 */
async function repondre(tenantId, question, { sources } = {}) {
  const passages = await retrouver(tenantId, question, { sources });
  if (!passages.length) return null;
  const refs = [];
  for (const p of passages) {
    if (!refs.some((r) => r.source === p.source && r.ref === p.ref)) refs.push({ source: p.source, ref: p.ref, titre: p.titre });
  }
  const numero = (p) => refs.findIndex((r) => r.source === p.source && r.ref === p.ref) + 1;
  const sourcesRendues = await Promise.all(refs.map(async (r, i) => ({
    n: i + 1, titre: r.titre || 'Document', source: r.source === 'ged' ? 'GED' : 'M-Files', lien: await lienDe(tenantId, r),
    extrait: passages.find((p) => p.source === r.source && p.ref === r.ref).texte.slice(0, 280),
  })));
  const redige = await ollama.rediger(tenantId, question, passages.map((p) => `(source ${numero(p)} — ${p.titre || 'document'}) ${p.texte}`)).catch(() => null);
  if (redige?.texte) return { texte: redige.texte, sources: sourcesRendues, redige: true };
  return {
    texte: `Voici ce que disent les documents :\n${passages.slice(0, 3).map((p) => `• « ${p.texte.slice(0, 260).trim()}${p.texte.length > 260 ? '…' : ''} » (source ${numero(p)})`).join('\n')}`,
    sources: sourcesRendues, redige: false,
  };
}

async function etat(tenantId) {
  const r = await db.query(
    `SELECT source, count(DISTINCT source_ref)::int AS documents, count(*)::int AS passages, count(vecteur)::int AS vectorises
       FROM rag_passages WHERE tenant_id = $1 GROUP BY source`, [tenantId]
  );
  return { sources: r.rows, ollama: await ollama.regle(tenantId).catch(() => false), vecteurs: ia.actif('recherche') };
}

// ---------------------------------------------------------------------------
// Tâche de fond : la GED toutes les 30 min ; les recherches M-Files réglées
// (mfiles_requetes_index, ex. « 2025; 2026 ») chaque nuit, vers 2 h.
// ---------------------------------------------------------------------------
let minuterie = null;
async function tour() {
  const tenants = (await db.query("SELECT id FROM tenants WHERE status = 'active'")).rows;
  const heure = new Date().getHours();
  for (const { id } of tenants) {
    try { await indexerGed(id); } catch (err) { console.error('[rag] GED :', err.message); }
    if (heure !== 2) continue;
    const s = await require('./settingsService').getAll(id).catch(() => ({}));
    const requetes = String(s.mfiles_requetes_index || '').split(/[;\n]+/).map((x) => x.trim()).filter((x) => x.length >= 2);
    if (!requetes.length || !(await mfiles.config(id))) continue;
    for (const q of requetes) {
      try { await indexerRechercheMfiles(id, q, { limite: 500 }); } catch (err) { console.error('[rag] M-Files :', err.message); }
    }
  }
}
function demarrer() {
  if (minuterie) return;
  minuterie = setInterval(() => tour().catch((err) => console.error('[rag]', err.message)), 30 * 60 * 1000);
  minuterie.unref?.();
  setTimeout(() => tour().catch(() => {}), 60 * 1000).unref?.();
}

module.exports = { decouper, enregistrer, indexerGed, indexerObjetMfiles, indexerRechercheMfiles, retrouver, repondre, etat, demarrer, texteDuFichier, erreur };
