const db = require('../config/db');

/**
 * relationService — Relations et dépendances inter-documents (M-Files feature #26).
 * Schéma de référence : docs/migrations/010_metadata_typed.sql
 *   document_relations (tenant_id, source_document_id, target_document_id, relation_type, created_by)
 *   UNIQUE (source_document_id, target_document_id, relation_type)
 */

const RELATION_TYPES = ['related', 'avenant', 'version_of', 'attachment_of', 'references', 'replaces'];

const relationService = {
  RELATION_TYPES,

  /**
   * Crée une relation entre deux documents du même tenant (idempotent).
   * @returns {Promise<object|null>} La relation, ou null si elle existait déjà.
   */
  async createRelation({ tenantId, fromDocId, toDocId, relationType = 'related', userId = null }) {
    const source = Number(fromDocId);
    const target = Number(toDocId);

    if (!Number.isInteger(source) || !Number.isInteger(target)) {
      throw new Error('Identifiants de documents invalides.');
    }
    if (source === target) {
      throw new Error('Un document ne peut pas être lié à lui-même.');
    }
    if (!RELATION_TYPES.includes(relationType)) {
      throw new Error(`Type de relation invalide : ${relationType}`);
    }

    // Isolation multi-tenant : les deux documents doivent appartenir au tenant appelant.
    const check = await db.query(
      'SELECT id FROM documents WHERE id = ANY($1::int[]) AND tenant_id = $2',
      [[source, target], tenantId]
    );
    if (check.rowCount !== 2) {
      throw new Error('Document source ou cible non trouvé dans votre organisation.');
    }

    const result = await db.query(
      `INSERT INTO document_relations (tenant_id, source_document_id, target_document_id, relation_type, created_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (source_document_id, target_document_id, relation_type) DO NOTHING
       RETURNING *`,
      [tenantId, source, target, relationType, userId]
    );
    return result.rows[0] || null;
  },

  /**
   * Liste les relations d'un document (entrantes et sortantes), enrichies
   * des informations du document lié pour un affichage direct côté front.
   */
  async getRelationsForDocument(tenantId, documentId) {
    const result = await db.query(
      `SELECT r.id,
              r.relation_type,
              r.created_at,
              r.source_document_id,
              r.target_document_id,
              CASE WHEN r.source_document_id = $2 THEN 'outgoing' ELSE 'incoming' END AS direction,
              d.id            AS related_document_id,
              d.reference_mfile,
              d.nom_entreprise,
              d.num_dossier,
              d.num_acte,
              d.type_document,
              d.annee,
              d.statut
       FROM document_relations r
       JOIN documents d
         ON d.id = CASE WHEN r.source_document_id = $2
                        THEN r.target_document_id
                        ELSE r.source_document_id END
        AND d.tenant_id = r.tenant_id
       WHERE r.tenant_id = $1
         AND (r.source_document_id = $2 OR r.target_document_id = $2)
       ORDER BY r.created_at DESC`,
      [tenantId, documentId]
    );
    return result.rows;
  },

  async deleteRelation(tenantId, relationId) {
    const result = await db.query(
      'DELETE FROM document_relations WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [relationId, tenantId]
    );
    return result.rowCount > 0;
  }
};

module.exports = relationService;
