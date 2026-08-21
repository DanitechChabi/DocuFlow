const db = require('../config/db');
const path = require('path');
const fs = require('fs');
const { UPLOADS_DIR } = require('../config/paths');
const catalog = require('../config/settingsCatalog');
const settingsService = require('../services/settingsService');
const tenantProvisioningService = require('../services/tenantProvisioningService');
const { uploadUrl } = require('../helpers/publicUrl');
const requestOptions = require('../helpers/requestOptions');

/**
 * settingsController — configuration intégrale d'une organisation.
 *
 * L'ancienne version n'acceptait en écriture que 7 clés codées en dur
 * (site_name, site_description et 5 couleurs) et écrivait toute chaîne reçue
 * sans validation. Le superadministrateur ne pouvait donc configurer presque
 * rien, et une valeur aberrante entrait en base sans contrôle.
 *
 * Désormais la whitelist et le typage viennent de config/settingsCatalog.js :
 * ajouter un paramètre au catalogue le rend immédiatement configurable, validé
 * et documenté, sans toucher à ce contrôleur.
 */

// Clés de type 'image' du catalogue (logo, favicon, fond de connexion).
// Déclaré ici car withImageUrls() s'en sert dès la première réponse servie.
const IMAGE_KEYS = catalog.CATALOG.filter((d) => d.type === 'image').map((d) => d.key);

/**
 * Ajoute une URL (`<clé>_url`) pour chaque réglage de type image.
 *
 * Le frontend ne peut pas reconstruire ces URLs : le nom de fichier stocké est
 * relatif au dossier d'uploads du serveur. Absolue en mode hébergé, relative en
 * mode bureau — la règle et son pourquoi sont dans helpers/publicUrl.js.
 */
function withImageUrls(settings, req) {
  const out = { ...settings };
  for (const key of IMAGE_KEYS) {
    out[`${key}_url`] = uploadUrl(req, out[key]);
  }
  return out;
}

/** Lit les réglages d'un tenant, complétés par les valeurs par défaut du catalogue. */
async function loadSettings(tenantId) {
  let result;
  try {
    result = await db.query('SELECT key, value FROM settings WHERE tenant_id = $1', [tenantId]);
  } catch (err) {
    if (err.code === '42703') {
      // Colonne tenant_id absente → base mono-tenant antérieure à la migration 001
      result = await db.query('SELECT key, value FROM settings');
    } else {
      throw err;
    }
  }

  // Les valeurs par défaut garantissent que l'interface n'a jamais de trou,
  // même si le provisionnement n'a pas encore eu lieu pour cette organisation.
  const settings = { ...catalog.defaults() };
  for (const row of result.rows) {
    if (row.value !== null) settings[row.key] = row.value;
  }
  return settings;
}

exports.getSettings = async (req, res) => {
  const tenantId = req.user?.tenant_id || 1;
  try {
    const settings = await loadSettings(tenantId);
    res.json(withImageUrls(settings, req));
  } catch (err) {
    console.error('[settings] getSettings :', err.message);
    res.status(500).json({ message: 'Erreur lors du chargement des paramètres' });
  }
};

/**
 * Catalogue complet + valeurs courantes, structuré par onglet.
 * C'est la source de la console de configuration : l'interface se construit
 * depuis cette réponse, sans dupliquer la liste des paramètres côté frontend.
 */
exports.getConfiguration = async (req, res) => {
  const tenantId = req.user?.tenant_id || 1;
  try {
    const stored = await loadSettings(tenantId);

    const groups = catalog.GROUPS.map((group) => ({
      ...group,
      settings: catalog.CATALOG
        .filter((d) => d.group === group.name)
        .map((d) => ({
          key: d.key,
          label: d.label,
          description: d.description || null,
          type: d.type,
          // Contrôle de saisie spécialisé, quand le type de stockage ne suffit
          // pas à le déduire (une liste de choix est du JSON, mais ne doit pas
          // être saisie comme du JSON). `null` = contrôle déduit du type.
          editor: d.editor || null,
          withTone: d.withTone === true,
          // Le réglage tire ses choix d'une autre liste (voir `optionsFrom` dans
          // le catalogue). La console la lit dans le formulaire vivant, et non
          // dans les valeurs stockées : l'administrateur qui ajoute un niveau de
          // priorité doit pouvoir le choisir comme défaut avant d'enregistrer.
          optionsFrom: d.optionsFrom || null,
          options: d.options || [],
          min: d.min ?? null,
          max: d.max ?? null,
          editable: d.editable !== false,
          defaultValue: d.default ?? null,
          value: catalog.parseValue(d, stored[d.key] ?? null),
        })),
    })).filter((group) => group.settings.length > 0);

    // Les tons de priorité forment une liste fermée côté serveur (les classes
    // Tailwind correspondantes sont compilées à la construction du frontend).
    // Les livrer ici évite que la console en tienne sa propre copie, qui
    // dériverait au premier ton ajouté.
    res.json({ groups, values: withImageUrls(stored, req), tones: requestOptions.TONES });
  } catch (err) {
    console.error('[settings] getConfiguration :', err.message);
    res.status(500).json({ message: 'Erreur lors du chargement de la configuration' });
  }
};

/**
 * Vérifie les réglages qui en désignent un autre (`optionsFrom` du catalogue).
 *
 * Le contrôle porte sur l'état RÉSULTANT — valeurs stockées écrasées par les
 * modifications en cours — et non sur le corps de la requête seul : la console
 * n'envoie que les champs modifiés, si bien qu'une requête ne contient
 * généralement qu'un des deux côtés de la paire. Vider la liste des priorités et
 * ne rien dire de la priorité par défaut doit être refusé tout autant que
 * l'inverse.
 *
 * @param {number} tenantId organisation concernée
 * @param {Array<{key: string, value: string|null}>} updates modifications validées
 * @returns {Promise<Array<{key: string, reason: string}>>} incohérences relevées
 */
async function checkCrossKeys(tenantId, updates) {
  const dependants = catalog.CATALOG.filter((d) => d.optionsFrom);
  if (!dependants.length) return [];

  // Rien à vérifier si la requête ne touche ni un réglage dépendant ni la liste
  // dont il dépend : inutile de relire les réglages à chaque enregistrement.
  const touched = new Set(updates.map((u) => u.key));
  const concerned = dependants.filter((d) => touched.has(d.key) || touched.has(d.optionsFrom));
  if (!concerned.length) return [];

  const stored = await loadSettings(tenantId);
  // `null` = suppression de la ligne : la valeur par défaut du catalogue
  // reprend effet, c'est donc elle qu'il faut confronter et non une valeur vide.
  const resulting = { ...stored };
  for (const { key, value } of updates) {
    resulting[key] = value === null ? (catalog.BY_KEY.get(key)?.default ?? null) : value;
  }

  const problems = [];
  for (const definition of concerned) {
    const source = catalog.BY_KEY.get(definition.optionsFrom);
    if (!source) continue;
    const options = requestOptions.normalizeOptions(
      resulting[definition.optionsFrom],
      source.default,
      { withTone: source.withTone === true }
    );
    const wanted = String(resulting[definition.key] ?? '').trim();
    if (!wanted) continue;
    if (!requestOptions.allowedValues(options).includes(wanted)) {
      problems.push({
        key: definition.key,
        reason: `${definition.label} (« ${wanted} ») ne correspond à aucune entrée de « ${source.label} ».`,
      });
    }
  }
  return problems;
}

exports.updateSettings = async (req, res) => {
  const tenantId = req.user.tenant_id;

  // Validation complète AVANT toute écriture : une requête partiellement
  // appliquée laisserait la configuration dans un état incohérent.
  const updates = [];
  const rejected = [];
  for (const [key, rawValue] of Object.entries(req.body || {})) {
    const definition = catalog.BY_KEY.get(key);
    if (!definition) {
      rejected.push({ key, reason: 'Paramètre inconnu.' });
      continue;
    }
    if (definition.editable === false) {
      rejected.push({ key, reason: `${definition.label} est déterminé par la configuration serveur.` });
      continue;
    }
    try {
      updates.push({ key, value: catalog.coerce(definition, rawValue) });
    } catch (err) {
      rejected.push({ key, reason: err.message });
    }
  }

  if (rejected.length) {
    return res.status(400).json({
      message: `Configuration refusée : ${rejected.map((r) => r.reason).join(' ')}`,
      rejected,
    });
  }
  if (!updates.length) {
    return res.status(400).json({ message: 'Aucun paramètre à mettre à jour.' });
  }

  // Cohérence ENTRE réglages — impossible à vérifier clé par clé.
  //
  // `request_default_priority` nomme une entrée de `request_priorities`. Les deux
  // sont valides isolément, et pourtant supprimer le niveau qui sert de défaut
  // laisse le formulaire retomber sur le premier de la liste : le réglage
  // semble ignoré, sans que rien ne l'ait signalé. Le contrôle a lieu sur l'état
  // RÉSULTANT (stocké + modifications), car une requête ne porte souvent qu'un
  // seul côté de la paire.
  try {
    const incoherences = await checkCrossKeys(tenantId, updates);
    if (incoherences.length) {
      return res.status(400).json({
        message: `Configuration refusée : ${incoherences.map((r) => r.reason).join(' ')}`,
        rejected: incoherences,
      });
    }
  } catch (err) {
    console.error('[settings] checkCrossKeys :', err.message);
    return res.status(500).json({ message: 'Erreur lors de la vérification de la configuration' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    for (const { key, value } of updates) {
      if (value === null) {
        // Valeur vidée → on retire la ligne : la valeur par défaut du catalogue
        // reprend effet à la lecture.
        await client.query('DELETE FROM settings WHERE tenant_id = $1 AND key = $2', [tenantId, key]);
        continue;
      }
      await client.query(
        `INSERT INTO settings (tenant_id, key, value)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [tenantId, key, value]
      );
    }
    await client.query('COMMIT');

    // Les réglages sont mis en cache pour les chemins chauds (connexion,
    // téléversement) : sans invalidation, la modification ne prendrait effet
    // qu'à l'expiration du cache.
    settingsService.invalidate(tenantId);

    const settings = await loadSettings(tenantId);
    res.json({
      message: `${updates.length} paramètre(s) mis à jour`,
      updated: updates.map((u) => u.key),
      settings: withImageUrls(settings, req),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[settings] updateSettings :', err.message);
    res.status(500).json({ message: 'Erreur lors de la mise à jour' });
  } finally {
    client.release();
  }
};

/**
 * Réinitialise un groupe de paramètres (ou la totalité) aux valeurs d'origine.
 */
exports.resetSettings = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { group } = req.body || {};

  const targets = catalog.CATALOG
    .filter((d) => d.editable !== false && (!group || d.group === group));

  if (group && !targets.length) {
    return res.status(400).json({ message: `Groupe de paramètres inconnu : ${group}` });
  }

  try {
    await db.query('DELETE FROM settings WHERE tenant_id = $1 AND key = ANY($2::text[])', [
      tenantId,
      targets.map((d) => d.key),
    ]);
    settingsService.invalidate(tenantId);
    const settings = await loadSettings(tenantId);
    res.json({
      message: group ? `Paramètres « ${group} » réinitialisés` : 'Configuration réinitialisée',
      settings: withImageUrls(settings, req),
    });
  } catch (err) {
    console.error('[settings] resetSettings :', err.message);
    res.status(500).json({ message: 'Erreur lors de la réinitialisation' });
  }
};

/**
 * (Re)provisionne l'organisation : recrée ce qui manque (schéma de métadonnées,
 * dossiers, vues dynamiques, politique de rétention, zone de stockage, groupes,
 * sections). Idempotent — ne touche pas à l'existant.
 */
exports.provisionDefaults = async (req, res) => {
  const tenantId = req.user.tenant_id;
  try {
    const report = await tenantProvisioningService.provisionTenant(tenantId);
    res.json({
      message: 'Provisionnement effectué',
      done: report.done,
      skipped: report.skipped,
      failed: report.failed,
    });
  } catch (err) {
    console.error('[settings] provisionDefaults :', err.message);
    res.status(500).json({ message: 'Erreur lors du provisionnement' });
  }
};

// Types MIME autorisés pour les logos
const ALLOWED_LOGO_MIMES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/svg+xml'];
const MAX_LOGO_SIZE = 5 * 1024 * 1024; // 5 Mo

exports.uploadLogo = async (req, res) => {
  const tenantId = req.user.tenant_id;
  // `key` permet de téléverser le favicon ou le fond de connexion par la même
  // route. Lu depuis la query en priorité : multer ne peuple `req.body` qu'avec
  // les champs texte qui PRÉCÈDENT le fichier dans le corps multipart, ce que
  // l'ordre d'un FormData ne garantit pas.
  const requestedKey = req.query?.key || req.body?.key;
  const key = IMAGE_KEYS.includes(requestedKey) ? requestedKey : 'site_logo';

  const discardUpload = () => {
    if (!req.file) return;
    const filePath = path.join(UPLOADS_DIR, req.file.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  };

  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Aucun fichier fourni' });
    }
    if (!ALLOWED_LOGO_MIMES.includes(req.file.mimetype)) {
      discardUpload();
      return res.status(400).json({ message: 'Type de fichier non autorisé. Formats acceptés : PNG, JPG, GIF, WebP, SVG' });
    }
    if (req.file.size > MAX_LOGO_SIZE) {
      discardUpload();
      return res.status(400).json({ message: 'Le fichier est trop volumineux. Taille maximum : 5 Mo' });
    }

    const filename = req.file.filename;

    // Supprimer l'ancien fichier s'il était stocké localement
    try {
      const old = await db.query('SELECT value FROM settings WHERE tenant_id = $1 AND key = $2', [tenantId, key]);
      const previous = old.rows[0]?.value;
      if (previous && previous !== filename && !previous.startsWith('http')) {
        const oldPath = path.join(UPLOADS_DIR, previous);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
    } catch (err) {
      if (err.code !== '42703') throw err;
    }

    await db.query(
      `INSERT INTO settings (tenant_id, key, value)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
      [tenantId, key, filename]
    );
    settingsService.invalidate(tenantId);

    res.json({ message: 'Image mise à jour', key, filename, url: uploadUrl(req, filename) });
  } catch (err) {
    discardUpload();
    console.error('[settings] uploadLogo :', err.message);
    res.status(500).json({ message: "Erreur lors de l'upload de l'image" });
  }
};
