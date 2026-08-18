/**
 * settingsService — lecture des réglages effectifs d'une organisation.
 *
 * Sans ce service, les paramètres de la console de configuration seraient
 * décoratifs : la durée de session était figée à '30d' dans authController, la
 * taille maximale d'upload à 10 Mo dans helpers/upload.js, la longueur minimale
 * du mot de passe à 6 caractères en dur. Le superadministrateur pouvait changer
 * la valeur affichée sans qu'elle ait le moindre effet.
 *
 * Un cache mémoire court évite une requête par appel sur des chemins chauds
 * (chaque téléversement, chaque connexion). Il est invalidé explicitement à
 * l'écriture des réglages.
 */
const db = require('../config/db');
const catalog = require('../config/settingsCatalog');

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map(); // tenantId -> { values, expiresAt }

/** Vide le cache d'un tenant (ou de tous) après une mise à jour. */
function invalidate(tenantId = null) {
  if (tenantId === null) cache.clear();
  else cache.delete(Number(tenantId));
}

/**
 * Réglages effectifs d'un tenant, typés selon le catalogue.
 * Les valeurs par défaut comblent tout réglage absent : la lecture ne peut donc
 * jamais renvoyer `undefined` pour une clé du catalogue.
 */
async function getAll(tenantId) {
  const id = Number(tenantId) || 1;
  const cached = cache.get(id);
  if (cached && cached.expiresAt > Date.now()) return cached.values;

  const values = {};
  for (const definition of catalog.CATALOG) {
    values[definition.key] = catalog.parseValue(definition, definition.default ?? null);
  }

  try {
    const result = await db.query('SELECT key, value FROM settings WHERE tenant_id = $1', [id]);
    for (const row of result.rows) {
      const definition = catalog.BY_KEY.get(row.key);
      if (definition) values[row.key] = catalog.parseValue(definition, row.value);
      else values[row.key] = row.value; // clé héritée hors catalogue : conservée telle quelle
    }
  } catch (err) {
    // Base non migrée ou indisponible : on retombe sur les valeurs par défaut
    // plutôt que de faire échouer l'action métier appelante.
    if (err.code !== '42P01' && err.code !== '42703') {
      console.warn('[settings] lecture impossible, valeurs par défaut utilisées :', err.message);
    }
  }

  cache.set(id, { values, expiresAt: Date.now() + CACHE_TTL_MS });
  return values;
}

/** Valeur d'un réglage, typée. `fallback` sert si la clé est hors catalogue. */
async function get(tenantId, key, fallback = null) {
  const values = await getAll(tenantId);
  const value = values[key];
  return value === undefined || value === null ? fallback : value;
}

/** Durée de validité du jeton JWT, au format accepté par jsonwebtoken. */
async function getSessionDuration(tenantId) {
  const days = await get(tenantId, 'session_duration_days', 30);
  const safe = Number.isFinite(days) && days >= 1 && days <= 365 ? Math.floor(days) : 30;
  return `${safe}d`;
}

/** Taille maximale d'un téléversement, en octets. */
async function getMaxUploadBytes(tenantId) {
  const mb = await get(tenantId, 'max_upload_size_mb', 50);
  const safe = Number.isFinite(mb) && mb >= 1 && mb <= 500 ? mb : 50;
  return safe * 1024 * 1024;
}

/**
 * Contraintes de mot de passe, avec le message d'erreur associé.
 * @returns {Promise<{minLength: number, requireSymbols: boolean, validate: function}>}
 */
async function getPasswordPolicy(tenantId) {
  const minLengthRaw = await get(tenantId, 'password_min_length', 8);
  const minLength = Number.isFinite(minLengthRaw) && minLengthRaw >= 6 ? Math.floor(minLengthRaw) : 8;
  const requireSymbols = (await get(tenantId, 'password_require_symbols', false)) === true;

  return {
    minLength,
    requireSymbols,
    /** @returns {string|null} message d'erreur, ou null si le mot de passe convient */
    validate(password) {
      const value = String(password || '');
      if (value.length < minLength) {
        return `Le mot de passe doit contenir au moins ${minLength} caractères`;
      }
      if (requireSymbols && !/[^A-Za-z0-9]/.test(value)) {
        return 'Le mot de passe doit contenir au moins un caractère spécial';
      }
      return null;
    },
  };
}

/**
 * Rôles autorisés à accéder à la GED, selon le réglage `ged_access_role`.
 * `superadmin` court-circuite déjà roleMiddleware ; il n'est pas listé ici.
 */
async function getGedRoles(tenantId) {
  const mode = await get(tenantId, 'ged_access_role', 'archiviste');
  if (mode === 'all') return ['archiviste', 'admin', 'demandeur'];
  if (mode === 'admin') return ['archiviste', 'admin'];
  return ['archiviste'];
}

module.exports = {
  getAll,
  get,
  invalidate,
  getSessionDuration,
  getMaxUploadBytes,
  getPasswordPolicy,
  getGedRoles,
};
