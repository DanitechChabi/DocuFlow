const db = require('../config/db');

/**
 * retentionService — Politiques de rétention et de conservation.
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
  },

  /**
   * APPLIQUE les politiques expirées — c'était la fonctionnalité dormante :
   * checkExpiredDocuments n'était appelé par aucune route, aucun cron, aucun
   * démarrage. Chaque organisation est provisionnée avec une politique
   * « Conservation standard, 5 ans, archivage » qui ne s'exécutait jamais.
   *
   * Trois actions, telles que déclarées par la politique :
   *   archive → statut « archivé » (la machine à états l'autorise depuis tout
   *             état non archivé de travail — c'est un geste de gouvernance) ;
   *   delete  → corbeille (PAS une destruction physique : la rétention est une
   *             politique, pas un purgeur incontrôlé — la purge reste un geste
   *             humain avec la permission documents.purge) ;
   *   alert   → trace dans le journal documentaire, rien de plus.
   *
   * @returns {Promise<{appliques: Array, erreurs: Array}>}
   */
  async applyRetention(tenantId, userId = null, { logHistory = null } = {}) {
    const expires = await this.checkExpiredDocuments(tenantId);
    const appliques = [];
    const erreurs = [];

    for (const e of expires) {
      try {
        if (e.action === 'archive') {
          await db.query(
            `UPDATE documents SET statut = 'archivé', updated_at = CURRENT_TIMESTAMP
              WHERE id = $1 AND tenant_id = $2 AND statut <> 'archivé' AND deleted_at IS NULL`,
            [e.documentId, tenantId]
          );
        } else if (e.action === 'delete') {
          // Corbeille, pas destruction (voir l'en-tête).
          await db.query(
            `UPDATE documents SET deleted_at = now(), deleted_by = NULL
              WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
            [e.documentId, tenantId]
          );
        }
        // 'alert' : pas d'écriture — le journal ci-dessous est la trace.

        if (logHistory) {
          const intitule = e.action === 'archive'
            ? `Rétention « ${e.policyName} » : archivé automatiquement`
            : e.action === 'delete'
              ? `Rétention « ${e.policyName} » : mis à la corbeille automatiquement`
              : `Rétention « ${e.policyName} » : échéance atteinte (alerte)`;
          await logHistory(tenantId, e.documentId, userId, intitule, null, null);
        }
        appliques.push(e);
      } catch (err) {
        erreurs.push({ ...e, erreur: err.message });
      }
    }
    return { appliques, erreurs };
  }
};

// ---------------------------------------------------------------------------
// Ordonnanceur : la rétention s'applique périodiquement, sans humain.
//
// Pourquoi ici et pas dans app.js : le service porte SA politique d'exécution.
// Chaque tenant est vérifié au plus toutes les 24 h (Map en mémoire), et une
// erreur ne fait que reporter au prochain passage — une base indisponible ne
// doit pas empêcher l'application de démarrer ni de servir.
// ---------------------------------------------------------------------------
const DERNIER_PASSAGE = new Map(); // tenantId → timestamp
const INTERVALLE_MS = 24 * 3600 * 1000;

/**
 * Déclenche l'application de la rétention pour un tenant si son dernier
 * passage date de plus de 24 h. Silencieux par conception : la rétention est
 * un travail de fond, ses résultats sont dans le journal documentaire.
 */
async function passageRetenu(tenantId, userId = null, logHistory = null) {
  const dernier = DERNIER_PASSAGE.get(tenantId) || 0;
  if (Date.now() - dernier < INTERVALLE_MS) return;
  DERNIER_PASSAGE.set(tenantId, Date.now());
  try {
    const { appliques, erreurs } = await retentionService.applyRetention(tenantId, userId, { logHistory });
    if (appliques.length || erreurs.length) {
      console.log(`[rétention] Tenant ${tenantId} : ${appliques.length} document(s) traité(s), ${erreurs.length} échec(s).`);
    }
  } catch (err) {
    console.warn('[rétention] Passage impossible, reporté :', err.message);
  }
}

module.exports = retentionService;
// Posé APRÈS l'export principal : l'assignation `module.exports = ...` aurait
// sinon écrasé cette propriété.
module.exports.retentionScheduler = { passageRetenu };
