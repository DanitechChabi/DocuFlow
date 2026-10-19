// ============================================================================
// loanController — prêt des dossiers physiques. La logique vit dans
// services/loanService ; ici, la traduction HTTP. Les erreurs métier portent
// leur statut (400, 403, 404, 409) ; une base sans la migration 025 répond
// 503 avec la marche à suivre plutôt qu'un 500 opaque.
// ============================================================================
const loanService = require('../services/loanService');

function repondreErreur(res, err, contexte) {
  if (err.statut) {
    return res.status(err.statut).json({ message: err.message, ...(err.code && typeof err.code === 'string' && !/^\d/.test(err.code) ? { code: err.code } : {}) });
  }
  if (err.code === '23505') {
    // Deux remises simultanées de la même demande : la contrainte UNIQUE a tranché.
    return res.status(409).json({ message: 'Ce dossier a déjà été remis pour cette demande.', code: 'DEJA_REMIS' });
  }
  if (err.code === '42P01') {
    return res.status(503).json({
      message: 'Le prêt des dossiers physiques n\'est pas encore disponible sur cette installation (migration 025 à appliquer).',
      code: 'MIGRATION_025_REQUISE',
    });
  }
  console.error(`[prêts] ${contexte} :`, err);
  return res.status(500).json({ message: `Erreur lors de ${contexte}.` });
}

const id = (req) => Number(req.params.id);

exports.remettre = async (req, res) => {
  try {
    const { pret, indexation } = await loanService.remettre(req.user.tenant_id, id(req), req.user, req.body || {});
    res.status(201).json({ message: 'Dossier remis — l\'agent est notifié.', loan: pret, indexation });
  } catch (err) { repondreErreur(res, err, 'la remise du dossier'); }
};

exports.retourner = async (req, res) => {
  try {
    const { pret } = await loanService.retourner(req.user.tenant_id, id(req), req.user, req.body || {});
    res.json({ message: 'Retour enregistré — l\'agent a reçu sa décharge.', loan: pret });
  } catch (err) { repondreErreur(res, err, 'l\'enregistrement du retour'); }
};

exports.signaler = async (req, res) => {
  try {
    const { pret } = await loanService.signaler(req.user.tenant_id, id(req), req.user, req.body || {});
    res.json({ message: 'Signalement transmis aux archives.', loan: pret });
  } catch (err) { repondreErreur(res, err, 'le signalement'); }
};

exports.confirmer = async (req, res) => {
  try {
    const { pret } = await loanService.confirmer(req.user.tenant_id, id(req), req.user);
    res.json({ message: 'Réception confirmée.', loan: pret });
  } catch (err) { repondreErreur(res, err, 'la confirmation de réception'); }
};

exports.registre = async (req, res) => {
  const tenantId = req.user.tenant_id;
  try {
    // Les relances partent à la consultation (pas de tâche planifiée) ; leur
    // échec ne prive pas l'archiviste de son registre.
    await loanService.relancerRetards(tenantId).catch((e) => console.error('[prêts] relances :', e.message));
    const prets = await loanService.registre(tenantId, { etat: req.query.etat || undefined });
    res.json(prets);
  } catch (err) { repondreErreur(res, err, 'la lecture du registre des prêts'); }
};
