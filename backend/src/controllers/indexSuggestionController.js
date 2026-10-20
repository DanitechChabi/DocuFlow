// ============================================================================
// indexSuggestionController — propositions de métadonnées pour un document
// (indexation assistée). Lecture seule : rien n'est écrit, l'archiviste
// accepte ou non. Même périmètre que la fiche : ACL de lecture du dossier.
// ============================================================================
const db = require('../config/db');
const aclService = require('../services/aclService');
const suggestions = require('../services/indexSuggestionService');

exports.propositions = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const id = Number(req.params.id);
  try {
    const d = await db.query('SELECT dossier_id FROM documents WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL', [id, tenantId]);
    if (!d.rows[0]) return res.status(404).json({ message: 'Document non trouvé' });
    if (d.rows[0].dossier_id && !(await aclService.peutLire(tenantId, req.user.id, d.rows[0].dossier_id))) {
      return res.status(403).json({ message: 'Ce document est dans un dossier qui ne vous est pas ouvert.', code: 'HORS_PERIMETRE' });
    }
    res.json(await suggestions.propositionsPour(tenantId, id));
  } catch (err) {
    if (err.code === '42703') return res.json({ texte: 'aucun', propositions: [] }); // base non migrée (027)
    console.error('[indexation] propositions :', err);
    res.status(500).json({ message: 'Erreur lors du calcul des propositions' });
  }
};
