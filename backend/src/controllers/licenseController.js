// ============================================================================
// licenseController — activation des postes et administration des licences.
//
// DEUX PUBLICS, DEUX NIVEAUX DE GARDE
//
//   • Routes PUBLIQUES (/api/licenses/*) — appelées par l'app de bureau AVANT
//     toute connexion : au moment d'activer, le poste n'a ni compte ni JWT. La
//     clé de licence EST le secret d'authentification. C'est pourquoi ces routes
//     sont limitées en débit et ne révèlent rien d'exploitable.
//
//   • Routes PROPRIÉTAIRE (/api/superadmin/licenses/*) — émission et révocation,
//     réservées au propriétaire de la plateforme (tenant 1) par
//     platformOwnerMiddleware. Un superadmin d'entreprise cliente ne doit
//     évidemment pas pouvoir prolonger sa propre licence.
//
// CODES DE RETOUR (l'app de bureau s'y fie pour choisir son message)
//   400 clé mal formée · 402 paiement en attente · 403 révoquée ou échue
//   404 clé inconnue   · 409 déjà liée à un autre poste
//   429 trop de tentatives · 503 dispositif non configuré
// ============================================================================
const db = require('../config/db');
const licenseService = require('../services/licenseService');
const { priceFor } = require('../config/pricing');

// ---------------------------------------------------------------------------
// Limitation de débit — en mémoire, volontairement
//
// Une activation légitime est un événement rare : une fois à l'installation,
// puis un rafraîchissement hebdomadaire. Ce qu'il s'agit d'empêcher, c'est le
// martèlement d'une clé au hasard. La mémoire du processus suffit : le compteur
// se remet à zéro au redémarrage de Render, ce qui n'a aucune importance ici
// (deviner une clé demanderait 30^16 essais, pas quelques centaines).
//
// Ne PAS remplacer par une table : ce serait une écriture en base à chaque
// tentative refusée, donc exactement le levier d'amplification qu'un attaquant
// cherche.
// ---------------------------------------------------------------------------
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 10 * 60 * 1000;
const attempts = new Map(); // clé → { count, resetAt }

function rateLimited(bucketKey) {
  const now = Date.now();
  const entry = attempts.get(bucketKey);

  if (!entry || entry.resetAt < now) {
    attempts.set(bucketKey, { count: 1, resetAt: now + WINDOW_MS });
    // Purge opportuniste : sans elle, la Map croît indéfiniment sur un processus
    // de longue durée. Bornée à un balayage quand elle dépasse 500 entrées.
    if (attempts.size > 500) {
      for (const [k, v] of attempts) if (v.resetAt < now) attempts.delete(k);
    }
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

/** Une tentative réussie libère le compteur : l'usage normal n'est jamais puni. */
function clearRateLimit(bucketKey) {
  attempts.delete(bucketKey);
}

// ---------------------------------------------------------------------------
// Validation des entrées
// ---------------------------------------------------------------------------

/**
 * Empreinte machine : SHA-256 hexadécimal produit par desktop/machineId.js.
 * On borne la longueur et on restreint l'alphabet — cette valeur part en base
 * dans une colonne VARCHAR(128) et surtout DANS UN PAYLOAD SIGNÉ. Y laisser
 * passer du texte libre reviendrait à faire signer par le serveur une chaîne
 * choisie par le client.
 */
function normalizeMachineId(input) {
  if (!input) return '';
  const cleaned = String(input).trim().toLowerCase();
  if (!/^[a-f0-9-]{8,128}$/.test(cleaned)) return '';
  return cleaned;
}

/** Libellé du poste (« PC-COMPTA ») — purement informatif, affiché au support. */
function normalizeLabel(input) {
  if (!input) return null;
  return String(input).replace(/[\r\n]/g, ' ').trim().slice(0, 255) || null;
}

// Table absente : 015 pas encore appliquée. Distinguer ce cas d'un vrai 500
// évite une heure de recherche pour un simple oubli de migration.
const isMissingTable = (err) => err.code === '42P01' || err.code === '42703';

function handleDbError(res, err, context) {
  if (isMissingTable(err)) {
    console.error(`[license] ${context} : table absente — appliquer docs/migrations/015_licensing.sql`);
    return res.status(503).json({
      message: 'Le dispositif de licence n\'est pas encore installé sur ce serveur.',
      code: 'LICENSING_NOT_INSTALLED',
    });
  }
  console.error(`[license] ${context} :`, err);
  return res.status(500).json({ message: 'Erreur interne du serveur' });
}

/**
 * Fabrique la réponse envoyée au poste client.
 *
 * `license` (en clair) sert à l'affichage immédiat ; `token` est l'artefact
 * signé, seule pièce qui compte pour l'autorisation. Le client ne doit JAMAIS
 * accorder sa confiance aux champs en clair : ils sont là pour l'écran, la
 * décision se prend sur le jeton vérifié.
 */
function licensePayload(license) {
  const token = licenseService.signLicense({
    tenant_id: license.tenant_id,
    license_key: license.license_key,
    machine_id: license.machine_id,
    valid_until: license.valid_until,
    status: license.status,
  });
  return {
    token,
    license: {
      license_key: license.license_key,
      status: license.status,
      valid_until: license.valid_until,
      machine_id: license.machine_id,
      customer_company: license.customer_company,
    },
    artifact_ttl_days: licenseService.ARTIFACT_TTL_DAYS,
    grace_days: licenseService.GRACE_DAYS,
  };
}

/**
 * Contrôles communs à `activate` et `refresh` : format, débit, existence, état
 * commercial. Renvoie la licence si tout est en ordre, sinon répond lui-même et
 * renvoie null (l'appelant s'arrête alors).
 */
async function loadForClient(req, res) {
  const licenseKey = licenseService.normalizeKey(req.body?.license_key);
  const machineId = normalizeMachineId(req.body?.machine_id);

  if (!licenseKey) {
    return { error: res.status(400).json({
      message: 'Clé de licence invalide. Format attendu : DF-XXXX-XXXX-XXXX-XXXX',
      code: 'INVALID_KEY_FORMAT',
    }) };
  }
  if (!machineId) {
    return { error: res.status(400).json({
      message: 'Empreinte machine absente ou invalide.',
      code: 'INVALID_MACHINE_ID',
    }) };
  }

  // Le seau combine la clé et l'IP : une clé martelée depuis une seule machine
  // est bloquée, sans qu'une IP partagée (entreprise derrière un NAT) puisse
  // empêcher les autres postes de s'activer.
  const bucket = `${licenseKey}|${req.ip}`;
  if (rateLimited(bucket)) {
    return { error: res.status(429).json({
      message: 'Trop de tentatives. Réessayez dans quelques minutes.',
      code: 'RATE_LIMITED',
    }) };
  }

  // Péremption provoquée à la lecture (pas de cron sur Render free) : l'état lu
  // juste après reflète donc la réalité, jamais une valeur périmée.
  await licenseService.expireStale();

  const license = await licenseService.findByKey(licenseKey);
  if (!license) {
    return { error: res.status(404).json({
      message: 'Clé de licence inconnue.',
      code: 'UNKNOWN_KEY',
    }) };
  }
  if (license.status === 'revoked') {
    return { error: res.status(403).json({
      message: 'Cette licence a été révoquée. Contactez le support.',
      code: 'REVOKED',
    }) };
  }
  if (license.status === 'expired') {
    return { error: res.status(403).json({
      message: 'Cet abonnement a expiré. Renouvelez-le pour réactiver l\'application.',
      code: 'EXPIRED',
      valid_until: license.valid_until,
    }) };
  }
  if (license.status === 'pending' || !license.valid_until) {
    // 402 : le paiement n'est pas confirmé. Distinct du 403 (droit refusé) — ici
    // le client n'a rien fait de mal, il attend la confirmation de son paiement.
    return { error: res.status(402).json({
      message: 'Paiement en attente de confirmation. Réessayez dans quelques minutes.',
      code: 'PAYMENT_PENDING',
    }) };
  }

  return { license, machineId, bucket };
}

// ---------------------------------------------------------------------------
// Routes publiques
// ---------------------------------------------------------------------------

/**
 * POST /api/licenses/activate — lie une licence à un poste.
 *
 * Trois cas : jamais liée (on lie), liée à ce poste (on renvoie l'artefact — un
 * cache supprimé ou une réinstallation ne doit pas coûter un appel au support),
 * liée ailleurs (409, c'est la règle « 1 licence = 1 poste »).
 */
exports.activate = async (req, res) => {
  try {
    if (!licenseService.hasSigningKey()) {
      console.error('[license] activation impossible : DESKTOP_LICENSE_PRIVATE_KEY absente');
      return res.status(503).json({
        message: 'Service de licence indisponible. Contactez le support.',
        code: 'SIGNING_UNAVAILABLE',
      });
    }

    const loaded = await loadForClient(req, res);
    if (loaded.error) return loaded.error;
    let { license } = loaded;
    const { machineId, bucket } = loaded;

    if (!license.machine_id) {
      // UPDATE conditionnel, et non « lire puis écrire » : deux activations
      // simultanées de la même clé sur deux postes passeraient sinon toutes les
      // deux le test `!license.machine_id`. Ici, la base arbitre — la seconde
      // trouve rowCount 0 et repart sur la branche de comparaison.
      const { rows } = await db.query(
        `UPDATE licenses
            SET machine_id = $1, machine_label = $2,
                activated_at = COALESCE(activated_at, now()), updated_at = now()
          WHERE id = $3 AND machine_id IS NULL
          RETURNING *`,
        [machineId, normalizeLabel(req.body?.machine_label), license.id]
      );
      license = rows[0] || (await licenseService.findByKey(license.license_key));
    }

    if (license.machine_id !== machineId) {
      return res.status(409).json({
        message: 'Cette licence est déjà utilisée sur un autre ordinateur. '
          + 'Le support peut la transférer sur ce poste.',
        code: 'MACHINE_MISMATCH',
      });
    }

    clearRateLimit(bucket);
    return res.json(licensePayload(license));
  } catch (err) {
    return handleDbError(res, err, 'activation');
  }
};

/**
 * POST /api/licenses/refresh — renouvelle l'artefact signé (tous les 7 jours).
 *
 * Ne lie aucun poste : une licence non encore activée doit passer par
 * `activate`. Sans cette séparation, `refresh` deviendrait un second chemin
 * d'activation, et la règle « 1 licence = 1 poste » aurait deux gardiens à
 * maintenir en accord.
 */
exports.refresh = async (req, res) => {
  try {
    if (!licenseService.hasSigningKey()) {
      return res.status(503).json({
        message: 'Service de licence indisponible.',
        code: 'SIGNING_UNAVAILABLE',
      });
    }

    const loaded = await loadForClient(req, res);
    if (loaded.error) return loaded.error;
    const { license, machineId, bucket } = loaded;

    if (!license.machine_id) {
      return res.status(409).json({
        message: 'Licence non activée sur ce poste.',
        code: 'NOT_ACTIVATED',
      });
    }
    if (license.machine_id !== machineId) {
      return res.status(409).json({
        message: 'Cette licence est liée à un autre ordinateur.',
        code: 'MACHINE_MISMATCH',
      });
    }

    clearRateLimit(bucket);
    return res.json(licensePayload(license));
  } catch (err) {
    return handleDbError(res, err, 'rafraîchissement');
  }
};

// ---------------------------------------------------------------------------
// Routes propriétaire de la plateforme
// ---------------------------------------------------------------------------

// Jours restants calculés en SQL : l'horloge du serveur de base est la seule
// référence commune. Le faire en JS introduirait l'heure du serveur applicatif
// comme seconde source de vérité, avec le décalage qui va avec.
const LICENSE_SELECT = `
  SELECT l.*, t.name AS tenant_name, t.slug AS tenant_slug,
         CASE WHEN l.valid_until IS NULL THEN NULL
              ELSE GREATEST(0, CEIL(EXTRACT(EPOCH FROM (l.valid_until - now())) / 86400))::INT
         END AS days_remaining,
         (SELECT COUNT(*) FROM payments p WHERE p.license_id = l.id AND p.status = 'paid') AS payments_count
    FROM licenses l
    LEFT JOIN tenants t ON t.id = l.tenant_id`;

/** GET /api/superadmin/licenses — inventaire complet. */
exports.list = async (req, res) => {
  try {
    await licenseService.expireStale();
    const { rows } = await db.query(`${LICENSE_SELECT} ORDER BY l.created_at DESC`);
    return res.json({
      licenses: rows,
      // L'écran d'administration doit pouvoir dire « la signature n'est pas
      // configurée » au lieu de laisser une émission échouer sans explication.
      signing_configured: licenseService.hasSigningKey(),
    });
  } catch (err) {
    if (isMissingTable(err)) return res.json({ licenses: [], signing_configured: false });
    console.error('[license] inventaire :', err);
    return res.status(500).json({ message: 'Erreur lors de la récupération des licences' });
  }
};

/**
 * POST /api/superadmin/licenses — émission manuelle (vente hors ligne).
 *
 * C'est ce qui permet de vendre dès maintenant, sans attendre l'intégration des
 * paiements : on encaisse par virement ou en espèces, on émet la clé ici.
 */
exports.create = async (req, res) => {
  const { customer_email, customer_company, notes, tenant_id } = req.body || {};
  const months = Math.max(0, Math.min(36, parseInt(req.body?.months, 10) || 0));

  try {
    const license = await licenseService.createLicense({
      tenant_id: tenant_id ? Number(tenant_id) : null,
      customer_email: customer_email ? String(customer_email).trim().slice(0, 255) : null,
      customer_company: customer_company ? String(customer_company).trim().slice(0, 255) : null,
      months,
      notes: notes ? String(notes).slice(0, 2000) : null,
    });

    if (months > 0) {
      // Trace comptable de la vente hors ligne. Le montant vient de pricing.js
      // et non d'une constante recopiée ici : un changement de tarif ne doit pas
      // laisser deux vérités dans le code.
      //
      // Échec non bloquant : la licence est le livrable, elle est déjà émise. Un
      // 500 à ce stade laisserait l'administrateur croire que rien n'a été créé
      // alors que la clé existe — il en émettrait une seconde.
      try {
        const price = priceFor('kkiapay'); // vente locale : tarif en FCFA
        await db.query(
          `INSERT INTO payments (license_id, provider, provider_ref, amount, currency, status, months, customer_email, paid_at)
           VALUES ($1, 'manual', $2, $3, $4, 'paid', $5, $6, now())
           ON CONFLICT (provider, provider_ref) DO NOTHING`,
          [license.id, `manual-${license.id}`, price.amount * months, price.currency,
            months, license.customer_email]
        );
      } catch (err) {
        console.error('[license] trace de paiement manuel non enregistrée :', err.message);
      }
    }

    return res.status(201).json({ license });
  } catch (err) {
    if (err.code === '23503') {
      return res.status(400).json({ message: 'Entreprise (tenant) introuvable' });
    }
    return handleDbError(res, err, 'émission');
  }
};

/**
 * PATCH /api/superadmin/licenses/:id — prolonger, révoquer, réhabiliter.
 *
 * `months` cumule (extend_license part de GREATEST(now(), valid_until)) : un
 * renouvellement anticipé ajoute au reliquat au lieu de l'écraser.
 */
exports.update = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ message: 'Identifiant invalide' });

  const { status, notes } = req.body || {};
  const months = req.body?.months != null ? parseInt(req.body.months, 10) : null;

  if (status && !['active', 'revoked', 'pending'].includes(status)) {
    // 'expired' est délibérément absent : cet état est CALCULÉ à partir de la
    // date. Le poser à la main créerait une licence « expirée » avec une
    // échéance future, qu'expire_stale_licenses ne corrigerait jamais.
    return res.status(400).json({ message: 'Statut invalide (active, revoked ou pending)' });
  }

  try {
    const { rows: existing } = await db.query('SELECT * FROM licenses WHERE id = $1', [id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Licence introuvable' });

    // Prolongation d'abord : elle repasse la licence en 'active'. Si l'appel
    // demande aussi une révocation, l'UPDATE de statut qui suit tranche — la
    // révocation doit toujours l'emporter.
    if (months && months > 0) {
      await licenseService.extendLicense(id, months);
    }

    if (status || notes !== undefined) {
      await db.query(
        `UPDATE licenses
            SET status = COALESCE($1, status),
                notes  = COALESCE($2, notes),
                updated_at = now()
          WHERE id = $3`,
        [status || null, notes !== undefined ? String(notes).slice(0, 2000) : null, id]
      );
    }

    const { rows } = await db.query(`${LICENSE_SELECT} WHERE l.id = $1`, [id]);
    return res.json({ license: rows[0] });
  } catch (err) {
    return handleDbError(res, err, 'modification');
  }
};

/**
 * POST /api/superadmin/licenses/:id/reset-machine — délier le poste.
 *
 * Indispensable en exploitation : un client change d'ordinateur, ou sa carte
 * mère est remplacée (l'empreinte change). Sans cette route, la seule issue
 * serait d'émettre une nouvelle clé — donc de perdre l'historique de paiement.
 */
exports.resetMachine = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ message: 'Identifiant invalide' });

  try {
    const { rows } = await db.query(
      `UPDATE licenses SET machine_id = NULL, machine_label = NULL, updated_at = now()
        WHERE id = $1 RETURNING id`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Licence introuvable' });

    // L'artefact déjà en cache sur l'ancien poste reste valide jusqu'à sa
    // péremption (7 jours au plus). C'est le prix de la vérification hors ligne
    // et la raison pour laquelle l'artefact est à durée courte : à son
    // renouvellement, l'ancien poste sera refusé.
    const { rows: fresh } = await db.query(`${LICENSE_SELECT} WHERE l.id = $1`, [id]);
    return res.json({
      license: fresh[0],
      warning: `L'ancien poste peut rester fonctionnel jusqu'à ${licenseService.ARTIFACT_TTL_DAYS} jours `
        + '(durée de validité de son artefact hors ligne).',
    });
  } catch (err) {
    return handleDbError(res, err, 'réinitialisation du poste');
  }
};
