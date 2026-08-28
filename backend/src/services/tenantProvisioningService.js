/**
 * tenantProvisioningService — installation complète d'une organisation.
 *
 * Problème résolu : `registerCompany` ne créait que 2 réglages et les sections.
 * Aucun schéma de métadonnées, aucun dossier, aucune vue dynamique, aucune
 * politique de rétention. L'éditeur de schéma était donc vide *par construction*
 * pour toute nouvelle entreprise, et le superadministrateur n'avait rien à
 * configurer. Ce service provisionne une installation complète et cohérente.
 *
 * Contrats respectés :
 *   - idempotent : rejouable sans doublon (rattrapage des tenants existants) ;
 *   - tolérant au schéma : chaque bloc est indépendant, une table absente
 *     (migrations 010/011 non encore appliquées) est signalée sans faire échouer
 *     l'inscription — sinon un client ne pourrait pas s'inscrire du tout ;
 *   - transactionnel si un client est fourni : le provisionnement participe à la
 *     transaction d'inscription.
 */
const db = require('../config/db');
const catalog = require('../config/settingsCatalog');

/** Codes PostgreSQL signalant un objet de schéma absent (migration non appliquée). */
const MISSING_SCHEMA_CODES = new Set([
  '42P01', // undefined_table
  '42703', // undefined_column
  '42883', // undefined_function
  '42P10', // invalid_column_reference (ON CONFLICT sans contrainte correspondante)
]);

const DEFAULT_SCHEMA_NAME = 'Document standard';

/** Champs de métadonnées livrés d'origine — modifiables ensuite par glisser-déposer. */
const DEFAULT_FIELDS = [
  { name: 'document_type', label: 'Type de document', type: 'select', required: true, options: [
    { value: 'contrat', label: 'Contrat' },
    { value: 'facture', label: 'Facture' },
    { value: 'acte', label: 'Acte' },
    { value: 'rapport', label: 'Rapport' },
    { value: 'courrier', label: 'Courrier' },
    { value: 'autre', label: 'Autre' },
  ] },
  { name: 'confidentiality', label: 'Niveau de confidentialité', type: 'select', required: true, options: [
    { value: 'public', label: 'Public' },
    { value: 'interne', label: 'Interne' },
    { value: 'confidentiel', label: 'Confidentiel' },
    { value: 'secret', label: 'Secret' },
  ] },
  { name: 'effective_date',  label: "Date d'effet",           type: 'date',    required: false, options: [] },
  { name: 'expiration_date', label: "Date d'expiration",      type: 'date',    required: false, options: [] },
  { name: 'owner_service',   label: 'Service propriétaire',   type: 'text',    required: false, options: [] },
  { name: 'responsible',     label: 'Responsable du document', type: 'user',   required: false, options: [] },
  { name: 'is_signed',       label: 'Document signé',         type: 'boolean', required: false, options: [] },
];

const DEFAULT_FOLDERS = ['Contrats', 'Factures', 'Actes', 'Rapports', 'Courriers', 'Archives'];

const DEFAULT_VIEWS = [
  { name: 'Par type de document', description: 'Regroupe les documents selon leur type', field: 'type_document' },
  { name: 'Par année',            description: 'Regroupe les documents par millésime',   field: 'annee' },
  { name: 'Par statut',           description: "Suit l'avancement du cycle de vie",      field: 'statut' },
  { name: 'Par entreprise',       description: 'Regroupe les documents par entreprise',  field: 'nom_entreprise' },
  { name: 'Par auteur',           description: 'Regroupe les documents par auteur',      field: 'auteur' },
];

const DEFAULT_GROUPS = [
  { name: 'Administrateurs', description: "Accès complet à la configuration de l'organisation" },
  { name: 'Archivistes',     description: 'Gestion de la bibliothèque documentaire' },
  { name: 'Demandeurs',      description: 'Dépôt et suivi des demandes' },
];

// Sections livrées d'origine. Liste historique de l'application (directions
// métier AFGC) : la conserver évite de régresser sur les organisations
// existantes, où ces sections sont référencées par les demandes.
// La migration 013 (provision_tenant_defaults) livre la même liste : les deux
// chemins de provisionnement doivent rester alignés.
const DEFAULT_SECTIONS = ['Comptabilité', 'Commercial', 'DAI', 'DRI', 'DGI', 'DNCMP'];

/**
 * Provisionne une organisation.
 *
 * @param {number} tenantId
 * @param {object} opts
 * @param {object} [opts.client]      client pg d'une transaction en cours
 * @param {string} [opts.companyName] nom repris comme `site_name`
 * @param {number} [opts.ownerId]     auteur des objets créés
 * @returns {Promise<{done: string[], skipped: object[], failed: object[]}>}
 */
async function provisionTenant(tenantId, { client = null, companyName = null, ownerId = null } = {}) {
  const runner = client || db;
  const transactional = !!client;
  const report = { tenantId, done: [], skipped: [], failed: [] };

  const query = (sql, params) => runner.query(sql, params);

  /**
   * Exécute une étape en isolant les erreurs de schéma manquant.
   * `SAVEPOINT` est indispensable : dans une transaction PostgreSQL, la moindre
   * erreur invalide la transaction entière. Sans point de reprise, une table
   * absente ferait échouer l'inscription elle-même.
   */
  async function step(label, fn) {
    const savepoint = `sp_${label}`;
    if (transactional) await query(`SAVEPOINT ${savepoint}`);
    try {
      const value = await fn();
      if (transactional) await query(`RELEASE SAVEPOINT ${savepoint}`);
      report.done.push(label);
      return value;
    } catch (err) {
      if (transactional) await query(`ROLLBACK TO SAVEPOINT ${savepoint}`).catch(() => {});
      if (MISSING_SCHEMA_CODES.has(err.code)) {
        report.skipped.push({ step: label, reason: `objet de schéma absent (${err.code})` });
        return null;
      }
      report.failed.push({ step: label, reason: err.message });
      return null;
    }
  }

  let resolvedOwnerId = ownerId;
  if (!resolvedOwnerId) {
    try {
      const res = await query(
        `SELECT id FROM users WHERE tenant_id = $1 AND role = 'superadmin' ORDER BY id ASC LIMIT 1`,
        [tenantId]
      );
      resolvedOwnerId = res.rows[0]?.id ?? null;
    } catch {
      resolvedOwnerId = null;
    }
  }

  let resolvedName = companyName;
  if (!resolvedName) {
    try {
      const res = await query('SELECT name FROM tenants WHERE id = $1', [tenantId]);
      resolvedName = res.rows[0]?.name ?? null;
    } catch {
      resolvedName = null;
    }
  }

  // ---------------------------------------------------------------- 1. Réglages
  await step('settings', async () => {
    const defaults = catalog.defaults();
    if (resolvedName) defaults.site_name = resolvedName;
    const keys = Object.keys(defaults);
    // Insertion en un seul aller-retour via UNNEST (et non N requêtes).
    await query(
      `INSERT INTO settings (tenant_id, key, value)
       SELECT $1, k, v FROM UNNEST($2::text[], $3::text[]) AS t(k, v)
       ON CONFLICT (tenant_id, key) DO NOTHING`,
      [tenantId, keys, keys.map((k) => defaults[k])]
    );
  });

  // ------------------------------------------------- 2. Schéma de métadonnées
  const schemaId = await step('metadata_schema', async () => {
    await query(
      `INSERT INTO metadata_schemas (tenant_id, name, description, is_default)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (tenant_id, name) DO NOTHING`,
      [tenantId, DEFAULT_SCHEMA_NAME, "Schéma de classification par défaut de l'organisation"]
    );
    const res = await query(
      `SELECT id FROM metadata_schemas
       WHERE tenant_id = $1 AND (is_default = TRUE OR name = $2)
       ORDER BY is_default DESC, id ASC LIMIT 1`,
      [tenantId, DEFAULT_SCHEMA_NAME]
    );
    return res.rows[0]?.id ?? null;
  });

  // ------------------------------------------------------ 3. Champs du schéma
  if (schemaId) {
    await step('metadata_fields', async () => {
      await query(
        `INSERT INTO metadata_fields (schema_id, name, label, type, required, display_order, options_json)
         SELECT $1, f.name, f.label, f.type, f.required, f.ord, f.options::jsonb
         FROM UNNEST($2::text[], $3::text[], $4::text[], $5::boolean[], $6::int[], $7::text[])
              AS f(name, label, type, required, ord, options)
         ON CONFLICT (schema_id, name) DO NOTHING`,
        [
          schemaId,
          DEFAULT_FIELDS.map((f) => f.name),
          DEFAULT_FIELDS.map((f) => f.label),
          DEFAULT_FIELDS.map((f) => f.type),
          DEFAULT_FIELDS.map((f) => f.required),
          DEFAULT_FIELDS.map((_, i) => i + 1),
          DEFAULT_FIELDS.map((f) => JSON.stringify(f.options || [])),
        ]
      );
    });
  }

  // ------------------------------------------------------------- 4. Dossiers
  // `document_folders` n'a pas de contrainte UNIQUE(tenant_id, name) : on filtre
  // explicitement les noms déjà présents plutôt que d'utiliser ON CONFLICT.
  await step('document_folders', async () => {
    await query(
      `INSERT INTO document_folders (tenant_id, name, created_by)
       SELECT $1, t.n, $3 FROM UNNEST($2::text[]) AS t(n)
       WHERE NOT EXISTS (
         SELECT 1 FROM document_folders d WHERE d.tenant_id = $1 AND d.name = t.n
       )`,
      [tenantId, DEFAULT_FOLDERS, resolvedOwnerId]
    );
  });

  // ------------------------------------------------------- 5. Vues dynamiques
  await step('dynamic_views', async () => {
    await query(
      `INSERT INTO dynamic_views (tenant_id, name, description, group_by_field, created_by)
       SELECT $1, v.name, v.description, v.field, $5
       FROM UNNEST($2::text[], $3::text[], $4::text[]) AS v(name, description, field)
       WHERE NOT EXISTS (
         SELECT 1 FROM dynamic_views dv WHERE dv.tenant_id = $1 AND dv.name = v.name
       )`,
      [
        tenantId,
        DEFAULT_VIEWS.map((v) => v.name),
        DEFAULT_VIEWS.map((v) => v.description),
        DEFAULT_VIEWS.map((v) => v.field),
        resolvedOwnerId,
      ]
    );
  });

  // -------------------------------------------------- 6. Politique de rétention
  await step('retention_policy', async () => {
    await query(
      `INSERT INTO retention_policies (tenant_id, name, description, retention_years, action_on_expiry, notify_before_days)
       VALUES ($1, 'Conservation standard', 'Durée de conservation légale par défaut (5 ans)', 5, 'archive', 30)
       ON CONFLICT (tenant_id, name) DO NOTHING`,
      [tenantId]
    );
  });

  // ------------------------------------------------------ 7. Zone de stockage
  await step('storage_zone', async () => {
    await query(
      `INSERT INTO storage_zones (tenant_id, name, type, is_default)
       VALUES ($1, 'Stockage principal', 'local', TRUE)
       ON CONFLICT (tenant_id, name) DO NOTHING`,
      [tenantId]
    );
  });

  // ---------------------------------------------------------------- 8. Groupes
  await step('groups', async () => {
    await query(
      `INSERT INTO groups (tenant_id, name, description)
       SELECT $1, g.name, g.description
       FROM UNNEST($2::text[], $3::text[]) AS g(name, description)
       ON CONFLICT (tenant_id, name) DO NOTHING`,
      [tenantId, DEFAULT_GROUPS.map((g) => g.name), DEFAULT_GROUPS.map((g) => g.description)]
    );
  });

  // -------------------------------------------------------- 8bis. Rôles RBAC
  // Les 7 rôles système, dont les ensembles de permissions (config/permissions.js
  // fait foi — la migration 019 livre la même liste). Idempotent : les clés
  // existantes ne sont pas touchées, donc le rattrapage des organisations
  // existantes ne modifie rien.
  await step('roles', async () => {
    const { ROLES_SYSTEME } = require('../config/permissions');
    for (const role of ROLES_SYSTEME) {
      await query(
        `INSERT INTO roles (tenant_id, key, name, description, is_system, permissions)
         VALUES ($1, $2, $3, $4, TRUE, $5)
         ON CONFLICT (tenant_id, key) DO NOTHING`,
        [tenantId, role.key, role.name, role.description, role.permissions]
      );
    }
  });

  // --------------------------------------------------------------- 9. Sections
  // Seulement si l'organisation n'en a aucune. `users.section` stocke le NOM de
  // la section en texte et non une clé étrangère : compléter la liste d'une
  // organisation qui a déjà la sienne y ferait coexister deux taxonomies, dont
  // une seule serait référencée par les comptes en place. Au rattrapage
  // (provisionAllTenants), les organisations existantes sont donc laissées
  // intactes sur ce point.
  await step('sections', async () => {
    const existing = await query(
      'SELECT 1 FROM sections WHERE tenant_id = $1 LIMIT 1',
      [tenantId]
    );
    if (existing.rowCount > 0) return;
    await query(
      `INSERT INTO sections (tenant_id, name)
       SELECT $1, t.n FROM UNNEST($2::text[]) AS t(n)
       WHERE NOT EXISTS (
         SELECT 1 FROM sections s WHERE s.tenant_id = $1 AND s.name = t.n
       )`,
      [tenantId, DEFAULT_SECTIONS]
    );
  });

  return report;
}

/**
 * Synchronise le catalogue JS vers `setting_definitions`.
 * Appelée au démarrage du serveur : la base reflète alors toujours le code, et
 * l'interface de configuration peut se construire depuis la base seule.
 */
async function syncSettingDefinitions() {
  try {
    await db.query(
      `INSERT INTO setting_definitions (key, group_name, label, description, value_type, default_value, options_json, display_order, is_editable)
       SELECT d.key, d.group_name, d.label, d.description, d.value_type, d.default_value, d.options::jsonb, d.ord, d.editable
       FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::int[], $9::boolean[])
            AS d(key, group_name, label, description, value_type, default_value, options, ord, editable)
       ON CONFLICT (key) DO UPDATE SET
         group_name    = EXCLUDED.group_name,
         label         = EXCLUDED.label,
         description   = EXCLUDED.description,
         value_type    = EXCLUDED.value_type,
         default_value = EXCLUDED.default_value,
         options_json  = EXCLUDED.options_json,
         display_order = EXCLUDED.display_order,
         is_editable   = EXCLUDED.is_editable`,
      [
        catalog.CATALOG.map((d) => d.key),
        catalog.CATALOG.map((d) => d.group),
        catalog.CATALOG.map((d) => d.label),
        catalog.CATALOG.map((d) => d.description || null),
        catalog.CATALOG.map((d) => d.type),
        catalog.CATALOG.map((d) => (d.default === undefined ? null : d.default)),
        catalog.CATALOG.map((d) => JSON.stringify(d.options || [])),
        catalog.CATALOG.map((_, i) => i + 1),
        catalog.CATALOG.map((d) => d.editable !== false),
      ]
    );
    return { synced: catalog.CATALOG.length };
  } catch (err) {
    if (MISSING_SCHEMA_CODES.has(err.code)) {
      console.warn('[provisioning] setting_definitions absente — appliquer docs/migrations/013_tenant_configuration.sql');
      return { synced: 0, skipped: true };
    }
    console.error('[provisioning] Synchronisation du catalogue impossible :', err.message);
    return { synced: 0, error: err.message };
  }
}

/** Rattrapage : provisionne toutes les organisations existantes. */
async function provisionAllTenants() {
  const res = await db.query('SELECT id, name FROM tenants ORDER BY id ASC');
  const reports = [];
  for (const tenant of res.rows) {
    reports.push(await provisionTenant(tenant.id, { companyName: tenant.name }));
  }
  return reports;
}

module.exports = {
  provisionTenant,
  provisionAllTenants,
  syncSettingDefinitions,
  DEFAULT_FIELDS,
  DEFAULT_FOLDERS,
  DEFAULT_VIEWS,
  DEFAULT_GROUPS,
  DEFAULT_SECTIONS,
  DEFAULT_SCHEMA_NAME,
};
