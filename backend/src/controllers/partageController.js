// ============================================================================
// partageController — accès PUBLIC par lien de partage (migration 033).
// Aucune authentification : le jeton fait foi, revérifié à chaque requête
// (révocation, expiration, plafond, corbeille, interrupteur d'organisation).
//
//   GET  /api/partage/:jeton          ce que montre la page publique
//   POST /api/partage/:jeton/acces    mot de passe → preuve courte (30 min)
//   GET  /api/partage/:jeton/fichier  le fichier (?preuve=…&mode=apercu)
//
// Débit limité par adresse ; échecs de mot de passe plafonnés par lien et par
// adresse. Chaque accès réussi est inscrit au journal chaîné (PARTAGE_CONSULTE),
// chaque refus sur un lien existant aussi (PARTAGE_REFUSE).
// ============================================================================
const bcrypt = require('bcryptjs');
const partage = require('../services/partageService');
const { typeContenu } = require('../helpers/contentType');

const REQUETES_PAR_MINUTE = 60;
const ECHECS_MAX = 5;
const ECHECS_FENETRE_MS = 15 * 60 * 1000;

function repondreErreur(res, err) {
  if (err && err.status && err.status < 500) {
    return res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
  }
  console.error('[partage public]', err);
  return res.status(500).json({ message: 'Erreur du serveur.' });
}

/** Résout le lien ; un refus sur un lien existant est journalisé. */
async function resoudre(req) {
  try {
    return await partage.resoudre(req.params.jeton);
  } catch (err) {
    if (err.partage) {
      await partage.journaliserAcces(err.partage, req.ip, { motif: err.code }, 'PARTAGE_REFUSE').catch(() => {});
    }
    throw err;
  }
}

const tropDeRequetes = (res) => res.status(429).json({ message: 'Trop de requêtes : réessayez dans une minute.', code: 'TROP_DE_REQUETES' });
const debitOk = (req) => partage.limiter(`ip:${req.ip}`, REQUETES_PAR_MINUTE, 60000);

async function reponseConsultation(req, p, f, extra = {}) {
  return {
    protege: Boolean(p.mot_de_passe_hash),
    organisation: await partage.organisation(p.tenant_id, req, p.tenant_nom),
    ...partage.presentationPublique(p, f),
    ...extra,
  };
}

exports.consulter = async (req, res) => {
  if (!debitOk(req)) return tropDeRequetes(res);
  try {
    const { partage: p, fichier: f } = await resoudre(req);
    if (p.mot_de_passe_hash) {
      // Avant le mot de passe : rien du document, seulement qui partage.
      return res.json({ protege: true, organisation: await partage.organisation(p.tenant_id, req, p.tenant_nom), expire_at: p.expire_at });
    }
    await partage.noterConsultation(p, f, req.ip, 'consultation');
    res.json(await reponseConsultation(req, p, f));
  } catch (err) {
    repondreErreur(res, err);
  }
};

exports.acceder = async (req, res) => {
  if (!debitOk(req)) return tropDeRequetes(res);
  try {
    const { partage: p, fichier: f } = await resoudre(req);
    if (!p.mot_de_passe_hash) {
      await partage.noterConsultation(p, f, req.ip, 'consultation');
      return res.json(await reponseConsultation(req, p, f));
    }
    const cleLien = `echecs:${p.id}`;
    const cleAdresse = `echecs:${p.id}:${req.ip}`;
    if (partage.echecsDepasses(cleAdresse, ECHECS_MAX) || partage.echecsDepasses(cleLien, ECHECS_MAX * 4)) {
      return res.status(429).json({ message: 'Trop de tentatives : réessayez dans quelques minutes.', code: 'TROP_DE_TENTATIVES' });
    }
    const motDePasse = String(req.body?.mot_de_passe || '');
    if (!motDePasse || !(await bcrypt.compare(motDePasse, p.mot_de_passe_hash))) {
      partage.noterEchec(cleAdresse, ECHECS_FENETRE_MS);
      partage.noterEchec(cleLien, ECHECS_FENETRE_MS);
      await partage.journaliserAcces(p, req.ip, { motif: 'MOT_DE_PASSE_INCORRECT' }, 'PARTAGE_REFUSE').catch(() => {});
      return res.status(401).json({ message: motDePasse ? 'Mot de passe incorrect.' : 'Mot de passe requis.', code: motDePasse ? 'MOT_DE_PASSE_INCORRECT' : 'MOT_DE_PASSE_REQUIS' });
    }
    await partage.noterConsultation(p, f, req.ip, 'consultation');
    const { preuve, expire_at: preuveExpireAt } = partage.emettrePreuve(p);
    res.json(await reponseConsultation(req, p, f, { preuve, preuve_expire_at: preuveExpireAt }));
  } catch (err) {
    repondreErreur(res, err);
  }
};

/** Nom de fichier pour Content-Disposition : repli ASCII + forme UTF-8 (RFC 5987). */
function disposition(mode, nom) {
  const brut = String(nom || 'document').replace(/[\r\n"\\]/g, '_');
  const ascii = brut.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '_');
  return `${mode}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(brut)}`;
}

exports.fichier = async (req, res) => {
  if (!debitOk(req)) return tropDeRequetes(res);
  let source = null;
  try {
    const { partage: p, fichier: f } = await resoudre(req);
    if (p.mot_de_passe_hash && !partage.verifierPreuve(p, req.query.preuve)) {
      return res.status(401).json({ message: 'Mot de passe requis (ou session de consultation expirée).', code: 'MOT_DE_PASSE_REQUIS' });
    }
    source = await partage.ouvrirFichier(f);
    if (!source) return res.status(410).json({ message: 'Le fichier est introuvable dans le stockage.', code: 'FICHIER_INTROUVABLE' });
    // Le téléchargement n'est compté qu'une fois le fichier en main.
    if (!(await partage.reserverTelechargement(p.id))) {
      source.flux.destroy?.();
      return res.status(410).json({ message: 'Ce lien a atteint son nombre maximal de téléchargements.', code: 'PARTAGE_EPUISE' });
    }
    const apercu = req.query.mode === 'apercu' && partage.TYPES_APERCU.has(f.mime_type);
    await partage.journaliserAcces(p, req.ip, { acces: apercu ? 'apercu' : 'telechargement', version: f.version, fichier_id: f.id });
    res.setHeader('Content-Type', typeContenu(f.mime_type));
    res.setHeader('Content-Disposition', disposition(apercu ? 'inline' : 'attachment', f.original_name));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (source.taille) res.setHeader('Content-Length', String(source.taille));
    source.flux.on('error', (err) => {
      console.error('[partage public] lecture du fichier interrompue :', err.message);
      res.destroy(err);
    });
    source.flux.pipe(res);
  } catch (err) {
    source?.flux?.destroy?.();
    repondreErreur(res, err);
  }
};
