// ============================================================================
// circuitService — circuits de validation (migration 034), sur le modèle des
// workflows M-Files et des processus Alfresco.
//
//   MODÈLES     un circuit = des étapes ORDONNÉES (séquentielles), chacune
//               avec ses destinataires (utilisateur, rôle ou groupe), son
//               action (visa ou information), son délai et sa règle à
//               plusieurs destinataires (« un » : la première réponse vaut ;
//               « tous » : chacun approuve). Un circuit par défaut par classe,
//               démarrable automatiquement à la création ou à l'indexation.
//   INSTANCES   un circuit lancé sur un document. Ses étapes sont recopiées au
//               démarrage : modifier le modèle ne change pas un circuit en
//               cours. Le statut du document suit la machine à états
//               (documentStateMachine) : démarrage → « en validation », visa
//               final → « prêt », refus ou annulation → « disponible ».
//               Pendant un circuit, le statut ne se change plus à la main.
//   TÂCHES      une par destinataire de l'étape en cours : approuver,
//               refuser (motif obligatoire), prendre connaissance, déléguer ;
//               un gestionnaire réassigne. Échéance = ouverture + délai ; les
//               tâches en retard sont rappelées (au plus une fois par période,
//               réglage circuits_relance_jours) par une tâche de fond.
//   VISAS       chaque décision laisse un visa : qui, quand, quelle étape,
//               quel commentaire, quelle adresse, et l'EMPREINTE SHA-256 de la
//               version du fichier visée (031). Le visa est lui-même résumé par
//               une empreinte (empreinte_visa), inscrite au journal chaîné
//               (VISA_APPROUVE / VISA_REFUSE / VISA_VU) : retoucher un visa en
//               base se verrait.
//   NOUVELLE    une version déposée pendant le circuit n'est pas couverte par
//   VERSION     les visas déjà donnés : la fiche l'affiche (« les visas
//               antérieurs portent sur la version N »). Réglage
//               circuits_nouvelle_version : « avertir » (défaut) prévient le
//               lanceur et les destinataires ; « relancer » reprend le circuit
//               à la première étape sur la nouvelle version. Le lanceur ou un
//               gestionnaire peut aussi relancer à la main.
//
// Les notifications et le journal ne font jamais échouer l'action métier :
// ils sont écrits APRÈS la validation de la transaction (voir executer).
// ============================================================================
const crypto = require('crypto');
const db = require('../config/db');
const stateMachine = require('./documentStateMachine');
const documentAuditService = require('./documentAuditService');
const aclService = require('./aclService');
const roleService = require('./roleService');
const settingsService = require('./settingsService');
const classeService = require('./classeService');
const { logHistory } = require('./documentIndexService');
const { identite } = require('./integriteService');

const TYPES_ASSIGNATION = ['utilisateur', 'role', 'groupe'];
const ACTIONS = ['visa', 'information'];
const REGLES = ['un', 'tous'];
const MAX_ETAPES = 20;
// Statuts depuis lesquels un document se soumet à validation (machine à
// états : « à indexer » et « disponible » mènent à « en validation »).
const STATUTS_SOUMISSIBLES = ['à indexer', 'disponible', 'en validation'];
// Décision demandée → statut de la tâche et décision du visa.
const DECISIONS = {
  approuver: { tache: 'approuvée', visa: 'approuvé', action: 'visa', audit: 'VISA_APPROUVE' },
  refuser: { tache: 'refusée', visa: 'refusé', action: 'visa', audit: 'VISA_REFUSE' },
  prendre_connaissance: { tache: 'vue', visa: 'vu', action: 'information', audit: 'VISA_VU' },
};
const ACTIONS_VISA = Object.values(DECISIONS).map((d) => d.audit);
// Tâches remplacées par une autre (délégation, réassignation) ou closes :
// elles ne comptent plus dans l'issue d'une étape.
const STATUTS_HORS_JEU = ['déléguée', 'réassignée', 'close'];

const erreur = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

// La migration 034 est-elle passée ? Vérifié une fois (même précaution que
// integriteService.migrationPassee : le code peut précéder la migration de
// quelques secondes au démarrage).
let migrationPromesse = null;
function migrationPassee() {
  if (!migrationPromesse) {
    migrationPromesse = db.query("SELECT to_regclass('circuit_visas') IS NOT NULL AS ok")
      .then((r) => {
        if (!r.rows[0].ok) migrationPromesse = null;
        return r.rows[0].ok;
      })
      .catch(() => { migrationPromesse = null; return false; });
  }
  return migrationPromesse;
}

// ------------------------------------------------------------ fonctions pures

const texte = (v) => (v === null || v === undefined ? '' : String(v).trim());
const entierPositif = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Valide et normalise un modèle de circuit reçu de l'interface. Pure : les
 * références (classe, destinataires) sont vérifiées en base ensuite.
 * @throws {Error} status 400, message lisible.
 */
function validerModele(corps = {}) {
  const nom = texte(corps.nom);
  if (!nom) throw erreur(400, 'Le nom du circuit est obligatoire.');
  if (nom.length > 150) throw erreur(400, 'Nom trop long (150 caractères au plus).');
  const description = texte(corps.description) || null;
  if (description && description.length > 2000) throw erreur(400, 'Description trop longue (2 000 caractères au plus).');
  let classeId = null;
  if (corps.classe_id !== null && corps.classe_id !== undefined && corps.classe_id !== '') {
    classeId = entierPositif(corps.classe_id);
    if (!classeId) throw erreur(400, 'Classe de document invalide.');
  }
  const parDefaut = Boolean(corps.par_defaut);
  const auto = Boolean(corps.demarrage_auto);
  const actif = corps.actif === undefined ? true : Boolean(corps.actif);
  if (parDefaut && !classeId) throw erreur(400, "Un circuit par défaut se rattache à une classe de documents.");
  if (auto && !parDefaut) throw erreur(400, "Le démarrage automatique concerne le circuit par défaut d'une classe.");
  if (!Array.isArray(corps.etapes) || corps.etapes.length === 0) throw erreur(400, 'Un circuit compte au moins une étape.');
  if (corps.etapes.length > MAX_ETAPES) throw erreur(400, `Un circuit compte au plus ${MAX_ETAPES} étapes.`);

  const etapes = corps.etapes.map((e, i) => {
    const nomEtape = `Étape ${i + 1}`;
    const libelle = texte(e?.libelle);
    if (!libelle) throw erreur(400, `${nomEtape} : le libellé est obligatoire.`);
    if (libelle.length > 150) throw erreur(400, `${nomEtape} : libellé trop long (150 caractères au plus).`);
    const type = e.type_assignation;
    if (!TYPES_ASSIGNATION.includes(type)) throw erreur(400, `${nomEtape} : destinataire attendu (utilisateur, rôle ou groupe).`);
    const action = e.action === undefined || e.action === null || e.action === '' ? 'visa' : e.action;
    if (!ACTIONS.includes(action)) throw erreur(400, `${nomEtape} : action inconnue (visa ou information).`);
    const regle = e.regle === undefined || e.regle === null || e.regle === '' ? 'un' : e.regle;
    if (!REGLES.includes(regle)) throw erreur(400, `${nomEtape} : règle inconnue (un ou tous).`);
    let delai = null;
    if (e.delai_jours !== null && e.delai_jours !== undefined && e.delai_jours !== '') {
      delai = Number(e.delai_jours);
      if (!Number.isInteger(delai) || delai < 0 || delai > 365) throw erreur(400, `${nomEtape} : délai en jours entre 0 et 365.`);
      if (delai === 0) delai = null; // 0 = sans échéance
    }
    const etape = {
      rang: i + 1, libelle, type_assignation: type, assigne_user_id: null, assigne_role: null, assigne_groupe_id: null,
      action, delai_jours: delai, regle,
    };
    if (type === 'utilisateur') {
      etape.assigne_user_id = entierPositif(e.assigne_user_id);
      if (!etape.assigne_user_id) throw erreur(400, `${nomEtape} : choisissez l'utilisateur destinataire.`);
    } else if (type === 'groupe') {
      etape.assigne_groupe_id = entierPositif(e.assigne_groupe_id);
      if (!etape.assigne_groupe_id) throw erreur(400, `${nomEtape} : choisissez le groupe destinataire.`);
    } else {
      etape.assigne_role = texte(e.assigne_role);
      if (!etape.assigne_role || etape.assigne_role.length > 50) throw erreur(400, `${nomEtape} : choisissez le rôle destinataire.`);
    }
    return etape;
  });
  return { nom, description, classe_id: classeId, par_defaut: parDefaut, demarrage_auto: auto, actif, etapes };
}

/**
 * Issue d'une étape au vu de ses tâches : 'en cours' | 'terminée' | 'refusée'.
 *   visa        un refus suffit à refuser l'étape (quelle que soit la règle) ;
 *               « un » : une approbation la termine ; « tous » : il les faut
 *               toutes.
 *   information même chose avec la prise de connaissance (pas de refus).
 * Les tâches déléguées, réassignées ou closes sont hors jeu : une autre les
 * remplace.
 */
function issueEtape(etape, taches) {
  const actives = taches.filter((t) => !STATUTS_HORS_JEU.includes(t.statut));
  if (!actives.length) return 'en cours';
  if (etape.action === 'visa' && actives.some((t) => t.statut === 'refusée')) return 'refusée';
  const faite = etape.action === 'visa' ? 'approuvée' : 'vue';
  if (etape.regle === 'tous') return actives.every((t) => t.statut === faite) ? 'terminée' : 'en cours';
  return actives.some((t) => t.statut === faite) ? 'terminée' : 'en cours';
}

/** Échéance d'une tâche : ouverture + délai en jours (null = sans échéance). */
function echeanceDe(delaiJours, depuis = new Date()) {
  if (!delaiJours) return null;
  return new Date(depuis.getTime() + Number(delaiJours) * 86400000);
}

const estEnRetard = (t, maintenant = new Date()) => t.statut === 'à traiter' && Boolean(t.echeance_at) && new Date(t.echeance_at) < maintenant;

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

/**
 * Empreinte d'un visa : son contenu sous forme canonique (tableau JSON, liste
 * explicite). Les POINTEURS (identifiants de visa, de signataire, de tâche, de
 * fichier) sont exclus — la suppression d'un compte les remet légitimement à
 * NULL (014) ; l'identité reste couverte par le nom recopié, et le fichier par
 * son empreinte.
 */
function empreinteVisa(v) {
  return sha256(JSON.stringify([
    v.tenant_id, v.instance_id, v.document_id, v.etape_rang, v.etape_libelle, v.decision,
    v.signataire_nom, v.signataire_username || null, v.pour_le_compte_de || null, v.commentaire || null,
    v.document_version === undefined ? null : v.document_version,
    v.empreinte_sha256 ? String(v.empreinte_sha256).trim() : null,
    new Date(v.signe_at).toISOString(),
  ]));
}

/**
 * Déroulé des étapes d'une instance pour l'affichage : statut de chaque
 * étape, ses tâches et ses visas.
 */
function decrireEtapes(instance, taches = [], visas = []) {
  const courante = instance.etape_courante;
  return (instance.etapes || []).map((e) => {
    let statut;
    if (instance.statut === 'approuvé') statut = 'terminée';
    else if (e.rang < courante) statut = 'terminée';
    else if (e.rang === courante) {
      statut = { 'en cours': 'en cours', refusé: 'refusée', annulé: 'interrompue' }[instance.statut] || 'en cours';
    } else statut = instance.statut === 'en cours' ? 'à venir' : 'non atteinte';
    return {
      ...e,
      statut,
      taches: taches.filter((t) => t.etape_rang === e.rang),
      visas: visas.filter((v) => v.etape_rang === e.rang),
    };
  });
}

/**
 * Visas d'une instance qui portent sur une version ANTÉRIEURE à la version
 * courante du document : { version, nb } (la plus récente de ces versions),
 * ou null.
 */
function visasAnterieurs(visas, versionCourante) {
  if (!versionCourante) return null;
  const anciens = visas.filter((v) => v.document_version !== null && v.document_version !== undefined && v.document_version < versionCourante);
  if (!anciens.length) return null;
  return { version: Math.max(...anciens.map((v) => v.document_version)), nb: anciens.length, version_courante: versionCourante };
}

// --------------------------------------------------------------- utilitaires

async function enTransaction(fn) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Effets d'après validation (notifications, journal) : jamais bloquants. */
async function executer(effets) {
  for (const effet of effets) {
    try {
      await effet();
    } catch (err) {
      console.warn('[circuits] effet différé non appliqué :', err.message);
    }
  }
}

async function notifier(tenantId, userIds, { titre, message, documentId = null }) {
  for (const id of [...new Set(userIds.filter(Boolean))]) {
    try {
      await db.query(
        `INSERT INTO notifications (id_user, title, message, type, tenant_id, document_id)
         VALUES ($1, $2, $3, 'circuits', $4, $5)`,
        [id, titre.slice(0, 255), message, tenantId, documentId]
      );
    } catch (err) {
      console.warn('[circuits] notification non enregistrée :', err.message);
    }
  }
}

const estGestionnaire = (user) => roleService.possede(user.tenant_id, user.role, 'workflows.manage');
const peutLancer = (user) => roleService.possede(user.tenant_id, user.role, 'workflows.start');

const dateFr = (d) => new Date(d).toLocaleDateString('fr-FR', { timeZone: 'Africa/Porto-Novo' });

/** Version courante du document : la plus haute version de fichier. */
async function versionCourante(run, documentId) {
  const { rows } = await run.query(
    `SELECT id, version, empreinte_sha256 FROM document_files WHERE document_id = $1
      ORDER BY version DESC, id DESC LIMIT 1`,
    [documentId]
  );
  const f = rows[0];
  return f ? { fichier_id: f.id, version: f.version, empreinte: f.empreinte_sha256 ? f.empreinte_sha256.trim() : null } : null;
}

/**
 * Destinataires d'une étape : [{ id, nom }].
 *   utilisateur  le compte désigné, s'il est toujours de l'organisation ;
 *   rôle         les comptes portant ce rôle (users.role), rôle actif ;
 *   groupe       les membres du groupe.
 */
async function resoudreDestinataires(run, tenantId, etape) {
  let res;
  if (etape.type_assignation === 'utilisateur') {
    res = await run.query(
      'SELECT id, COALESCE(full_name, username) AS nom FROM users WHERE tenant_id = $1 AND id = $2',
      [tenantId, etape.assigne_user_id]
    );
  } else if (etape.type_assignation === 'role') {
    res = await run.query(
      `SELECT u.id, COALESCE(u.full_name, u.username) AS nom FROM users u
         JOIN roles r ON r.tenant_id = u.tenant_id AND r.key = u.role AND r.is_active
        WHERE u.tenant_id = $1 AND u.role = $2 ORDER BY u.full_name, u.id`,
      [tenantId, etape.assigne_role]
    );
  } else {
    res = await run.query(
      `SELECT DISTINCT u.id, COALESCE(u.full_name, u.username) AS nom, u.full_name FROM user_group_memberships m
         JOIN groups g ON g.id = m.group_id AND g.tenant_id = $1
         JOIN users u ON u.id = m.user_id AND u.tenant_id = $1
        WHERE g.id = $2 ORDER BY u.full_name, u.id`,
      [tenantId, etape.assigne_groupe_id]
    );
  }
  return res.rows.map((r) => ({ id: r.id, nom: r.nom }));
}

/** Comptes de l'organisation portant workflows.manage (ou le joker). */
async function gestionnaires(run, tenantId) {
  const { rows } = await run.query(
    `SELECT u.id, COALESCE(u.full_name, u.username) AS nom FROM users u
       JOIN roles r ON r.tenant_id = u.tenant_id AND r.key = u.role AND r.is_active
      WHERE u.tenant_id = $1 AND ('*' = ANY(r.permissions) OR 'workflows.manage' = ANY(r.permissions))
      ORDER BY u.id`,
    [tenantId]
  );
  return rows;
}

// --------------------------------------------------------------------- modèles

const SELECT_ETAPES = `
  SELECT e.*, u.full_name AS user_nom, g.name AS groupe_nom, r.name AS role_nom
    FROM circuit_etapes e
    LEFT JOIN users u ON u.id = e.assigne_user_id AND u.tenant_id = e.tenant_id
    LEFT JOIN groups g ON g.id = e.assigne_groupe_id AND g.tenant_id = e.tenant_id
    LEFT JOIN roles r ON r.key = e.assigne_role AND r.tenant_id = e.tenant_id`;

function versEtape(e) {
  const libelleDestinataire = e.type_assignation === 'utilisateur' ? e.user_nom
    : e.type_assignation === 'groupe' ? e.groupe_nom : (e.role_nom || e.assigne_role);
  return {
    rang: e.rang, libelle: e.libelle, type_assignation: e.type_assignation,
    assigne_user_id: e.assigne_user_id, assigne_role: e.assigne_role, assigne_groupe_id: e.assigne_groupe_id,
    assigne_libelle: libelleDestinataire || 'Destinataire supprimé',
    action: e.action, delai_jours: e.delai_jours, regle: e.regle,
  };
}

async function chargerModele(run, tenantId, id) {
  const n = entierPositif(id);
  if (!n) return null;
  const { rows } = await run.query(
    `SELECT m.*, c.name AS classe_nom FROM circuit_modeles m
       LEFT JOIN metadata_schemas c ON c.id = m.classe_id AND c.tenant_id = m.tenant_id
      WHERE m.id = $1 AND m.tenant_id = $2`,
    [n, tenantId]
  );
  if (!rows[0]) return null;
  const etapes = await run.query(`${SELECT_ETAPES} WHERE e.circuit_id = $1 ORDER BY e.rang`, [n]);
  return { ...rows[0], etapes: etapes.rows.map(versEtape) };
}

async function listerModeles(tenantId) {
  const [modeles, etapes] = await Promise.all([
    db.query(
      `SELECT m.*, c.name AS classe_nom,
              (SELECT count(*)::int FROM circuit_instances i WHERE i.circuit_id = m.id AND i.statut = 'en cours') AS en_cours,
              (SELECT count(*)::int FROM circuit_instances i WHERE i.circuit_id = m.id) AS lances
         FROM circuit_modeles m
         LEFT JOIN metadata_schemas c ON c.id = m.classe_id AND c.tenant_id = m.tenant_id
        WHERE m.tenant_id = $1 ORDER BY m.nom`,
      [tenantId]
    ),
    db.query(`${SELECT_ETAPES} WHERE e.tenant_id = $1 ORDER BY e.circuit_id, e.rang`, [tenantId]),
  ]);
  return modeles.rows.map((m) => ({ ...m, etapes: etapes.rows.filter((e) => e.circuit_id === m.id).map(versEtape) }));
}

/** Les références d'un modèle (classe, destinataires) sont-elles de l'organisation ? */
async function verifierReferences(run, tenantId, modele) {
  if (modele.classe_id && !(await classeService.classe(tenantId, modele.classe_id, run))) {
    throw erreur(400, 'Classe de document inconnue.');
  }
  for (const e of modele.etapes) {
    let ok;
    if (e.type_assignation === 'utilisateur') {
      ok = (await run.query('SELECT 1 FROM users WHERE id = $1 AND tenant_id = $2', [e.assigne_user_id, tenantId])).rowCount;
    } else if (e.type_assignation === 'groupe') {
      ok = (await run.query('SELECT 1 FROM groups WHERE id = $1 AND tenant_id = $2', [e.assigne_groupe_id, tenantId])).rowCount;
    } else {
      ok = (await run.query('SELECT 1 FROM roles WHERE key = $1 AND tenant_id = $2', [e.assigne_role, tenantId])).rowCount;
    }
    if (!ok) throw erreur(400, `Étape ${e.rang} : destinataire inconnu dans votre organisation.`);
  }
}

/**
 * Crée (id null) ou remplace un modèle, étapes comprises. Déclarer un circuit
 * « par défaut » pour une classe retire ce rôle au précédent (un seul par
 * classe).
 */
async function enregistrerModele(tenantId, id, corps, user) {
  const modele = validerModele(corps);
  try {
    const circuitId = await enTransaction(async (run) => {
      await verifierReferences(run, tenantId, modele);
      if (id !== null) {
        const n = entierPositif(id);
        const existe = n && (await run.query('SELECT id FROM circuit_modeles WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [n, tenantId])).rows[0];
        if (!existe) throw erreur(404, 'Circuit introuvable.');
      }
      if (modele.par_defaut) {
        await run.query(
          `UPDATE circuit_modeles SET par_defaut = false, demarrage_auto = false, modifie_at = now()
            WHERE tenant_id = $1 AND classe_id = $2 AND par_defaut AND ($3::int IS NULL OR id <> $3)`,
          [tenantId, modele.classe_id, id === null ? null : Number(id)]
        );
      }
      let cid;
      if (id === null) {
        const { rows } = await run.query(
          `INSERT INTO circuit_modeles (tenant_id, nom, description, classe_id, par_defaut, demarrage_auto, actif, cree_par)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [tenantId, modele.nom, modele.description, modele.classe_id, modele.par_defaut, modele.demarrage_auto, modele.actif, user?.id || null]
        );
        cid = rows[0].id;
      } else {
        cid = Number(id);
        await run.query(
          `UPDATE circuit_modeles SET nom = $3, description = $4, classe_id = $5, par_defaut = $6, demarrage_auto = $7,
                  actif = $8, modifie_at = now()
            WHERE id = $1 AND tenant_id = $2`,
          [cid, tenantId, modele.nom, modele.description, modele.classe_id, modele.par_defaut, modele.demarrage_auto, modele.actif]
        );
        // Les instances ont leur copie des étapes : remplacer celles du modèle
        // ne touche aucun circuit en cours.
        await run.query('DELETE FROM circuit_etapes WHERE circuit_id = $1', [cid]);
      }
      for (const e of modele.etapes) {
        await run.query(
          `INSERT INTO circuit_etapes (tenant_id, circuit_id, rang, libelle, type_assignation, assigne_user_id, assigne_role,
                                       assigne_groupe_id, action, delai_jours, regle)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [tenantId, cid, e.rang, e.libelle, e.type_assignation, e.assigne_user_id, e.assigne_role, e.assigne_groupe_id,
            e.action, e.delai_jours, e.regle]
        );
      }
      return cid;
    });
    return chargerModele(db, tenantId, circuitId);
  } catch (err) {
    if (err.code === '23505') throw erreur(409, 'Un circuit de votre organisation porte déjà ce nom.', 'NOM_PRIS');
    throw err;
  }
}

const creerModele = (tenantId, corps, user) => enregistrerModele(tenantId, null, corps, user);
const modifierModele = (tenantId, id, corps, user) => enregistrerModele(tenantId, id, corps, user);

/** Supprime un modèle : les circuits lancés gardent leur copie des étapes. */
async function supprimerModele(tenantId, id) {
  const n = entierPositif(id);
  if (!n) throw erreur(404, 'Circuit introuvable.');
  const { rowCount } = await db.query('DELETE FROM circuit_modeles WHERE id = $1 AND tenant_id = $2', [n, tenantId]);
  if (!rowCount) throw erreur(404, 'Circuit introuvable.');
}

/**
 * Ce que l'éditeur de circuits propose : classes, comptes, rôles, groupes.
 * Servi sous workflows.manage — l'archiviste configure sans users.view ni
 * roles.view (identifiant, nom et rôle seulement).
 */
async function referentiel(tenantId) {
  const [classes, utilisateurs, roles, groupes] = await Promise.all([
    db.query(`SELECT id, name, code FROM metadata_schemas WHERE tenant_id = $1 AND is_default IS NOT TRUE ORDER BY name`, [tenantId]),
    db.query(`SELECT id, full_name, username, role FROM users WHERE tenant_id = $1 ORDER BY full_name, id`, [tenantId]),
    db.query(
      `SELECT r.key, r.name, (SELECT count(*)::int FROM users u WHERE u.tenant_id = r.tenant_id AND u.role = r.key) AS nb
         FROM roles r WHERE r.tenant_id = $1 AND r.is_active AND r.key <> 'superadmin' ORDER BY r.name`,
      [tenantId]
    ),
    db.query(
      `SELECT g.id, g.name, (SELECT count(*)::int FROM user_group_memberships m WHERE m.group_id = g.id) AS nb
         FROM groups g WHERE g.tenant_id = $1 ORDER BY g.name`,
      [tenantId]
    ),
  ]);
  return { classes: classes.rows, utilisateurs: utilisateurs.rows, roles: roles.rows, groupes: groupes.rows };
}

// ------------------------------------------------------------------- instances

async function instanceActive(tenantId, documentId, run = db) {
  if (!(await migrationPassee())) return null;
  const { rows } = await run.query(
    "SELECT * FROM circuit_instances WHERE tenant_id = $1 AND document_id = $2 AND statut = 'en cours'",
    [tenantId, Number(documentId)]
  );
  return rows[0] || null;
}

/**
 * Change le statut du document en suivant la machine à états, avec son
 * historique. Une transition impossible (statut modifié entre-temps) ne fait
 * pas échouer la décision : l'historique le dit.
 */
async function suivreStatut(run, tenantId, documentId, vers, userId, libelle, commentaire) {
  const { rows } = await run.query('SELECT statut FROM documents WHERE id = $1 AND tenant_id = $2', [documentId, tenantId]);
  const de = rows[0]?.statut;
  if (de === vers) {
    await logHistory(tenantId, documentId, userId, libelle.slice(0, 100), null, null, commentaire, run);
    return false;
  }
  if (!stateMachine.canTransition(de, vers).ok) {
    await logHistory(tenantId, documentId, userId, `${libelle} — statut inchangé`.slice(0, 100), null, null, commentaire, run);
    return false;
  }
  await run.query('UPDATE documents SET statut = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND tenant_id = $3', [vers, documentId, tenantId]);
  await logHistory(tenantId, documentId, userId, libelle.slice(0, 100), de, vers, commentaire, run);
  return true;
}

/**
 * Ouvre une étape : une tâche par destinataire. Sans destinataire (compte ou
 * groupe vidé depuis le démarrage), l'étape est confiée aux gestionnaires des
 * circuits — à défaut au lanceur — plutôt que de bloquer le circuit.
 */
async function ouvrirEtape(run, tenantId, instance, rang, reference, effets) {
  const etape = instance.etapes.find((e) => e.rang === rang);
  let cibles = await resoudreDestinataires(run, tenantId, etape);
  let secours = false;
  if (!cibles.length) {
    secours = true;
    cibles = await gestionnaires(run, tenantId);
    if (!cibles.length && instance.demarre_par) cibles = [{ id: instance.demarre_par, nom: instance.demarre_par_nom }];
  }
  const echeance = echeanceDe(etape.delai_jours);
  for (const c of cibles) {
    await run.query(
      `INSERT INTO circuit_taches (tenant_id, instance_id, document_id, etape_rang, action, assigne_a, assigne_nom, echeance_at, secours)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [tenantId, instance.id, instance.document_id, rang, etape.action, c.id, c.nom, echeance, secours]
    );
  }
  await run.query('UPDATE circuit_instances SET etape_courante = $1 WHERE id = $2', [rang, instance.id]);
  const nb = instance.etapes.length;
  effets.push(() => notifier(tenantId, cibles.map((c) => c.id), {
    titre: `${etape.action === 'visa' ? 'Visa demandé' : 'Pour information'} : ${reference}`,
    message: `Circuit « ${instance.circuit_nom} » — étape ${rang}/${nb} « ${etape.libelle} »`
      + `${echeance ? `, à traiter avant le ${dateFr(echeance)}` : ''}.`
      + `${secours ? " Aucun destinataire n'a été trouvé pour cette étape : elle vous est confiée en tant que gestionnaire des circuits." : ''}`,
    documentId: instance.document_id,
  }));
  return cibles;
}

/** Copie des étapes d'un modèle, figée dans l'instance. */
const copieEtapes = (modele) => modele.etapes.map((e) => ({
  rang: e.rang, libelle: e.libelle, type_assignation: e.type_assignation, assigne_user_id: e.assigne_user_id,
  assigne_role: e.assigne_role, assigne_groupe_id: e.assigne_groupe_id, assigne_libelle: e.assigne_libelle,
  action: e.action, delai_jours: e.delai_jours, regle: e.regle,
}));

async function verifierDestinataires(run, tenantId, etapes) {
  for (const e of etapes) {
    if (!(await resoudreDestinataires(run, tenantId, e)).length) {
      throw erreur(409, `L'étape « ${e.libelle} » n'a aucun destinataire (compte, rôle ou groupe vide) : corrigez le circuit.`, 'DESTINATAIRE_MANQUANT');
    }
  }
}

async function creerInstance(run, { tenantId, doc, circuitId, circuitNom, etapes, qui, origine, relanceDe = null, effets }) {
  const v = await versionCourante(run, doc.id);
  const { rows } = await run.query(
    `INSERT INTO circuit_instances (tenant_id, document_id, circuit_id, circuit_nom, etapes, demarrage, demarre_par, demarre_par_nom,
                                    version_depart, empreinte_depart, statut_document_avant, relance_de)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [tenantId, doc.id, circuitId, circuitNom, JSON.stringify(etapes), origine, qui.id, qui.nom,
      v?.version || null, v?.empreinte || null, doc.statut, relanceDe]
  );
  const instance = rows[0];
  await ouvrirEtape(run, tenantId, instance, 1, doc.reference_mfile, effets);
  return { ...instance, etape_courante: 1 };
}

async function verrouillerDocument(run, tenantId, documentId) {
  const { rows } = await run.query(
    'SELECT id, statut, deleted_at, classe_id, dossier_id, reference_mfile FROM documents WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
    [documentId, tenantId]
  );
  const doc = rows[0];
  if (!doc) throw erreur(404, 'Document introuvable.');
  if (doc.deleted_at) throw erreur(409, 'Ce document est en corbeille.', 'EN_CORBEILLE');
  return doc;
}

const auditer = (tenantId, documentId, qui, action, details, ip = null) => documentAuditService.logAction({
  tenantId, documentId, userId: qui.id, username: qui.username, action, details, ipAddress: ip,
});

/**
 * Lance un circuit sur un document (manuel ou automatique). Sans circuitId :
 * le circuit par défaut de la classe du document.
 */
async function demarrer(tenantId, documentId, { circuitId = null, user, ip = null, origine = 'manuel' } = {}) {
  if (!(await migrationPassee())) throw erreur(503, 'Les circuits de validation ne sont pas encore installés (migration 034).');
  const qui = await identite(user);
  const effets = [];
  let instance;
  try {
    instance = await enTransaction(async (run) => {
      const doc = await verrouillerDocument(run, tenantId, Number(documentId));
      if (!STATUTS_SOUMISSIBLES.includes(doc.statut)) {
        throw erreur(409, `Un document « ${stateMachine.label(doc.statut)} » ne se soumet pas à validation.`, 'STATUT_INCOMPATIBLE');
      }
      if ((await run.query("SELECT 1 FROM circuit_instances WHERE document_id = $1 AND statut = 'en cours'", [doc.id])).rowCount) {
        throw erreur(409, 'Un circuit de validation est déjà en cours sur ce document.', 'CIRCUIT_EN_COURS');
      }
      let modele;
      if (circuitId) {
        modele = await chargerModele(run, tenantId, circuitId);
        if (!modele) throw erreur(404, 'Circuit introuvable.');
        if (!modele.actif) throw erreur(409, 'Ce circuit est désactivé.', 'CIRCUIT_INACTIF');
      } else {
        const { rows } = doc.classe_id ? await run.query(
          'SELECT id FROM circuit_modeles WHERE tenant_id = $1 AND classe_id = $2 AND par_defaut AND actif', [tenantId, doc.classe_id]) : { rows: [] };
        if (!rows[0]) throw erreur(400, "Aucun circuit par défaut pour la classe de ce document : choisissez un circuit.", 'SANS_CIRCUIT');
        modele = await chargerModele(run, tenantId, rows[0].id);
      }
      const etapes = copieEtapes(modele);
      if (!etapes.length) throw erreur(409, "Ce circuit n'a aucune étape.", 'CIRCUIT_VIDE');
      await verifierDestinataires(run, tenantId, etapes);
      const inst = await creerInstance(run, {
        tenantId, doc, circuitId: modele.id, circuitNom: modele.nom, etapes, qui, origine, effets,
      });
      await suivreStatut(run, tenantId, doc.id, 'en validation', user?.id || null,
        `Circuit « ${modele.nom} » démarré${origine === 'automatique' ? ' (automatique)' : ''}`, null);
      return { ...inst, reference: doc.reference_mfile };
    });
  } catch (err) {
    if (err.code === '23505') throw erreur(409, 'Un circuit de validation est déjà en cours sur ce document.', 'CIRCUIT_EN_COURS');
    throw err;
  }
  effets.push(() => auditer(tenantId, instance.document_id, qui, 'CIRCUIT_DEMARRE', {
    instance_id: instance.id, circuit: instance.circuit_nom, origine, version: instance.version_depart, empreinte_sha256: instance.empreinte_depart,
  }, ip));
  await executer(effets);
  return instance;
}

/**
 * Démarrage automatique (création, sortie de « à indexer ») : le circuit par
 * défaut de la classe, s'il est marqué « démarrage automatique ». Ne lève
 * jamais : la création ou l'indexation ne doit pas échouer pour lui. Un échec
 * (étape sans destinataire…) est signalé aux gestionnaires des circuits.
 * @returns {Promise<{id, circuit_nom}|null>}
 */
async function demarrageAutomatique(tenantId, documentId, user, { ip = null } = {}) {
  let candidat = null;
  try {
    if (!(await migrationPassee())) return null;
    const { rows } = await db.query(
      `SELECT d.statut, d.deleted_at, d.reference_mfile, m.id AS circuit_id, m.nom
         FROM documents d
         JOIN circuit_modeles m ON m.tenant_id = d.tenant_id AND m.classe_id = d.classe_id
                               AND m.par_defaut AND m.demarrage_auto AND m.actif
        WHERE d.id = $1 AND d.tenant_id = $2`,
      [Number(documentId), tenantId]
    );
    candidat = rows[0];
    if (!candidat || candidat.deleted_at || !['disponible', 'en validation'].includes(candidat.statut)) return null;
    if (await instanceActive(tenantId, documentId)) return null;
    const inst = await demarrer(tenantId, documentId, { circuitId: candidat.circuit_id, user, ip, origine: 'automatique' });
    return { id: inst.id, circuit_nom: inst.circuit_nom };
  } catch (err) {
    console.warn(`[circuits] démarrage automatique impossible (document ${documentId}) : ${err.message}`);
    if (candidat && err.status && err.code !== 'CIRCUIT_EN_COURS') {
      await notifier(tenantId, (await gestionnaires(db, tenantId).catch(() => [])).map((g) => g.id), {
        titre: `Circuit non démarré : ${candidat.reference_mfile}`,
        message: `Le circuit « ${candidat.nom} » n'a pas pu démarrer automatiquement : ${err.message}`,
        documentId: Number(documentId),
      });
    }
    return null;
  }
}

/**
 * Verrouille une tâche pour agir dessus. L'INSTANCE est verrouillée d'abord :
 * toute action sur les tâches d'une instance passe par ce verrou, ce qui
 * sérialise deux décisions simultanées sur une même étape (règle « un ») sans
 * interblocage.
 */
async function verrouillerTache(run, tenantId, tacheId) {
  const n = entierPositif(tacheId);
  const t0 = n && (await run.query('SELECT instance_id FROM circuit_taches WHERE id = $1 AND tenant_id = $2', [n, tenantId])).rows[0];
  if (!t0) throw erreur(404, 'Tâche introuvable.');
  const instance = (await run.query('SELECT * FROM circuit_instances WHERE id = $1 FOR UPDATE', [t0.instance_id])).rows[0];
  const tache = (await run.query('SELECT * FROM circuit_taches WHERE id = $1 FOR UPDATE', [n])).rows[0];
  const doc = (await run.query(
    'SELECT id, statut, deleted_at, reference_mfile, dossier_id FROM documents WHERE id = $1 AND tenant_id = $2', [instance.document_id, tenantId])).rows[0];
  return { instance, tache, doc };
}

function verifierOuverte({ instance, tache, doc }) {
  if (tache.statut !== 'à traiter') throw erreur(409, 'Cette tâche a déjà été traitée.', 'DEJA_TRAITEE');
  if (instance.statut !== 'en cours') throw erreur(409, "Ce circuit n'est plus en cours.", 'CIRCUIT_TERMINE');
  if (tache.etape_rang !== instance.etape_courante) throw erreur(409, "Cette étape n'est plus l'étape en cours.", 'ETAPE_CLOSE');
  if (!doc || doc.deleted_at) throw erreur(409, 'Le document est en corbeille : restaurez-le pour poursuivre la validation.', 'EN_CORBEILLE');
}

/** Clôt un circuit : tâches ouvertes closes, statut du document suivi. */
async function conclure(run, tenantId, instance, statut, { qui, motif = null }) {
  await run.query("UPDATE circuit_taches SET statut = 'close' WHERE instance_id = $1 AND statut = 'à traiter'", [instance.id]);
  await run.query(
    `UPDATE circuit_instances SET statut = $2, termine_at = now(), termine_par = $3, termine_par_nom = $4, motif_fin = $5
      WHERE id = $1`,
    [instance.id, statut, qui.id, qui.nom, motif]
  );
  const vers = statut === 'approuvé' ? 'prêt' : 'disponible';
  const libelle = { approuvé: `Circuit « ${instance.circuit_nom} » approuvé`, refusé: `Circuit « ${instance.circuit_nom} » refusé`,
    annulé: `Circuit « ${instance.circuit_nom} » annulé` }[statut];
  await suivreStatut(run, tenantId, instance.document_id, vers, qui.id, libelle, motif ? motif.slice(0, 2000) : null);
}

/**
 * Décision d'un destinataire sur sa tâche : approuver, refuser (motif
 * obligatoire) ou prendre connaissance. Enregistre le visa (empreinte de la
 * version courante), fait avancer le circuit.
 */
async function decider(tenantId, tacheId, { decision, commentaire } = {}, user, { ip = null } = {}) {
  if (!(await migrationPassee())) throw erreur(503, 'Les circuits de validation ne sont pas encore installés (migration 034).');
  const d = DECISIONS[decision];
  if (!d) throw erreur(400, 'Décision attendue : approuver, refuser ou prendre_connaissance.');
  const note = texte(commentaire) || null;
  if (note && note.length > 2000) throw erreur(400, 'Commentaire trop long (2 000 caractères au plus).');
  if (decision === 'refuser' && !note) throw erreur(400, 'Le motif du refus est obligatoire.', 'MOTIF_REQUIS');
  const qui = await identite(user);
  const effets = [];
  const resultat = await enTransaction(async (run) => {
    const ctx = await verrouillerTache(run, tenantId, tacheId);
    const { instance, tache, doc } = ctx;
    if (tache.assigne_a !== user.id) throw erreur(403, "Vous n'êtes pas destinataire de cette tâche.", 'NON_DESTINATAIRE');
    verifierOuverte(ctx);
    const etape = instance.etapes.find((e) => e.rang === tache.etape_rang);
    if (etape.action !== d.action) {
      throw erreur(400, etape.action === 'visa' ? 'Cette étape demande un visa : approuver ou refuser.' : 'Cette étape est pour information : prenez-en connaissance.');
    }

    // Le visa porte sur la version COURANTE, empreinte comprise.
    const v = await versionCourante(run, doc.id);
    await run.query(
      `UPDATE circuit_taches SET statut = $2, traite_at = now(), traite_par = $3, traite_par_nom = $4, commentaire = $5 WHERE id = $1`,
      [tache.id, d.tache, qui.id, qui.nom, note]
    );
    const visa = {
      tenant_id: tenantId, instance_id: instance.id, document_id: doc.id, etape_rang: etape.rang, etape_libelle: etape.libelle,
      decision: d.visa, signataire_nom: qui.nom, signataire_username: qui.username, pour_le_compte_de: tache.pour_le_compte_de,
      commentaire: note, document_version: v?.version ?? null, empreinte_sha256: v?.empreinte || null, signe_at: new Date(),
    };
    visa.empreinte_visa = empreinteVisa(visa);
    const { rows: [visaLigne] } = await run.query(
      `INSERT INTO circuit_visas (tenant_id, instance_id, document_id, tache_id, etape_rang, etape_libelle, decision, signataire_id,
                                  signataire_nom, signataire_username, pour_le_compte_de, commentaire, ip_address, fichier_id,
                                  document_version, empreinte_sha256, empreinte_visa, signe_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING id`,
      [tenantId, instance.id, doc.id, tache.id, etape.rang, etape.libelle, d.visa, qui.id, qui.nom, qui.username,
        tache.pour_le_compte_de, note, ip, v?.fichier_id || null, visa.document_version, visa.empreinte_sha256, visa.empreinte_visa, visa.signe_at]
    );
    const libelleVisa = { approuvé: 'Visa : approuvé', refusé: 'Visa : refusé', vu: 'Pris connaissance' }[d.visa];
    await logHistory(tenantId, doc.id, qui.id, `${libelleVisa} — ${etape.libelle}`.slice(0, 100), null, null, note, run);

    // L'étape est-elle close ?
    const { rows: taches } = await run.query('SELECT statut FROM circuit_taches WHERE instance_id = $1 AND etape_rang = $2', [instance.id, etape.rang]);
    const issue = issueEtape(etape, taches);
    let suite = { instance: 'en cours', etape: etape.rang };
    if (issue === 'refusée') {
      await conclure(run, tenantId, instance, 'refusé', { qui, motif: note });
      suite = { instance: 'refusé' };
    } else if (issue === 'terminée') {
      await run.query("UPDATE circuit_taches SET statut = 'close' WHERE instance_id = $1 AND etape_rang = $2 AND statut = 'à traiter'", [instance.id, etape.rang]);
      const prochaine = instance.etapes.find((e) => e.rang === etape.rang + 1);
      if (prochaine) {
        await ouvrirEtape(run, tenantId, instance, prochaine.rang, doc.reference_mfile, effets);
        suite = { instance: 'en cours', etape: prochaine.rang };
      } else {
        await conclure(run, tenantId, instance, 'approuvé', { qui });
        suite = { instance: 'approuvé' };
      }
    }

    effets.unshift(() => auditer(tenantId, doc.id, qui, d.audit, {
      visa_id: visaLigne.id, instance_id: instance.id, circuit: instance.circuit_nom, etape: etape.rang, etape_libelle: etape.libelle,
      decision: d.visa, version: visa.document_version, fichier_id: v?.fichier_id || null, empreinte_sha256: visa.empreinte_sha256,
      empreinte_visa: visa.empreinte_visa, pour_le_compte_de: tache.pour_le_compte_de || null,
      ...(note ? { commentaire: note.slice(0, 500) } : {}),
    }, ip));
    if (suite.instance !== 'en cours') {
      effets.push(() => auditer(tenantId, doc.id, qui, suite.instance === 'approuvé' ? 'CIRCUIT_APPROUVE' : 'CIRCUIT_REFUSE', {
        instance_id: instance.id, circuit: instance.circuit_nom, ...(note && suite.instance === 'refusé' ? { motif: note.slice(0, 500) } : {}),
      }, ip));
      effets.push(() => notifier(tenantId, instance.demarre_par && instance.demarre_par !== qui.id ? [instance.demarre_par] : [], {
        titre: suite.instance === 'approuvé' ? `Circuit approuvé : ${doc.reference_mfile}` : `Circuit refusé : ${doc.reference_mfile}`,
        message: suite.instance === 'approuvé'
          ? `Le circuit « ${instance.circuit_nom} » est terminé : le document est prêt.`
          : `${qui.nom} a refusé l'étape « ${etape.libelle} » du circuit « ${instance.circuit_nom} » : ${note}. Le document est de nouveau disponible pour correction.`,
        documentId: doc.id,
      }));
    }
    return {
      visa: { id: visaLigne.id, decision: d.visa, document_version: visa.document_version, empreinte_sha256: visa.empreinte_sha256, empreinte_visa: visa.empreinte_visa, signe_at: visa.signe_at },
      suite, document_id: doc.id,
    };
  });
  await executer(effets);
  return resultat;
}

/**
 * Délégation (par le destinataire) ou réassignation (par un gestionnaire) :
 * la tâche est close et remplacée par une tâche du nouvel attributaire, même
 * étape, même échéance. La délégation garde trace du titulaire (« pour le
 * compte de »).
 */
async function transferer(tenantId, tacheId, { utilisateur_id: cibleBrute, commentaire } = {}, user, mode, { ip = null } = {}) {
  if (!(await migrationPassee())) throw erreur(503, 'Les circuits de validation ne sont pas encore installés (migration 034).');
  const cibleId = entierPositif(cibleBrute);
  if (!cibleId) throw erreur(400, 'Choisissez la personne à qui confier la tâche.');
  const note = texte(commentaire) || null;
  if (note && note.length > 2000) throw erreur(400, 'Commentaire trop long (2 000 caractères au plus).');
  const delegation = mode === 'délégation';
  const qui = await identite(user);
  const effets = [];
  const resultat = await enTransaction(async (run) => {
    const ctx = await verrouillerTache(run, tenantId, tacheId);
    const { instance, tache, doc } = ctx;
    if (delegation && tache.assigne_a !== user.id) throw erreur(403, "Vous n'êtes pas destinataire de cette tâche.", 'NON_DESTINATAIRE');
    if (!delegation) {
      if (!(await estGestionnaire(user))) throw erreur(403, 'Réassigner une tâche est réservé aux gestionnaires des circuits.', 'PERMISSION_REFUSEE');
      if (doc && !(await aclService.peutLire(tenantId, user.id, doc.dossier_id))) {
        throw erreur(403, 'Ce document appartient à un dossier hors de votre périmètre.', 'HORS_PERIMETRE');
      }
    }
    verifierOuverte(ctx);
    const cible = (await run.query('SELECT id, COALESCE(full_name, username) AS nom FROM users WHERE id = $1 AND tenant_id = $2', [cibleId, tenantId])).rows[0];
    if (!cible) throw erreur(404, 'Utilisateur introuvable dans votre organisation.');
    if (cible.id === tache.assigne_a) throw erreur(400, 'Cette tâche lui est déjà confiée.');
    if (delegation && cible.id === user.id) throw erreur(400, 'Vous ne pouvez pas vous déléguer une tâche.');
    const dejaLa = await run.query(
      "SELECT 1 FROM circuit_taches WHERE instance_id = $1 AND etape_rang = $2 AND assigne_a = $3 AND statut = 'à traiter'",
      [instance.id, tache.etape_rang, cible.id]
    );
    if (dejaLa.rowCount) throw erreur(409, `${cible.nom} a déjà une tâche ouverte à cette étape.`, 'DEJA_DESTINATAIRE');

    await run.query(
      `UPDATE circuit_taches SET statut = $2, traite_at = now(), traite_par = $3, traite_par_nom = $4, commentaire = $5 WHERE id = $1`,
      [tache.id, delegation ? 'déléguée' : 'réassignée', qui.id, qui.nom, note]
    );
    const pourLeCompteDe = delegation ? (tache.pour_le_compte_de || tache.assigne_nom) : null;
    const { rows: [nouvelle] } = await run.query(
      `INSERT INTO circuit_taches (tenant_id, instance_id, document_id, etape_rang, action, assigne_a, assigne_nom, echeance_at,
                                   pour_le_compte_de, origine_tache_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [tenantId, instance.id, doc.id, tache.etape_rang, tache.action, cible.id, cible.nom, tache.echeance_at, pourLeCompteDe, tache.id]
    );
    const etape = instance.etapes.find((e) => e.rang === tache.etape_rang);
    await logHistory(tenantId, doc.id, qui.id,
      `${delegation ? 'Tâche déléguée' : 'Tâche réassignée'} à ${cible.nom} — ${etape.libelle}`.slice(0, 100), null, null, note, run);
    effets.push(() => auditer(tenantId, doc.id, qui, delegation ? 'TACHE_DELEGUEE' : 'TACHE_REASSIGNEE', {
      instance_id: instance.id, tache_id: tache.id, nouvelle_tache_id: nouvelle.id, etape: etape.rang,
      de: tache.assigne_nom, a: cible.nom, ...(note ? { commentaire: note.slice(0, 500) } : {}),
    }, ip));
    effets.push(() => notifier(tenantId, [cible.id], {
      titre: `${etape.action === 'visa' ? 'Visa demandé' : 'Pour information'} : ${doc.reference_mfile}`,
      message: `${qui.nom} vous ${delegation ? 'délègue' : 'confie'} l'étape « ${etape.libelle} » du circuit « ${instance.circuit_nom} »`
        + `${pourLeCompteDe ? ` (pour le compte de ${pourLeCompteDe})` : ''}${note ? ` : ${note}` : '.'}`,
      documentId: doc.id,
    }));
    if (!delegation && tache.assigne_a && tache.assigne_a !== qui.id) {
      effets.push(() => notifier(tenantId, [tache.assigne_a], {
        titre: `Tâche réassignée : ${doc.reference_mfile}`,
        message: `Votre tâche « ${etape.libelle} » a été confiée à ${cible.nom} par ${qui.nom}.`,
        documentId: doc.id,
      }));
    }
    return { tache_id: nouvelle.id, assigne_a: cible.id, assigne_nom: cible.nom };
  });
  await executer(effets);
  return resultat;
}

const deleguer = (tenantId, tacheId, corps, user, opts) => transferer(tenantId, tacheId, corps, user, 'délégation', opts);
const reassigner = (tenantId, tacheId, corps, user, opts) => transferer(tenantId, tacheId, corps, user, 'réassignation', opts);

/** Le lanceur (s'il peut lancer) ou un gestionnaire. */
async function peutPiloter(user, instance) {
  if (await estGestionnaire(user)) return true;
  return instance.demarre_par === user.id && (await peutLancer(user));
}

/** Annulation d'un circuit en cours (motif obligatoire) : document « disponible ». */
async function annuler(tenantId, documentId, { motif } = {}, user, { ip = null } = {}) {
  if (!(await migrationPassee())) throw erreur(503, 'Les circuits de validation ne sont pas encore installés (migration 034).');
  const m = texte(motif);
  if (!m) throw erreur(400, "Le motif de l'annulation est obligatoire.", 'MOTIF_REQUIS');
  if (m.length > 2000) throw erreur(400, 'Motif trop long (2 000 caractères au plus).');
  const qui = await identite(user);
  const effets = [];
  const resultat = await enTransaction(async (run) => {
    const { rows } = await run.query(
      "SELECT * FROM circuit_instances WHERE tenant_id = $1 AND document_id = $2 AND statut = 'en cours' FOR UPDATE", [tenantId, Number(documentId)]);
    const instance = rows[0];
    if (!instance) throw erreur(404, "Aucun circuit en cours sur ce document.", 'AUCUN_CIRCUIT');
    if (!(await peutPiloter(user, instance))) {
      throw erreur(403, "Seul le lanceur du circuit ou un gestionnaire des circuits peut l'annuler.", 'PERMISSION_REFUSEE');
    }
    const ouvertes = (await run.query("SELECT assigne_a FROM circuit_taches WHERE instance_id = $1 AND statut = 'à traiter'", [instance.id])).rows;
    const ref = (await run.query('SELECT reference_mfile FROM documents WHERE id = $1', [instance.document_id])).rows[0]?.reference_mfile;
    await conclure(run, tenantId, instance, 'annulé', { qui, motif: m });
    effets.push(() => auditer(tenantId, instance.document_id, qui, 'CIRCUIT_ANNULE', { instance_id: instance.id, circuit: instance.circuit_nom, motif: m.slice(0, 500) }, ip));
    effets.push(() => notifier(tenantId, [...ouvertes.map((t) => t.assigne_a), instance.demarre_par].filter((id) => id && id !== qui.id), {
      titre: `Circuit annulé : ${ref}`,
      message: `${qui.nom} a annulé le circuit « ${instance.circuit_nom} » : ${m}`,
      documentId: instance.document_id,
    }));
    return { instance_id: instance.id, statut: 'annulé' };
  });
  await executer(effets);
  return resultat;
}

/**
 * Relance : le circuit en cours est annulé et repris à la première étape sur
 * la version COURANTE du document — avec les étapes actuelles du modèle s'il
 * existe encore et reste actif, sinon avec celles de l'instance relancée.
 * Le document reste « en validation ». automatique : relance déclenchée par
 * le dépôt d'une version (réglage circuits_nouvelle_version), sans contrôle
 * de pilotage.
 */
async function relancer(tenantId, documentId, { motif } = {}, user, { ip = null, automatique = false } = {}) {
  if (!(await migrationPassee())) throw erreur(503, 'Les circuits de validation ne sont pas encore installés (migration 034).');
  const m = texte(motif) || null;
  if (m && m.length > 2000) throw erreur(400, 'Motif trop long (2 000 caractères au plus).');
  const qui = await identite(user);
  const effets = [];
  const instance = await enTransaction(async (run) => {
    const doc = await verrouillerDocument(run, tenantId, Number(documentId));
    const { rows } = await run.query("SELECT * FROM circuit_instances WHERE document_id = $1 AND statut = 'en cours' FOR UPDATE", [doc.id]);
    const ancienne = rows[0];
    if (!ancienne) throw erreur(404, "Aucun circuit en cours sur ce document.", 'AUCUN_CIRCUIT');
    if (!automatique && !(await peutPiloter(user, ancienne))) {
      throw erreur(403, "Seul le lanceur du circuit ou un gestionnaire des circuits peut le relancer.", 'PERMISSION_REFUSEE');
    }
    const modele = ancienne.circuit_id ? await chargerModele(run, tenantId, ancienne.circuit_id) : null;
    const etapes = modele && modele.actif && modele.etapes.length ? copieEtapes(modele) : ancienne.etapes;
    await verifierDestinataires(run, tenantId, etapes);
    const v = await versionCourante(run, doc.id);
    const raison = m || `Relancé sur la version ${v?.version ?? '—'}`;
    await run.query("UPDATE circuit_taches SET statut = 'close' WHERE instance_id = $1 AND statut = 'à traiter'", [ancienne.id]);
    await run.query(
      `UPDATE circuit_instances SET statut = 'annulé', termine_at = now(), termine_par = $2, termine_par_nom = $3, motif_fin = $4 WHERE id = $1`,
      [ancienne.id, qui.id, qui.nom, raison]
    );
    const nouvelle = await creerInstance(run, {
      tenantId, doc, circuitId: ancienne.circuit_id, circuitNom: modele?.nom || ancienne.circuit_nom, etapes, qui,
      origine: 'relance', relanceDe: ancienne.id, effets,
    });
    await suivreStatut(run, tenantId, doc.id, 'en validation', qui.id,
      `Circuit « ${nouvelle.circuit_nom} » relancé sur la version ${v?.version ?? '—'}`, raison);
    effets.push(() => auditer(tenantId, doc.id, qui, 'CIRCUIT_RELANCE', {
      instance_id: nouvelle.id, instance_relancee: ancienne.id, circuit: nouvelle.circuit_nom, automatique,
      version: v?.version ?? null, empreinte_sha256: v?.empreinte || null, motif: raison.slice(0, 500),
    }, ip));
    if (ancienne.demarre_par && ancienne.demarre_par !== qui.id) {
      effets.push(() => notifier(tenantId, [ancienne.demarre_par], {
        titre: `Circuit relancé : ${doc.reference_mfile}`,
        message: `Le circuit « ${nouvelle.circuit_nom} » reprend à la première étape sur la version ${v?.version ?? '—'} : ${raison}`,
        documentId: doc.id,
      }));
    }
    return nouvelle;
  });
  await executer(effets);
  return instance;
}

/**
 * Une version vient d'être déposée (documentController.addFiles). Si un
 * circuit est en cours : relance (réglage « relancer » et visas déjà donnés
 * sur une version antérieure) ou avertissement du lanceur et des
 * destinataires en attente. Ne lève jamais.
 */
async function surNouvelleVersion(tenantId, documentId, user, { ip = null } = {}) {
  try {
    const inst = await instanceActive(tenantId, documentId);
    if (!inst) return null;
    const v = await versionCourante(db, inst.document_id);
    if (!v) return null;
    const { rows: [anciens] } = await db.query(
      `SELECT count(*)::int AS nb, max(document_version) AS version FROM circuit_visas
        WHERE instance_id = $1 AND document_version IS NOT NULL AND document_version < $2`,
      [inst.id, v.version]
    );
    const mode = await settingsService.get(tenantId, 'circuits_nouvelle_version', 'avertir');
    if (anciens.nb && mode === 'relancer') {
      await relancer(tenantId, documentId, { motif: `Nouvelle version ${v.version} déposée` }, user, { ip, automatique: true });
      return { action: 'relance', version: v.version };
    }
    const ouvertes = (await db.query("SELECT assigne_a FROM circuit_taches WHERE instance_id = $1 AND statut = 'à traiter'", [inst.id])).rows;
    const ref = (await db.query('SELECT reference_mfile FROM documents WHERE id = $1', [inst.document_id])).rows[0]?.reference_mfile;
    await notifier(tenantId, [inst.demarre_par, ...ouvertes.map((t) => t.assigne_a)].filter((id) => id && id !== user?.id), {
      titre: `Nouvelle version en cours de validation : ${ref}`,
      message: anciens.nb
        ? `La version ${v.version} a été déposée pendant le circuit « ${inst.circuit_nom} » : les ${anciens.nb} visa(s) déjà donné(s) portent sur la version ${anciens.version}.`
        : `La version ${v.version} a été déposée pendant le circuit « ${inst.circuit_nom} » : les visas à venir porteront sur elle.`,
      documentId: inst.document_id,
    });
    return { action: 'avertissement', version: v.version, visas_anterieurs: anciens.nb };
  } catch (err) {
    console.warn(`[circuits] nouvelle version du document ${documentId} non répercutée : ${err.message}`);
    return null;
  }
}

// --------------------------------------------------------------------- lecture

function versTache(t, maintenant = new Date()) {
  return {
    id: t.id, etape_rang: t.etape_rang, action: t.action, assigne_a: t.assigne_a, assigne_nom: t.assigne_nom, statut: t.statut,
    secours: t.secours, pour_le_compte_de: t.pour_le_compte_de, cree_at: t.cree_at, echeance_at: t.echeance_at,
    en_retard: estEnRetard(t, maintenant), traite_at: t.traite_at, traite_par_nom: t.traite_par_nom, commentaire: t.commentaire,
    nb_relances: t.nb_relances, relance_at: t.relance_at,
  };
}

function versVisa(v, scellements, avecIp) {
  const empreinte = v.empreinte_sha256 ? v.empreinte_sha256.trim() : null;
  const journal = scellements.get(v.id) || null;
  const recalculee = empreinteVisa({ ...v, empreinte_sha256: empreinte });
  return {
    id: v.id, etape_rang: v.etape_rang, etape_libelle: v.etape_libelle, decision: v.decision, signataire_nom: v.signataire_nom,
    pour_le_compte_de: v.pour_le_compte_de, commentaire: v.commentaire, signe_at: v.signe_at, document_version: v.document_version,
    empreinte_sha256: empreinte, empreinte_visa: v.empreinte_visa.trim(),
    // Intègre : le visa recalculé redonne son empreinte, et le journal chaîné
    // porte la même (un visa retouché en base ne correspondrait plus).
    integre: recalculee === v.empreinte_visa.trim() && (!journal || journal.empreinte === recalculee),
    journal: journal ? { rang: journal.rang } : null,
    ...(avecIp ? { ip_address: v.ip_address } : {}),
  };
}

function versInstance(i, { taches = [], visas = [], versionCourante: vc = null } = {}) {
  const visasInstance = visas.filter((v) => v.instance_id === i.id);
  return {
    id: i.id, circuit_id: i.circuit_id, circuit_nom: i.circuit_nom, statut: i.statut, demarrage: i.demarrage,
    demarre_par_nom: i.demarre_par_nom, demarre_at: i.demarre_at, termine_at: i.termine_at, termine_par_nom: i.termine_par_nom,
    motif_fin: i.motif_fin, version_depart: i.version_depart, empreinte_depart: i.empreinte_depart ? i.empreinte_depart.trim() : null,
    etape_courante: i.etape_courante, nb_etapes: (i.etapes || []).length, relance_de: i.relance_de,
    etapes: decrireEtapes(i, taches, visasInstance),
    visas_anterieurs: i.statut === 'en cours' ? visasAnterieurs(visasInstance, vc) : null,
    en_retard: taches.some((t) => t.en_retard),
  };
}

/** Volet « Circuit de validation » de la fiche d'un document. */
async function etatDocument(tenantId, documentId, user) {
  if (!(await migrationPassee())) return { disponible: false };
  const { rows: [doc] } = await db.query('SELECT id, statut, classe_id, dossier_id FROM documents WHERE id = $1 AND tenant_id = $2', [documentId, tenantId]);
  if (!doc) throw erreur(404, 'Document introuvable.');
  const { rows: instances } = await db.query(
    'SELECT * FROM circuit_instances WHERE tenant_id = $1 AND document_id = $2 ORDER BY demarre_at DESC, id DESC LIMIT 20', [tenantId, doc.id]);
  const ids = instances.map((i) => i.id);
  const active = instances.find((i) => i.statut === 'en cours') || null;
  const [visasRes, journalRes, tachesRes, v, gerer, lancer, ecriture] = await Promise.all([
    db.query('SELECT * FROM circuit_visas WHERE instance_id = ANY($1::int[]) ORDER BY signe_at, id', [ids]),
    db.query(
      `SELECT (details_json->>'visa_id')::int AS visa_id, details_json->>'empreinte_visa' AS empreinte, chaine_rang
         FROM audit_logs WHERE tenant_id = $1 AND object_type = 'document' AND object_id = $2 AND action = ANY($3::text[])`,
      [tenantId, doc.id, ACTIONS_VISA]
    ),
    active ? db.query('SELECT * FROM circuit_taches WHERE instance_id = $1 ORDER BY etape_rang, id', [active.id]) : { rows: [] },
    versionCourante(db, doc.id),
    estGestionnaire(user),
    peutLancer(user),
    aclService.peutEcrire(tenantId, user.id, doc.dossier_id),
  ]);
  const scellements = new Map(journalRes.rows.filter((r) => r.visa_id)
    .map((r) => [r.visa_id, { empreinte: r.empreinte, rang: r.chaine_rang === null ? null : Number(r.chaine_rang) }]));
  const visas = visasRes.rows.map((x) => ({ ...versVisa(x, scellements, gerer), instance_id: x.instance_id }));
  const maintenant = new Date();
  const taches = tachesRes.rows.map((t) => versTache(t, maintenant));

  let disponibles = [];
  if (lancer && !active) {
    const { rows } = await db.query(
      `SELECT m.id, m.nom, m.classe_id, m.par_defaut, count(e.id)::int AS nb_etapes
         FROM circuit_modeles m JOIN circuit_etapes e ON e.circuit_id = m.id
        WHERE m.tenant_id = $1 AND m.actif GROUP BY m.id ORDER BY m.nom`,
      [tenantId]
    );
    disponibles = rows.map((r) => ({ ...r, par_defaut_classe: r.par_defaut && r.classe_id === doc.classe_id }));
  }
  const defaut = disponibles.find((c) => c.par_defaut_classe) || null;
  return {
    disponible: true,
    statut_document: doc.statut,
    version_courante: v,
    instance: active ? versInstance(active, { taches, visas, versionCourante: v?.version }) : null,
    historique: instances.filter((i) => i !== active).map((i) => versInstance(i, { visas })),
    mes_taches: taches.filter((t) => t.statut === 'à traiter' && t.assigne_a === user.id),
    circuits_disponibles: disponibles,
    circuit_par_defaut_id: defaut ? defaut.id : null,
    peut_demarrer: Boolean(lancer && ecriture && !active && STATUTS_SOUMISSIBLES.includes(doc.statut)),
    peut_annuler: Boolean(active && (gerer || (lancer && active.demarre_par === user.id))),
    peut_gerer: Boolean(gerer),
  };
}

const SELECT_MES_TACHES = `
  SELECT t.*, i.circuit_nom, i.etapes, i.demarre_par_nom, i.demarre_at, i.statut AS instance_statut,
         d.reference_mfile, d.nom_entreprise, d.description, d.version AS document_version, d.statut AS document_statut,
         d.dossier_id, c.name AS classe_nom
    FROM circuit_taches t
    JOIN circuit_instances i ON i.id = t.instance_id
    JOIN documents d ON d.id = t.document_id AND d.tenant_id = t.tenant_id
    LEFT JOIN metadata_schemas c ON c.id = d.classe_id AND c.tenant_id = d.tenant_id`;

/**
 * « Mes tâches » : à traiter (par échéance, les retards d'abord) ou traitées
 * (mes dernières décisions). peut_ouvrir : la fiche du document m'est
 * lisible (documents.view et périmètre) — sinon l'interface n'offre pas le
 * lien, la décision reste possible (être destinataire suffit).
 */
async function mesTaches(tenantId, user, { vue = 'a_traiter' } = {}) {
  if (!(await migrationPassee())) return [];
  const traitees = vue === 'traitees';
  const { rows } = await db.query(
    traitees
      ? `${SELECT_MES_TACHES} WHERE t.tenant_id = $1 AND t.traite_par = $2 AND t.statut IN ('approuvée', 'refusée', 'vue', 'déléguée')
          ORDER BY t.traite_at DESC LIMIT 100`
      : `${SELECT_MES_TACHES} WHERE t.tenant_id = $1 AND t.assigne_a = $2 AND t.statut = 'à traiter' AND i.statut = 'en cours'
           AND d.deleted_at IS NULL
          ORDER BY (t.echeance_at IS NULL), t.echeance_at, t.cree_at`,
    [tenantId, user.id]
  );
  const [voir, { lisibles }] = await Promise.all([
    roleService.possede(tenantId, user.role, 'documents.view'),
    aclService.dossiersAccessibles(tenantId, user.id),
  ]);
  const toutPuissant = ['admin', 'superadmin'].includes(user.role);
  const maintenant = new Date();
  return rows.map((t) => {
    const etape = (t.etapes || []).find((e) => e.rang === t.etape_rang) || {};
    return {
      ...versTache(t, maintenant),
      instance_id: t.instance_id, document_id: t.document_id, reference: t.reference_mfile, nom_entreprise: t.nom_entreprise,
      description: t.description, classe_nom: t.classe_nom, document_statut: t.document_statut, document_version: t.document_version,
      circuit_nom: t.circuit_nom, nb_etapes: (t.etapes || []).length, etape_libelle: etape.libelle, regle: etape.regle,
      demarre_par_nom: t.demarre_par_nom, demarre_at: t.demarre_at, instance_statut: t.instance_statut,
      peut_ouvrir: Boolean(voir && (toutPuissant || t.dossier_id === null || lisibles.has(t.dossier_id))),
    };
  });
}

/** Badge de la navigation : tâches à traiter, dont en retard. */
async function compteTaches(tenantId, userId) {
  if (!(await migrationPassee())) return { total: 0, en_retard: 0 };
  const { rows } = await db.query(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE t.echeance_at < now())::int AS en_retard
       FROM circuit_taches t
       JOIN circuit_instances i ON i.id = t.instance_id AND i.statut = 'en cours'
       JOIN documents d ON d.id = t.document_id AND d.deleted_at IS NULL
      WHERE t.tenant_id = $1 AND t.assigne_a = $2 AND t.statut = 'à traiter'`,
    [tenantId, userId]
  );
  return rows[0];
}

/** Personnes à qui le destinataire peut déléguer sa tâche. */
async function delegataires(tenantId, tacheId, user) {
  const n = entierPositif(tacheId);
  const { rows: [t] } = n ? await db.query('SELECT assigne_a, statut FROM circuit_taches WHERE id = $1 AND tenant_id = $2', [n, tenantId]) : { rows: [] };
  if (!t) throw erreur(404, 'Tâche introuvable.');
  if (t.assigne_a !== user.id && !(await estGestionnaire(user))) throw erreur(403, "Vous n'êtes pas destinataire de cette tâche.", 'NON_DESTINATAIRE');
  const { rows } = await db.query(
    'SELECT id, full_name, username, role FROM users WHERE tenant_id = $1 AND id <> $2 ORDER BY full_name, id', [tenantId, t.assigne_a || 0]);
  return rows;
}

/** Circuits en cours de l'organisation (suivi des gestionnaires), bornés au périmètre. */
async function suivi(tenantId, user) {
  if (!(await migrationPassee())) return [];
  const { rows } = await db.query(
    `SELECT i.id, i.document_id, i.circuit_nom, i.etape_courante, i.etapes, i.demarre_par_nom, i.demarre_at, i.demarrage,
            d.reference_mfile, d.nom_entreprise, d.dossier_id, d.version AS document_version,
            COALESCE((SELECT json_agg(json_build_object('id', t.id, 'assigne_a', t.assigne_a, 'assigne_nom', t.assigne_nom,
                                       'echeance_at', t.echeance_at, 'en_retard', t.echeance_at < now(), 'secours', t.secours,
                                       'pour_le_compte_de', t.pour_le_compte_de, 'nb_relances', t.nb_relances) ORDER BY t.id)
                        FROM circuit_taches t WHERE t.instance_id = i.id AND t.statut = 'à traiter'), '[]') AS taches
       FROM circuit_instances i
       JOIN documents d ON d.id = i.document_id AND d.tenant_id = i.tenant_id
      WHERE i.tenant_id = $1 AND i.statut = 'en cours' AND d.deleted_at IS NULL
      ORDER BY i.demarre_at
      LIMIT 300`,
    [tenantId]
  );
  const { lisibles } = await aclService.dossiersAccessibles(tenantId, user.id);
  const toutPuissant = ['admin', 'superadmin'].includes(user.role);
  return rows
    .filter((r) => toutPuissant || r.dossier_id === null || lisibles.has(r.dossier_id))
    .map(({ dossier_id: _d, etapes, ...r }) => {
      const etape = (etapes || []).find((e) => e.rang === r.etape_courante) || {};
      return { ...r, nb_etapes: (etapes || []).length, etape_libelle: etape.libelle, etape_action: etape.action,
        en_retard: r.taches.some((t) => t.en_retard) };
    });
}

// ------------------------------------------------------------- tâche de fond

/**
 * Rappels des tâches en retard : au plus une fois par période
 * (circuits_relance_jours, 1 jour par défaut) et par tâche. Les tâches sont
 * réservées par UPDATE … SKIP LOCKED : deux serveurs, ou un passage qui
 * croise une décision en cours, ne rappellent jamais deux fois.
 * @param {{tenantId?: number, lot?: number}} opts tenantId borne le passage
 *        à une organisation (tests).
 * @returns {Promise<number>} nombre de rappels envoyés.
 */
async function relancerTachesEnRetard({ tenantId = null, lot = 200 } = {}) {
  if (!(await migrationPassee())) return 0;
  const { rows } = await db.query(
    `WITH cibles AS (
       SELECT t.id FROM circuit_taches t
         JOIN circuit_instances i ON i.id = t.instance_id AND i.statut = 'en cours'
         JOIN documents d ON d.id = t.document_id AND d.deleted_at IS NULL
        WHERE t.statut = 'à traiter' AND t.assigne_a IS NOT NULL
          AND t.echeance_at IS NOT NULL AND t.echeance_at < now()
          AND ($1::int IS NULL OR t.tenant_id = $1)
          AND (t.relance_at IS NULL OR t.relance_at < now() - make_interval(days => GREATEST(1, COALESCE(
                (SELECT CASE WHEN s.value ~ '^[0-9]{1,2}$' THEN s.value::int END FROM settings s
                  WHERE s.tenant_id = t.tenant_id AND s.key = 'circuits_relance_jours'), 1))))
        ORDER BY t.echeance_at
        LIMIT $2
        FOR UPDATE OF t SKIP LOCKED
     )
     UPDATE circuit_taches t SET relance_at = now(), nb_relances = t.nb_relances + 1
       FROM cibles c WHERE t.id = c.id
     RETURNING t.id, t.tenant_id, t.document_id, t.instance_id, t.etape_rang, t.assigne_a, t.echeance_at, t.nb_relances`,
    [tenantId, lot]
  );
  if (!rows.length) return 0;
  const { rows: contexte } = await db.query(
    `SELECT i.id, i.circuit_nom, i.etapes, d.reference_mfile FROM circuit_instances i JOIN documents d ON d.id = i.document_id
      WHERE i.id = ANY($1::int[])`,
    [[...new Set(rows.map((r) => r.instance_id))]]
  );
  const parInstance = new Map(contexte.map((c) => [c.id, c]));
  for (const t of rows) {
    const c = parInstance.get(t.instance_id) || {};
    const etape = (c.etapes || []).find((e) => e.rang === t.etape_rang) || {};
    const jours = Math.max(1, Math.floor((Date.now() - new Date(t.echeance_at).getTime()) / 86400000));
    await notifier(t.tenant_id, [t.assigne_a], {
      titre: `Rappel — tâche en retard : ${c.reference_mfile || `document ${t.document_id}`}`,
      message: `L'étape « ${etape.libelle || t.etape_rang} » du circuit « ${c.circuit_nom || ''} » attend votre ${etape.action === 'information' ? 'prise de connaissance' : 'visa'} depuis le ${dateFr(t.echeance_at)} (${jours} jour(s) de retard).`,
      documentId: t.document_id,
    });
  }
  return rows.length;
}

/**
 * Travail de fond : un passage par heure (les rappels sont au plus
 * quotidiens). Ne retient pas le processus et ne le fait jamais tomber.
 */
function demarrerRelances() {
  const tour = async () => {
    let delai = 60 * 60000;
    try {
      const n = await relancerTachesEnRetard();
      if (n) console.log(`[circuits] ${n} rappel(s) de tâche(s) en retard`);
    } catch (err) {
      console.warn('[circuits] rappels différés :', err.message);
      delai = 10 * 60000;
    }
    setTimeout(tour, delai).unref();
  };
  setTimeout(tour, 90000).unref();
}

module.exports = {
  TYPES_ASSIGNATION, ACTIONS, REGLES, DECISIONS, STATUTS_SOUMISSIBLES, migrationPassee,
  // pures
  validerModele, issueEtape, echeanceDe, estEnRetard, empreinteVisa, decrireEtapes, visasAnterieurs,
  // modèles
  listerModeles, chargerModele: (tenantId, id) => chargerModele(db, tenantId, id), creerModele, modifierModele, supprimerModele, referentiel,
  // instances et tâches
  resoudreDestinataires: (tenantId, etape) => resoudreDestinataires(db, tenantId, etape),
  instanceActive, demarrer, demarrageAutomatique, decider, deleguer, reassigner, annuler, relancer, surNouvelleVersion,
  etatDocument, mesTaches, compteTaches, delegataires, suivi, estGestionnaire,
  relancerTachesEnRetard, demarrerRelances,
};
