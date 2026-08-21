// ============================================================================
// licenseService — émission, signature et vérification des licences de bureau.
//
// PRINCIPE
// Une licence est un petit document JSON signé avec Ed25519. L'app de bureau la
// conserve en cache local et la vérifie avec la clé PUBLIQUE embarquée. Elle n'a
// donc pas besoin du réseau à chaque démarrage, tout en restant impossible à
// FABRIQUER : sans la clé privée (variable d'environnement Render), aucune
// signature valide ne peut être produite.
//
// CE QUE CE DISPOSITIF PROTÈGE ET CE QU'IL NE PROTÈGE PAS
//   ✔ Fabriquer une fausse licence — impossible sans la clé privée.
//   ✔ Prolonger une licence en modifiant le cache local — la signature casse.
//   ✔ Copier une licence sur un second poste — machine_id ne correspond plus.
//   ✘ Supprimer purement et simplement l'appel qui vérifie la licence. Le code
//     JS est livré en clair (asar). C'est le plafond de toute protection
//     logicielle non obfusquée, et aucune quantité de code JS ne le relèvera :
//     ce dispositif décourage le partage entre collègues, pas un cracker.
//
// FORMAT DU JETON : <payload base64url>.<signature base64url>
// Un seul point comme séparateur, comme un JWT — mais ce n'est PAS un JWT :
// pas d'en-tête négociable, donc pas d'attaque « alg: none » ni de confusion
// d'algorithme. L'algorithme est fixé par le code, pas par le jeton.
// ============================================================================
const crypto = require('crypto');
const db = require('../config/db');
const { LICENSE_PUBLIC_KEY } = require('../config/licensePublicKey');

// Durée de validité de l'artefact signé lui-même (distincte de valid_until).
// L'app doit revenir chercher un artefact frais tous les 7 jours ; passé ce
// délai sans réseau, elle entre en période de grâce puis se bloque. Sans cette
// péremption courte, une licence révoquée resterait acceptée jusqu'à sa date
// d'échéance, ce qui viderait la révocation de son sens.
const ARTIFACT_TTL_DAYS = 7;

// Fenêtre de grâce hors ligne accordée APRÈS péremption de l'artefact.
const GRACE_DAYS = 7;

/**
 * Clé privée depuis l'environnement. Absente en développement local et sur les
 * postes clients : dans ce cas seule la VÉRIFICATION est possible, ce qui est
 * exactement le comportement voulu côté client.
 *
 * Render transmet les sauts de ligne d'un PEM sous forme littérale « \n » selon
 * la façon dont la variable a été saisie — on rétablit les deux formes.
 */
function getPrivateKey() {
  const raw = process.env.DESKTOP_LICENSE_PRIVATE_KEY;
  if (!raw) return null;
  const pem = raw.includes('-----BEGIN')
    ? raw.replace(/\\n/g, '\n')
    : `-----BEGIN PRIVATE KEY-----\n${raw}\n-----END PRIVATE KEY-----`;
  try {
    return crypto.createPrivateKey(pem);
  } catch (err) {
    console.error('[license] DESKTOP_LICENSE_PRIVATE_KEY illisible :', err.message);
    return null;
  }
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/**
 * Sérialisation canonique : clés triées par ordre alphabétique.
 *
 * Indispensable — JSON.stringify préserve l'ordre d'insertion des propriétés.
 * Signer { a, b } puis vérifier { b, a } produirait deux chaînes différentes
 * donc un échec de signature, de façon parfaitement aléatoire selon le chemin
 * de code. Le tri rend la représentation déterministe.
 */
function canonical(payload) {
  return JSON.stringify(payload, Object.keys(payload).sort());
}

/**
 * Clé de licence lisible : DF-XXXX-XXXX-XXXX-XXXX.
 *
 * Alphabet volontairement réduit (pas de 0/O, 1/I/L, 8/B) : ces clés sont lues
 * au téléphone et recopiées à la main depuis un e-mail. Une confusion O/0 dans
 * une clé de licence génère un appel au support.
 */
function generateKey() {
  const ALPHABET = 'ACDEFGHJKMNPQRSTUVWXYZ23456789';
  const groups = [];
  for (let g = 0; g < 4; g += 1) {
    let group = '';
    // randomBytes plutôt que Math.random : une clé de licence devinable est une
    // licence gratuite.
    const bytes = crypto.randomBytes(4);
    for (let i = 0; i < 4; i += 1) group += ALPHABET[bytes[i] % ALPHABET.length];
    groups.push(group);
  }
  return `DF-${groups.join('-')}`;
}

/** Normalise une clé saisie à la main : espaces, minuscules, tirets manquants. */
function normalizeKey(input) {
  if (!input) return '';
  const cleaned = String(input).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned.startsWith('DF')) return '';
  const body = cleaned.slice(2);
  if (body.length !== 16) return '';
  return `DF-${body.match(/.{4}/g).join('-')}`;
}

/**
 * Signe une licence. `valid_until` est l'échéance de l'abonnement,
 * `artifact_expires_at` celle de ce document-ci (7 jours) — deux notions
 * distinctes qu'il ne faut pas confondre : la première est commerciale, la
 * seconde est le levier de révocation.
 */
function signLicense({ tenant_id, license_key, machine_id, valid_until, status }) {
  const privateKey = getPrivateKey();
  if (!privateKey) {
    throw new Error(
      'Signature impossible : DESKTOP_LICENSE_PRIVATE_KEY absente de l\'environnement.'
    );
  }

  const now = new Date();
  const artifactExpiry = new Date(now.getTime() + ARTIFACT_TTL_DAYS * 86400_000);

  const payload = {
    v: 1,
    license_key,
    machine_id: machine_id || null,
    tenant_id: tenant_id || null,
    status,
    valid_until: valid_until ? new Date(valid_until).toISOString() : null,
    issued_at: now.toISOString(),
    artifact_expires_at: artifactExpiry.toISOString(),
    grace_days: GRACE_DAYS,
  };

  const encoded = b64url(canonical(payload));
  const signature = crypto.sign(null, Buffer.from(encoded), privateKey);
  return `${encoded}.${b64url(signature)}`;
}

/**
 * Vérifie un jeton et renvoie son payload.
 *
 * Ne juge PAS de la validité commerciale (dates, machine) : ce n'est que le
 * contrôle cryptographique. L'interprétation revient à licenseGuard côté
 * bureau, qui connaît l'heure locale et l'empreinte de la machine.
 *
 * @returns {{ok: true, payload: object} | {ok: false, reason: string}}
 */
function verifyLicense(token) {
  if (!token || typeof token !== 'string') {
    return { ok: false, reason: 'jeton absent' };
  }
  const parts = token.split('.');
  if (parts.length !== 2) {
    return { ok: false, reason: 'format de jeton invalide' };
  }
  const [encoded, sig] = parts;

  let valid = false;
  try {
    valid = crypto.verify(
      null,
      Buffer.from(encoded),
      crypto.createPublicKey(LICENSE_PUBLIC_KEY),
      Buffer.from(sig, 'base64url')
    );
  } catch {
    // Signature tronquée, base64 invalide, clé illisible — toutes ces erreurs
    // signifient la même chose du point de vue de l'appelant.
    return { ok: false, reason: 'signature illisible' };
  }
  if (!valid) return { ok: false, reason: 'signature invalide' };

  try {
    return { ok: true, payload: JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) };
  } catch {
    return { ok: false, reason: 'payload illisible' };
  }
}

/**
 * Passe en 'expired' les licences dont la date est dépassée.
 *
 * Aucune tâche planifiée ne tourne sur Render (plan free, pas de cron), donc la
 * péremption est provoquée à la lecture. Appelée avant chaque vérification :
 * l'état renvoyé reflète ainsi toujours la réalité, sans dépendre d'un
 * ordonnanceur externe.
 */
async function expireStale() {
  try {
    const { rows } = await db.query('SELECT expire_stale_licenses() AS n');
    return rows[0]?.n || 0;
  } catch (err) {
    // Fonction absente (015 non appliquée) : on retombe sur l'UPDATE direct
    // plutôt que d'échouer, pour que l'activation reste possible.
    if (err.code === '42883') {
      const { rowCount } = await db.query(
        `UPDATE licenses SET status = 'expired', updated_at = now()
          WHERE status = 'active' AND valid_until IS NOT NULL AND valid_until < now()`
      );
      return rowCount;
    }
    throw err;
  }
}

/** Prolonge une licence de N mois (cumulatif — voir extend_license en 015). */
async function extendLicense(licenseId, months = 1) {
  const n = Math.max(1, Math.min(36, parseInt(months, 10) || 1));
  const { rows } = await db.query('SELECT extend_license($1, $2) AS valid_until', [licenseId, n]);
  return rows[0]?.valid_until || null;
}

/** Licence par clé (déjà normalisée). */
async function findByKey(licenseKey) {
  const { rows } = await db.query('SELECT * FROM licenses WHERE license_key = $1', [licenseKey]);
  return rows[0] || null;
}

/**
 * Crée une licence. `months` > 0 la rend immédiatement active (vente conclue) ;
 * 0 la laisse en 'pending' (paiement en attente de confirmation).
 */
async function createLicense({ tenant_id, customer_email, customer_company, months = 0, notes }) {
  // Collision improbable (30^16 combinaisons) mais la clé est UNIQUE en base :
  // on réessaie plutôt que de renvoyer une erreur à un client qui vient de payer.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const key = generateKey();
    try {
      const { rows } = await db.query(
        `INSERT INTO licenses (tenant_id, license_key, status, customer_email, customer_company, notes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [tenant_id || null, key, 'pending', customer_email || null, customer_company || null, notes || null]
      );
      const license = rows[0];
      if (months > 0) {
        license.valid_until = await extendLicense(license.id, months);
        license.status = 'active';
      }
      return license;
    } catch (err) {
      if (err.code === '23505') continue; // clé déjà prise — on retente
      throw err;
    }
  }
  throw new Error('Génération de clé de licence impossible après 5 tentatives');
}

module.exports = {
  generateKey,
  normalizeKey,
  signLicense,
  verifyLicense,
  expireStale,
  extendLicense,
  findByKey,
  createLicense,
  hasSigningKey: () => getPrivateKey() !== null,
  ARTIFACT_TTL_DAYS,
  GRACE_DAYS,
};
