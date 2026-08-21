const db = require('../config/db');
const tenantDb = require('../config/db-tenant');
const requestStateMachine = require('../services/requestStateMachine');
const mailService = require('../services/mailService');
const storage = require('../services/storageService');
const { indexRequestToDocuments } = require('../services/documentIndexService');
const auditService = require('../services/auditService');
const settingsService = require('../services/settingsService');
const requestFieldService = require('../services/requestFieldService');
const catalog = require('../config/settingsCatalog');
const { normalizeOptions, allowedValues } = require('../helpers/requestOptions');
require('dotenv').config({ path: './.env' });

/* ===== Helpers ===== */

/**
 * Listes de choix effectives de l'organisation (types de document, motifs,
 * priorités), telles que le formulaire les propose.
 *
 * La validation côté serveur n'est pas une redite du formulaire : un client peut
 * appeler l'API directement, et surtout un choix retiré par l'administrateur
 * resterait insérable tant que rien ne le refuse ici. Sans ce contrôle, la
 * colonne `type_document` accumulerait des valeurs absentes de toute liste, que
 * les filtres et les regroupements de la GED ne sauraient plus rattacher.
 */
async function getRequestOptions(tenantId) {
  const settings = await settingsService.getAll(tenantId);
  const fallback = (key) => catalog.BY_KEY.get(key)?.default;

  return {
    documentTypes: normalizeOptions(settings.request_document_types, fallback('request_document_types')),
    motifs: normalizeOptions(settings.request_motifs, fallback('request_motifs')),
    priorities: normalizeOptions(settings.request_priorities, fallback('request_priorities'), { withTone: true }),
    defaultPriority: settings.request_default_priority,
  };
}

// Enregistre une étape horodatée dans request_history (machine à états)
async function insertStateHistory(tenantId, { requestId, userId, userName, action, previousStatus, newStatus, comment }) {
  try {
    await tenantDb.insert(
      tenantId,
      'request_history',
      ['request_id', 'user_id', 'action', 'previous_status', 'new_status', 'comment', 'user_name'],
      [requestId, userId, action, previousStatus || null, newStatus || null, comment || null, userName || null]
    );
  } catch (err) {
    if (err.code === '42P01') {
      console.warn('[request] table request_history absente, étape non enregistrée');
      return;
    }
    throw err;
  }
}

// Insère une notification interne (cloche)
async function notifyUser(tenantId, userId, title, message, type, requestId) {
  await tenantDb.insert(
    tenantId,
    'notifications',
    ['id_user', 'title', 'message', 'type', 'request_id'],
    [userId, title, message, type, requestId]
  );
}

// Récupère l'e-mail d'un utilisateur (pas présent dans le JWT)
async function getUserEmail(tenantId, userId) {
  try {
    const res = await tenantDb.query(tenantId, 'SELECT email FROM users WHERE id = $1', [userId]);
    return res.rows[0]?.email || null;
  } catch (err) {
    console.error('[request] getUserEmail :', err.message);
    return null;
  }
}

exports.createRequest = async (req, res) => {
  const {
    nom_entreprise,
    num_dossier,
    num_acte,
    annee,
    type_document,
    motif,
    priorite
  } = req.body;

  const userId = req.user.id;
  const tenantId = req.user.tenant_id;

  try {
    // Les trois champs à choix sont vérifiés contre les listes de l'organisation.
    //
    // Deux cas à ne pas confondre :
    //   * champ ABSENT du corps → le serveur retient le choix par défaut. Le
    //     formulaire présélectionne toujours motif et priorité ; un appel qui les
    //     omet n'exprime aucune intention, et `motif` est NOT NULL en base.
    //   * champ RENSEIGNÉ mais hors liste → refus. Réécrire en silence le motif
    //     qu'un demandeur a choisi consignerait une raison qui n'est pas la
    //     sienne : la demande partirait en traitement sous un prétexte inventé
    //     par le serveur, et les tableaux de bord compteraient ce motif faux.
    //     Un refus explicite fait recharger les listes au formulaire.
    const options = await getRequestOptions(tenantId);

    const typeFourni = String(type_document || '').trim();
    // `type_document` reste facultatif — le formulaire l'ouvre sur
    // « Sélectionner… » — mais s'il est renseigné il doit appartenir à la liste :
    // une valeur libre échapperait ensuite aux filtres et aux regroupements de la
    // GED, qui s'appuient sur cette colonne.
    if (typeFourni && !allowedValues(options.documentTypes).includes(typeFourni)) {
      return res.status(400).json({
        message: `Type de document non proposé : « ${typeFourni} ».`,
      });
    }

    const motifFourni = String(motif || '').trim();
    if (motifFourni && !allowedValues(options.motifs).includes(motifFourni)) {
      return res.status(400).json({ message: `Motif non proposé : « ${motifFourni} ».` });
    }
    const motifRetenu = motifFourni || options.motifs[0]?.value || null;
    // La colonne est NOT NULL : sans motif retenu, l'insertion échouerait sur une
    // violation de contrainte, c'est-à-dire une erreur 500 illisible pour le
    // demandeur. Le cas suppose une liste de motifs vide malgré le repli sur le
    // catalogue — donc un catalogue lui-même vidé —, mais il vaut un message clair.
    if (!motifRetenu) {
      return res.status(400).json({
        message: 'Aucun motif de demande n\'est configuré pour votre organisation.',
      });
    }

    const prioriteFournie = String(priorite || '').trim();
    const prioritesAdmises = allowedValues(options.priorities);
    if (prioriteFournie && !prioritesAdmises.includes(prioriteFournie)) {
      return res.status(400).json({ message: `Priorité non proposée : « ${prioriteFournie} ».` });
    }
    // À défaut de priorité fournie, celle réglée par l'organisation — à condition
    // qu'elle figure encore dans la liste, un administrateur pouvant avoir retiré
    // le niveau désigné comme défaut sans corriger ce réglage.
    const prioriteParDefaut = String(options.defaultPriority || '').trim();
    const prioriteRetenue = prioriteFournie
      || (prioritesAdmises.includes(prioriteParDefaut) ? prioriteParDefaut : options.priorities[0]?.value)
      || null;

    // Champs personnalisés ajoutés par l'organisation (migration 016). Ils sont
    // validés AVANT l'insertion : un champ obligatoire manquant doit faire
    // échouer la création, pas laisser en base une demande incomplète qu'aucun
    // écran ne signale. Le service reste silencieux si la migration n'est pas
    // passée — déployer avant de migrer ne doit pas empêcher d'enregistrer.
    let champsPersonnalises = [];
    if (await requestFieldService.isAvailable()) {
      const { customValues, missing } = await requestFieldService.collectValues(tenantId, req.body);
      if (missing.length) {
        return res.status(400).json({ message: missing.join(' ') });
      }
      champsPersonnalises = customValues;
    }

    // 1. Enregistrement de la demande (Statut : en attente)
    const newRequest = await tenantDb.insert(
      tenantId,
      'requests',
      ['id_user', 'nom_entreprise', 'num_dossier', 'num_acte', 'annee', 'type_document', 'motif', 'priorite', 'statut'],
      [userId, nom_entreprise, num_dossier, num_acte, annee, typeFourni || null, motifRetenu, prioriteRetenue, 'en attente']
    );

    const requestId = newRequest.rows[0].id;
    const requestRow = newRequest.rows[0];

    // 1bis. Valeurs des champs personnalisés.
    //
    // Après l'insertion, faute de clé étrangère satisfaite avant elle. L'échec
    // est journalisé sans interrompre : la demande existe et vaut mieux qu'un
    // 500 qui laisserait le demandeur croire à une perte, alors que les champs
    // système — ceux dont dépend le traitement — sont bien enregistrés.
    if (champsPersonnalises.length) {
      try {
        await requestFieldService.saveValues(requestId, champsPersonnalises);
      } catch (fieldErr) {
        console.error('[request] valeurs des champs personnalisés non enregistrées :', fieldErr.message);
      }
    }

    // 2. Historique d'état initial (machine à états)
    await insertStateHistory(tenantId, {
      requestId,
      userId,
      userName: req.user.full_name || null,
      action: 'Création de la demande',
      previousStatus: null,
      newStatus: 'en attente',
    });

    // 3. Notifier les archivistes et admins du même tenant
    // tenantDb.query gère le fallback si la colonne tenant_id n'existe pas
    const admins = await tenantDb.query(
      tenantId,
      "SELECT id FROM users WHERE role IN ('admin', 'superadmin', 'archiviste')"
    );
    for (const admin of admins.rows) {
      await notifyUser(tenantId, admin.id, 'Nouvelle demande reçue', `Une nouvelle demande a été créée pour l'entreprise ${nom_entreprise}.`, 'request_created', requestId);
    }

    // 4. Log l'action dans l'historique général
    await tenantDb.insert(
      tenantId,
      'audit_logs',
      ['id_user', 'action', 'request_id'],
      [userId, `A créé une demande pour ${nom_entreprise}`, requestId]
    );

    // 5. Accusé de réception par e-mail au demandeur
    // `notify` applique les réglages de l'organisation (nom d'expéditeur,
    // signature, pied de page) et respecte ses bascules d'activation.
    try {
      const requesterEmail = await getUserEmail(tenantId, userId);
      if (requesterEmail) {
        await mailService.notify({
          tenantId,
          to: requesterEmail,
          event: 'request_created',
          request: requestRow,
        });
      }
    } catch (emailErr) {
      console.error('[request] Erreur e-mail accusé de réception :', emailErr.message);
    }

    res.status(201).json({
      message: 'Votre demande a été enregistrée et est en attente de traitement par l\'archiviste.',
      request: newRequest.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur lors de l'enregistrement de la demande" });
  }
};

/**
 * Listes de choix du formulaire de demande.
 *
 * Le formulaire lit normalement ces valeurs depuis les réglages déjà chargés par
 * SettingsContext ; cette route existe pour que la source de vérité reste
 * unique et interrogeable — c'est elle qui fait autorité en cas de doute sur ce
 * que le serveur accepte réellement, puisqu'elle applique la même normalisation
 * que la validation de createRequest.
 */
exports.getRequestOptions = async (req, res) => {
  try {
    const options = await getRequestOptions(req.user.tenant_id);
    res.json(options);
  } catch (err) {
    console.error('[request] getRequestOptions :', err.message);
    res.status(500).json({ message: 'Erreur lors du chargement des listes de choix' });
  }
};

/**
 * Recherche, dans le référentiel documentaire, un document correspondant à une
 * demande (même numéro de dossier ET même numéro d'acte).
 *
 * Sert à l'archiviste avant traitement : si le document est déjà indexé, la
 * demande peut être satisfaite immédiatement sans nouvelle numérisation.
 */
exports.findMatchingDocument = async (req, res) => {
  const { id } = req.params;
  const tenantId = req.user.tenant_id;

  try {
    const requestResult = await tenantDb.query(
      tenantId,
      'SELECT * FROM requests WHERE id = $1',
      [id]
    );
    const request = requestResult.rows[0];

    if (!request) {
      return res.status(404).json({ message: 'Demande non trouvée' });
    }

    // Vérification dans le référentiel documentaire (plus de mock)
    // db.query direct : db-tenant injecte tenant_id en double sur ORDER BY + LIMIT
    const docResult = await db.query(
      `SELECT * FROM documents
       WHERE num_dossier = $1 AND num_acte = $2 AND tenant_id = $3
       ORDER BY created_at DESC LIMIT 1`,
      [request.num_dossier, request.num_acte, tenantId]
    );
    const document = docResult.rows[0] || null;

    let fileUrl = null;
    if (document) {
      const fileRes = await db.query(
        'SELECT * FROM document_files WHERE document_id = $1 ORDER BY version DESC LIMIT 1',
        [document.id]
      );
      const f = fileRes.rows[0];
      if (f) fileUrl = storage.fileUrl(req, f);
    }

    res.json({
      exists: !!document,
      document,
      fileUrl,
      message: document ? 'Document trouvé dans le référentiel' : 'Document non trouvé dans le référentiel'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la vérification du document' });
  }
};

exports.linkDocument = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { id } = req.params;
  const { document_id } = req.body;

  try {
    if (document_id == null) {
      await tenantDb.query(tenantId, 'UPDATE requests SET document_id = NULL WHERE id = $1', [id]);
      return res.json({ message: 'Lien retiré' });
    }
    const docRes = await tenantDb.query(tenantId, 'SELECT * FROM documents WHERE id = $1', [document_id]);
    if (!docRes.rows[0]) return res.status(404).json({ message: 'Document non trouvé' });

    const result = await tenantDb.query(
      tenantId,
      'UPDATE requests SET document_id = $1 WHERE id = $2',
      [document_id, id]
    );
    if (!result.rowCount) return res.status(404).json({ message: 'Demande non trouvée' });
    res.json({ message: 'Demande liée au document', document_id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la liaison' });
  }
};

exports.getUserRequests = async (req, res) => {
  const userId = req.user.id;
  const tenantId = req.user.tenant_id;

  try {
    const result = await tenantDb.query(
      tenantId,
      'SELECT * FROM requests WHERE id_user = $1 ORDER BY created_at DESC',
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la récupération des demandes' });
  }
};

exports.getAllRequests = async (req, res) => {
  const tenantId = req.user.tenant_id;

  try {
    // Filtrage tenant explicite avec colonnes qualifiées pour éviter l'ambiguïté
    const result = await db.query(
      `SELECT r.*, u.full_name as requester_name, u2.full_name as assignee_name
       FROM requests r
       JOIN users u ON r.id_user = u.id AND u.tenant_id = r.tenant_id
       LEFT JOIN users u2 ON r.assignee_id = u2.id AND u2.tenant_id = r.tenant_id
       WHERE r.tenant_id = $1
       ORDER BY r.created_at DESC`,
      [tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la récupération des demandes' });
  }
};

exports.getStats = async (req, res) => {
  const tenantId = req.user.tenant_id;

  try {
    const result = await tenantDb.query(
      tenantId,
      `SELECT statut, COUNT(*) as count FROM requests GROUP BY statut`
    );
    const stats = {};
    result.rows.forEach(row => {
      stats[row.statut] = parseInt(row.count);
    });
    res.json(stats);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la récupération des statistiques' });
  }
};

exports.getAuditLogs = async (req, res) => {
  const userId = req.user.id;
  const role = req.user.role;
  const tenantId = req.user.tenant_id;

  try {
    // Tentative avec tenant_id ; fallback si colonne absente
    let result;
    try {
      // LEFT JOIN et non JOIN : un INNER JOIN écartait toutes les entrées sans
      // auteur identifié (actions système, comptes supprimés), qui disparaissaient
      // alors de l'historique sans laisser de trace — inacceptable pour un
      // journal d'audit qui se veut exhaustif.
      let query = `SELECT al.*, COALESCE(u.full_name, al.user_name) as user_name
                   FROM audit_logs al
                   LEFT JOIN users u ON al.id_user = u.id
                   WHERE al.tenant_id = $1`;
      const params = [tenantId];

      if (role !== 'admin' && role !== 'superadmin') {
        query += ` AND al.id_user = $2`;
        params.push(userId);
      }

      query += ` ORDER BY al.id DESC`;
      result = await db.query(query, params);
    } catch (err) {
      if (err.code === '42703') {
        // Fallback : pas de tenant_id
        let query = `SELECT al.*, COALESCE(u.full_name, al.user_name) as user_name
                     FROM audit_logs al
                     LEFT JOIN users u ON al.id_user = u.id`;
        const params = [];

        if (role !== 'admin' && role !== 'superadmin') {
          query += ` WHERE al.id_user = $1`;
          params.push(userId);
        }

        query += ` ORDER BY al.id DESC`;
        result = await db.query(query, params);
      } else {
        throw err;
      }
    }

    // Contrat unique pour les deux vues du journal (historique des flux et
    // journal d'audit) : voir auditService.normalizeLog.
    res.json(result.rows.map(auditService.normalizeLog));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur lors de la récupération de l'historique" });
  }
};

exports.updateRequestStatus = async (req, res) => {
  const { id } = req.params;
  const { status, notes_internes } = req.body;
  const tenantId = req.user.tenant_id;
  const role = req.user.role;
  const userId = req.user.id;

  try {
    // 1. Charger la demande pour valider la transition
    const requestResult = await tenantDb.query(
      tenantId,
      'SELECT * FROM requests WHERE id = $1',
      [id]
    );
    const request = requestResult.rows[0];
    if (!request) {
      return res.status(404).json({ message: 'Demande non trouvée' });
    }

    // 2. Validation par la machine à états (transition + rôle)
    const check = requestStateMachine.canTransition({
      from: request.statut,
      to: status,
      role,
      isOwner: request.id_user === userId,
    });
    if (!check.ok) {
      return res.status(400).json({ message: check.reason });
    }

    // 3. Mise à jour en base
    let query = 'UPDATE requests SET statut = $1';
    let params = [status];
    let paramCount = 2;

    if (notes_internes !== undefined) {
      query += `, notes_internes = $${paramCount++}`;
      params.push(notes_internes);
    }

    if (status === 'livré') {
      query += `, date_livraison = CURRENT_TIMESTAMP`;
    } else {
      query += `, date_livraison = NULL`;
    }

    // Tentative avec tenant_id ; fallback si colonne absente (mode mono-tenant)
    const queryWithTenant = query + ` WHERE id = $${paramCount++} AND tenant_id = $${paramCount}`;
    try {
      await db.query(queryWithTenant, [...params, id, tenantId]);
    } catch (err) {
      if (err.code === '42703') {
        // Le placeholder id est le dernier paramètre contigu (paramCount - 1)
        await db.query(query + ` WHERE id = $${paramCount - 1}`, [...params, id]);
      } else {
        throw err;
      }
    }

    // 3bis. À la livraison, indexer les fichiers dans le référentiel documentaire
    if (status === 'livré') {
      try {
        await indexRequestToDocuments(tenantId, id, userId);
      } catch (err) {
        console.error('[request] indexation automatique échouée :', err.message);
      }
    }

    // 4. Historique d'état (machine à états)
    await insertStateHistory(tenantId, {
      requestId: id,
      userId,
      userName: req.user.full_name || null,
      action: status === 'annulé' ? 'Demande annulée' : requestStateMachine.label(status),
      previousStatus: request.statut,
      newStatus: status,
      comment: notes_internes || null,
    });

    // 5. Notification interne au demandeur
    const notificationTitle = status === 'annulé' ? 'Votre demande a été annulée' : 'Mise à jour de votre demande';
    const notificationMessage = status === 'annulé'
      ? `La demande pour ${request.nom_entreprise} a été annulée.`
      : `Le statut de la demande pour ${request.nom_entreprise} est maintenant : ${requestStateMachine.label(status)}.`;
    await notifyUser(tenantId, request.id_user, notificationTitle, notificationMessage, 'status_update', id);

    // 6. Log dans l'historique général
    await tenantDb.insert(
      tenantId,
      'audit_logs',
      ['id_user', 'action', 'request_id'],
      [userId, `A changé le statut de la demande ${request.nom_entreprise} vers ${status}`, id]
    );

    // 7. E-mail au demandeur (template par événement, accusé à la livraison)
    try {
      const requesterEmail = await getUserEmail(tenantId, request.id_user);
      if (requesterEmail) {
        await mailService.notify({
          tenantId,
          to: requesterEmail,
          event: status === 'livré' ? 'delivered' : 'status_update',
          request: { ...request, statut: status },
        });
      }
    } catch (emailErr) {
      console.error('[request] Erreur e-mail statut :', emailErr.message);
    }

    res.json({ message: 'Statut de la demande mis à jour avec succès' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la mise à jour du statut' });
  }
};

// Attribution d'une demande à un archiviste (redistribution manuelle)
exports.assignRequest = async (req, res) => {
  const { id } = req.params;
  const { assignee_id } = req.body;
  const tenantId = req.user.tenant_id;
  const userId = req.user.id;

  if (!assignee_id) {
    return res.status(400).json({ message: 'assignee_id est requis' });
  }

  try {
    // 1. Vérifier que la demande existe
    const requestResult = await tenantDb.query(
      tenantId,
      'SELECT * FROM requests WHERE id = $1',
      [id]
    );
    const request = requestResult.rows[0];
    if (!request) {
      return res.status(404).json({ message: 'Demande non trouvée' });
    }

    // 2. Vérifier que l'assigné est un membre du personnel du même tenant
    const assigneeResult = await tenantDb.query(
      tenantId,
      "SELECT id, full_name, role FROM users WHERE id = $1 AND role IN ('archiviste', 'admin', 'superadmin')",
      [assignee_id]
    );
    const assignee = assigneeResult.rows[0];
    if (!assignee) {
      return res.status(400).json({ message: 'Archiviste introuvable ou invalide' });
    }

    // 3. Mise à jour
    const queryWithTenant = 'UPDATE requests SET assignee_id = $1, assigned_at = CURRENT_TIMESTAMP WHERE id = $2 AND tenant_id = $3';
    try {
      await db.query(queryWithTenant, [assignee_id, id, tenantId]);
    } catch (err) {
      if (err.code === '42703') {
        await db.query('UPDATE requests SET assignee_id = $1, assigned_at = CURRENT_TIMESTAMP WHERE id = $2', [assignee_id, id]);
      } else {
        throw err;
      }
    }

    // 4. Historique d'état
    await insertStateHistory(tenantId, {
      requestId: id,
      userId,
      userName: req.user.full_name || null,
      action: `Assignée à ${assignee.full_name}`,
      previousStatus: request.statut,
      newStatus: request.statut,
      comment: null,
    });

    // 5. Notification interne à l'assigné
    await notifyUser(tenantId, assignee_id, 'Nouvelle demande assignée', `La demande ${request.nom_entreprise} (${request.num_dossier || ''}) vous a été assignée.`, 'request_assigned', id);

    // 6. E-mail à l'assigné
    try {
      const assigneeEmail = await getUserEmail(tenantId, assignee_id);
      if (assigneeEmail) {
        await mailService.notify({
          tenantId,
          to: assigneeEmail,
          event: 'assigned',
          request,
          assigneeName: assignee.full_name,
        });
      }
    } catch (emailErr) {
      console.error('[request] Erreur e-mail assignation :', emailErr.message);
    }

    res.json({ message: 'Demande assignée avec succès', assignee });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur lors de l'assignation de la demande" });
  }
};

// « Mes tâches » : demandes assignées à l'utilisateur connecté, encore actives
exports.getMyTasks = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const userId = req.user.id;

  try {
    const result = await db.query(
      `SELECT r.*, u.full_name as requester_name, u2.full_name as assignee_name
       FROM requests r
       JOIN users u ON r.id_user = u.id AND u.tenant_id = r.tenant_id
       LEFT JOIN users u2 ON r.assignee_id = u2.id AND u2.tenant_id = r.tenant_id
       WHERE r.tenant_id = $1 AND r.assignee_id = $2
         AND r.statut NOT IN ('livré', 'rejete', 'annulé')
       ORDER BY r.created_at DESC`,
      [tenantId, userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la récupération des tâches' });
  }
};
