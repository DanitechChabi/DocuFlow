// ============================================================================
// mfilesApiService — l'API REST de M-Files (M-Files Web Service, « MFWS »).
//
// Connexion : variables d'environnement du serveur uniquement (jamais en base,
// jamais dans un fichier versionné) :
//   MFILES_REST_URL    adresse de l'API, ex. https://mfiles.afgc.local/REST
//                      (à défaut : le réglage « Adresse de M-Files Web » + /REST)
//   MFILES_VAULT_GUID  coffre, ex. {C840BE1A-5B47-4AC0-8EF7-835C166C8E24}
//   MFILES_USERNAME    compte M-Files de service (lecture seule de préférence)
//   MFILES_PASSWORD    son mot de passe
//   MFILES_DOMAIN      facultatif : domaine Windows, si le compte en est un
//
// Appels utilisés (MFWS) :
//   POST /server/authenticationtokens            → { Value } (jeton de session)
//   GET  /objects?q=…&limit=…                    → recherche rapide (titre,
//                                                  propriétés, contenu indexé)
//   GET  /objects/{type}/{id}/latest/properties  → propriétés (valeurs affichées)
//   GET  /objects/{type}/{id}/latest/files       → fichiers de l'objet
//   GET  /objects/{type}/{id}/{version}/files/{fichier}/content → le fichier
// Le jeton est gardé en mémoire et redemandé après un 401.
// ============================================================================
const settingsService = require('./settingsService');

const DELAI = 20000;
const jetons = new Map(); // clé de connexion → { valeur, expire }

function erreur(statut, message) { const e = new Error(message); e.statut = statut; return e; }

/** Configuration : null si M-Files n'est pas raccordé. */
async function config(tenantId, env = process.env) {
  const s = tenantId ? await settingsService.getAll(tenantId).catch(() => ({})) : {};
  const web = String(s.mfiles_url || '').trim().replace(/\/+$/, '');
  const rest = String(env.MFILES_REST_URL || (web ? `${web}/REST` : '')).trim().replace(/\/+$/, '');
  const vault = String(env.MFILES_VAULT_GUID || '').trim();
  const utilisateur = String(env.MFILES_USERNAME || '').trim();
  if (!/^https?:\/\//i.test(rest) || !vault || !utilisateur || !env.MFILES_PASSWORD) return null;
  return { rest, web: web || rest.replace(/\/REST$/i, ''), vault: vault.startsWith('{') ? vault : `{${vault}}`, utilisateur, motDePasse: env.MFILES_PASSWORD, domaine: env.MFILES_DOMAIN || null };
}

async function http(url, { methode = 'GET', corps, entetes = {}, binaire = false, delai = DELAI } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), delai);
  try {
    const r = await fetch(url, {
      method: methode, signal: ctrl.signal,
      headers: { Accept: binaire ? '*/*' : 'application/json', ...(corps ? { 'Content-Type': 'application/json' } : {}), ...entetes },
      body: corps ? JSON.stringify(corps) : undefined,
    });
    if (!r.ok) {
      const texte = await r.text().catch(() => '');
      let message = texte.slice(0, 300);
      try { message = JSON.parse(texte).Message || message; } catch { /* texte brut */ }
      const e = erreur(r.status === 401 || r.status === 403 ? 502 : r.status === 404 ? 404 : 502, `M-Files : ${message || `erreur ${r.status}`}`);
      e.http = r.status;
      throw e;
    }
    if (binaire) return { buffer: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') || 'application/octet-stream' };
    const texte = await r.text();
    return texte ? JSON.parse(texte) : null;
  } catch (err) {
    if (err.name === 'AbortError') throw erreur(504, 'M-Files ne répond pas.');
    if (err.statut) throw err;
    throw erreur(502, `M-Files injoignable : ${err.cause?.code || err.message}`);
  } finally { clearTimeout(t); }
}

async function jeton(c, renouveler = false) {
  const cle = `${c.rest}|${c.vault}|${c.utilisateur}`;
  const j = jetons.get(cle);
  if (j && !renouveler && j.expire > Date.now()) return j.valeur;
  const r = await http(`${c.rest}/server/authenticationtokens`, {
    methode: 'POST',
    corps: { Username: c.utilisateur, Password: c.motDePasse, VaultGuid: c.vault, ...(c.domaine ? { Domain: c.domaine, WindowsUser: true } : {}) },
  });
  if (!r || !r.Value) throw erreur(502, 'M-Files : connexion refusée.');
  jetons.set(cle, { valeur: r.Value, expire: Date.now() + 50 * 60 * 1000 });
  return r.Value;
}

/** Appel authentifié ; un 401 redemande un jeton une fois. */
async function appel(c, chemin, options = {}) {
  try {
    return await http(`${c.rest}${chemin}`, { ...options, entetes: { 'X-Authentication': await jeton(c) } });
  } catch (err) {
    if (err.http !== 401) throw err;
    return http(`${c.rest}${chemin}`, { ...options, entetes: { 'X-Authentication': await jeton(c, true) } });
  }
}

async function exiger(tenantId) {
  const c = await config(tenantId);
  if (!c) throw erreur(503, 'M-Files n\'est pas raccordé : l\'administrateur du serveur doit renseigner MFILES_REST_URL, MFILES_VAULT_GUID, MFILES_USERNAME et MFILES_PASSWORD.');
  return c;
}

/** Lien pour ouvrir l'objet dans M-Files Web. */
function lienWeb(c, type, id) {
  return `${c.web}/vault/${encodeURIComponent(c.vault)}/show/${type}-${id}`;
}

/** Un objet de résultat MFWS (ObjectVersion) → forme courte de l'application. */
function objetCourt(c, o) {
  const ov = o.ObjVer || {};
  return {
    type: ov.Type, id: ov.ID, version: ov.Version,
    titre: o.Title || o.EscapedTitleWithID || `Objet ${ov.ID}`,
    classe: o.Class ?? null,
    modifie_le: o.LastModifiedUtc || o.LastModified || null,
    fichiers: (o.Files || []).map((f) => ({ id: f.ID, nom: `${f.Name || f.EscapedName || 'fichier'}${f.Extension ? `.${f.Extension}` : ''}`, extension: (f.Extension || '').toLowerCase(), taille: f.Size ?? null })),
    lien: lienWeb(c, ov.Type, ov.ID),
  };
}

/** État du raccordement (pour l'administrateur). */
async function etat(tenantId) {
  const c = await config(tenantId);
  if (!c) return { raccorde: false };
  try {
    await jeton(c);
    return { raccorde: true, joignable: true, adresse: c.rest, coffre: c.vault };
  } catch (err) {
    return { raccorde: true, joignable: false, adresse: c.rest, coffre: c.vault, erreur: err.message };
  }
}

/** Recherche rapide : la même que la barre de recherche de M-Files. */
async function rechercher(tenantId, q, { limite = 50 } = {}) {
  const texte = String(q || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (texte.length < 2) throw erreur(400, 'Tapez au moins deux caractères.');
  const c = await exiger(tenantId);
  const r = await appel(c, `/objects?q=${encodeURIComponent(texte)}&limit=${Math.min(Math.max(Number(limite) || 50, 1), 500)}`);
  const items = Array.isArray(r) ? r : r?.Items || [];
  return { resultats: items.map((o) => objetCourt(c, o)), plus: Boolean(r?.MoreResults) };
}

/** Propriétés affichables d'un objet : [{ nom, valeur }]. */
async function proprietes(tenantId, type, id) {
  const c = await exiger(tenantId);
  const r = await appel(c, `/objects/${Number(type)}/${Number(id)}/latest/properties?forDisplay=true`);
  return (r || []).map((p) => ({
    id: p.PropertyDef, nom: p.PropertyDefName || p.Name || `Propriété ${p.PropertyDef}`,
    valeur: p.TypedValue?.DisplayValue ?? p.TypedValue?.Value ?? null,
  })).filter((p) => p.valeur !== null && p.valeur !== '');
}

async function fichiers(tenantId, type, id) {
  const c = await exiger(tenantId);
  const r = await appel(c, `/objects/${Number(type)}/${Number(id)}/latest/files`);
  return (r || []).map((f) => ({ id: f.ID, version: f.Version, nom: `${f.Name || 'fichier'}${f.Extension ? `.${f.Extension}` : ''}`, extension: (f.Extension || '').toLowerCase(), taille: f.Size ?? null }));
}

/** Le contenu d'un fichier (dernière version de l'objet). */
async function contenu(tenantId, type, id, fichierId) {
  const c = await exiger(tenantId);
  return appel(c, `/objects/${Number(type)}/${Number(id)}/latest/files/${Number(fichierId)}/content`, { binaire: true, delai: 60000 });
}

/** Fiche d'un objet : propriétés et fichiers. */
async function objet(tenantId, type, id) {
  const c = await exiger(tenantId);
  const [props, fich] = await Promise.all([proprietes(tenantId, type, id), fichiers(tenantId, type, id)]);
  const titre = props.find((p) => p.id === 0)?.valeur || `Objet ${id}`;
  const classe = props.find((p) => p.id === 100)?.valeur || null;
  return { type: Number(type), id: Number(id), titre, classe, proprietes: props, fichiers: fich, lien: lienWeb(c, type, id) };
}

module.exports = { config, etat, rechercher, objet, proprietes, fichiers, contenu, lienWeb, objetCourt, _jetons: jetons };
