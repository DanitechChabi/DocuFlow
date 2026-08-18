const db = require('../config/db');

/**
 * retentionService — Politiques de rétention et de conservation (M-Files feature #18).
 * Schéma de référence : docs/migrations/010_metadata_typed.sql
 *   retention_policies (tenant_id, name, description, applies_to_schema_id,
 *                       retention_years, action_on_expiry, notify_before_days)
 *   UNIQUE (tenant_id, name)
 */

const EXPIRY_ACTIONS = ['archive', 'delete', 'alert'];

const retentionService = {
  EXPIRY_ACTIONS,

  async createPolicy({ tenantId, name, description = null, appliesToSchemaId = null, retentionYears = 5, actionOnExpiry = 'archive', notifyBeforeDays = 30 }) {
    if (!name || !String(name).trim()) {
      throw new Error('Le nom de la politique de rétention est obligatoire.');
    }
    if (!EXPIRY_ACTIONS.includes(actionOnExpiry)) {
      throw new Error(`Action à expiration invalide : ${actionOnExpiry} (attendu : ${EXPIRY_ACTIONS.join(', ')})`);
    }
    const years = Number(retentionYears);
    if (!Number.isInteger(years) || years < 0) {
      throw new Error('La durée de rétention doit être un nombre entier d\'années.');
    }

    const result = await db.query(
      `INSERT INTO retention_policies (tenant_id, name, description, applies_to_schema_id, retention_years, action_on_expiry, notify_before_days)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [tenantId, String(name).trim(), description, appliesToSchemaId, years, actionOnExpiry, notifyBeforeDays]
    );
    return result.rows[0];
  },

  async getPolicies(tenantId) {
    const result = await db.query(
      `SELECT p.*, s.name AS schema_name
       FROM retention_policies p
       LEFT JOIN metadata_schemas s ON s.id = p.applies_to_schema_id AND s.tenant_id = p.tenant_id
       WHERE p.tenant_id = $1
       ORDER BY p.name ASC`,
      [tenantId]
    );
    return result.rows;
  },

  async updatePolicy(tenantId, policyId, { name, description, appliesToSchemaId, retentionYears, actionOnExpiry, notifyBeforeDays }) {
    if (actionOnExpiry !== undefined && actionOnExpiry !== null && !EXPIRY_ACTIONS.includes(actionOnExpiry)) {
      throw new Error(`Action à expiration invalide : ${actionOnExpiry}`);
    }
    const result = await db.query(
      `UPDATE retention_policies
       SET name = COALESCE($3, name),
           description = COALESCE($4, description),
           applies_to_schema_id = COALESCE($5, applies_to_schema_id),
           retention_years = COALESCE($6, retention_years),
           action_on_expiry = COALESCE($7, action_on_expiry),
           notify_before_days = COALESCE($8, notify_before_days)
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      [policyId, tenantId, name, description, appliesToSchemaId, retentionYears, actionOnExpiry, notifyBeforeDays]
    );
    return result.rows[0];
  },

  async deletePolicy(tenantId, policyId) {
    const result = await db.query(
      'DELETE FROM retention_policies WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [policyId, tenantId]
    );
    return result.rowCount > 0;
  },

  /**
   * Documents dont la durée de rétention est dépassée, politique par politique.
   * `applies_to_schema_id` restreint le périmètre aux documents portant au moins
   * une valeur de métadonnée issue de ce schéma ; NULL = toutes les classes.
   *
   * NB : l'intervalle est construit par `make_interval(years => $2)` — un paramètre
   * placé dans un littéral SQL ('$2 days') n'est jamais lié par le driver.
   */
  async checkExpiredDocuments(tenantId) {
    const policies = await this.getPolicies(tenantId);
    const expired = [];

    for (const policy of policies) {
      const params = [tenantId, policy.retention_years];
      let scope = '';
      if (policy.applies_to_schema_id) {
        params.push(policy.applies_to_schema_id);
        scope = `
         AND EXISTS (
           SELECT 1 FROM metadata_values v
           JOIN metadata_fields f ON f.id = v.field_id
           WHERE v.document_id = d.id AND f.schema_id = $3
         )`;
      }

      const result = await db.query(
        `SELECT d.id, d.reference_mfile, d.date_document, d.statut
         FROM documents d
         WHERE d.tenant_id = $1
           AND d.date_document IS NOT NULL
           AND d.date_document < (CURRENT_DATE - make_interval(years => $2))
           AND d.statut <> 'archivé'${scope}
         ORDER BY d.date_document ASC`,
        params
      );

      expired.push(...result.rows.map((r) => ({
        documentId: r.id,
        reference: r.reference_mfile,
        dateDocument: r.date_document,
        policyId: policy.id,
        policyName: policy.name,
        action: policy.action_on_expiry,
      })));
    }
    return expired;
  }
};

module.exports = retentionService;
