// ============================================================================
// Archivothèque virtuelle (migration 045), montée sous /api.
//   PUBLIC (sans compte, débit limité) :
//     GET  /api/archivotheque/:slug                      la vitrine et ses pièces
//     GET  /api/archivotheque/:slug/pieces/:id/fichier   le fichier d'une pièce publiée
//   PERSONNEL :
//     GET  /api/archives/archivotheque                   toutes les pièces, par statut
//     GET  /api/documents/:id/archivotheque              la pièce d'un document
//     POST /api/documents/:id/archivotheque              proposer le document
//     POST /api/archives/archivotheque/:id/autorisation  autoriser la publication
//     POST /api/archives/archivotheque/:id/retrait       retirer la pièce
// ============================================================================
const express = require('express');
const router = express.Router();
const archivotheque = require('../services/archivothequeService');
const partage = require('../services/partageService');
const auth = require('../middlewares/authMiddleware');
const { requirePermission, requireAnyPermission } = require('../middlewares/requirePermission');
const { limiteur } = require('../middlewares/limiteur');
const { verifierAccesDocument, repondreRefus } = require('../helpers/accesDocument');
const { typeContenu } = require('../helpers/contentType');

const lectures = limiteur({ max: 120, fenetreMs: 10 * 60 * 1000 });
const fichiers = limiteur({ max: 600, fenetreMs: 10 * 60 * 1000 });

const echec = (res, err, message) => {
  if (err && err.status && err.status < 500) return res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
  console.error(`[archivothèque] ${message} :`, err);
  return res.status(500).json({ message });
};
const repondre = (fn, message, statut = 200) => async (req, res) => {
  try {
    const r = await fn(req);
    if (r === null) return res.status(404).json({ message: 'Introuvable.' });
    return res.status(statut).json(r);
  } catch (err) { return echec(res, err, message); }
};
/** Pour les routes d'un document : l'accès en lecture au document d'abord. */
const surDocument = (fn, message, statut = 200) => async (req, res) => {
  try {
    const { document, refus } = await verifierAccesDocument(req, { corbeille: false });
    if (refus) return repondreRefus(res, refus);
    return res.status(statut).json(await fn(req, document));
  } catch (err) { return echec(res, err, message); }
};

// ------------------------------------------------------------------ public
router.get('/archivotheque/:slug', lectures, repondre((req) => archivotheque.vitrine(req.params.slug), 'Archivothèque indisponible'));

router.get('/archivotheque/:slug/pieces/:id/fichier', fichiers, async (req, res) => {
  let source = null;
  try {
    const r = await archivotheque.fichierPublic(req.params.slug, req.params.id, { compter: req.query.lecture === '1' });
    if (!r) return res.status(404).json({ message: 'Pièce introuvable.' });
    source = await partage.ouvrirFichier(r.fichier);
    if (!source) return res.status(410).json({ message: 'Le fichier est introuvable dans le stockage.' });
    const extension = (/\.[a-z0-9]{2,5}$/i.exec(r.fichier.original_name || '') || [''])[0].toLowerCase();
    const nom = `${String(r.titre).replace(/[\r\n"\\/:*?<>|]/g, ' ').trim().slice(0, 120) || 'piece'}${extension}`;
    const ascii = nom.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '_');
    res.setHeader('Content-Type', typeContenu(r.fichier.mime_type));
    res.setHeader('Content-Disposition', `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nom)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Courte mise en cache : une pièce retirée cesse vite d'être servie.
    res.setHeader('Cache-Control', 'public, max-age=300');
    if (source.taille) res.setHeader('Content-Length', String(source.taille));
    source.flux.on('error', (err) => { console.error('[archivothèque] lecture interrompue :', err.message); res.destroy(err); });
    return source.flux.pipe(res);
  } catch (err) {
    source?.flux?.destroy?.();
    return echec(res, err, 'Lecture de la pièce impossible');
  }
});

// --------------------------------------------------------------- personnel
router.get('/archives/archivotheque', [auth, requirePermission('archives.view')],
  repondre((req) => archivotheque.lister(req.user.tenant_id, req.user), "Chargement de l'archivothèque impossible"));
router.get('/documents/:id/archivotheque', [auth, requirePermission('documents.view')],
  surDocument(async (req, d) => ({ piece: await archivotheque.pourDocument(req.user.tenant_id, d.id) }), 'Chargement impossible'));
router.post('/documents/:id/archivotheque', [auth, requirePermission('archives.manage')],
  surDocument((req, d) => archivotheque.proposer(req.user.tenant_id, d.id, req.body || {}, req.user), 'Proposition impossible', 201));
router.post('/archives/archivotheque/:id/autorisation', [auth, requirePermission('archives.validate')],
  repondre((req) => archivotheque.autoriser(req.user.tenant_id, req.params.id, req.user), 'Autorisation impossible'));
router.post('/archives/archivotheque/:id/retrait', [auth, requireAnyPermission(['archives.manage', 'archives.validate'])],
  repondre((req) => archivotheque.retirer(req.user.tenant_id, req.params.id, req.body || {}, req.user), 'Retrait impossible'));

module.exports = router;
