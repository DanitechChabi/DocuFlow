// ============================================================================
// paymentService — encaissement des abonnements DocuFlow (KkiaPay et PayPal).
//
// CE QUI EST EN JEU : une licence émise sur un paiement non vérifié est un
// logiciel donné. Trois règles gouvernent donc tout ce fichier.
//
//   1. LE MONTANT NE VIENT JAMAIS DU CLIENT. La page de paiement envoie ce
//      qu'elle veut ; seul le montant que le FOURNISSEUR nous confirme compte,
//      et il est comparé au tarif de config/pricing.js.
//
//   2. LES WEBHOOKS SONT AUTHENTIFIÉS. Une URL de webhook est publique : sans
//      vérification de signature, n'importe qui pourrait annoncer un paiement.
//      KkiaPay signe en HMAC-SHA256 ; PayPal fait vérifier sa signature par sa
//      propre API. Un webhook non authentifiable est REFUSÉ, pas « toléré ».
//
//   3. L'ENCAISSEMENT EST IDEMPOTENT. Les deux fournisseurs réémettent leurs
//      notifications jusqu'à obtenir un 200 : sans garde, un même règlement
//      prolongerait l'abonnement à chaque tentative. La contrainte
//      UNIQUE (provider, provider_ref) de la migration 015 est ce garde-fou, et
//      c'est la BASE qui arbitre — pas un test « ai-je déjà vu cette référence »
//      qui laisserait passer deux notifications simultanées.
//
// POURQUOI PAS D'ABONNEMENT RÉCURRENT AUTOMATIQUE : voir renewal dans le README
// de déploiement. Le renouvellement est manuel (le client repaie, extendLicense
// cumule sur le reliquat). C'est assumé pour une première version — le
// prélèvement automatique demande une gestion d'échecs de débit et de
// résiliation qui n'a pas sa place dans le même lot.
// ============================================================================
const crypto = require('crypto');
const db = require('../config/db');
const licenseService = require('./licenseService');
const { priceFor, amountIsSufficient } = require('../config/pricing');
const mailService = require('./mailService');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const KKIAPAY = {
  publicKey: process.env.KKIAPAY_PUBLIC_KEY || '',
  privateKey: process.env.KKIAPAY_PRIVATE_KEY || '',
  secret: process.env.KKIAPAY_SECRET || '',
  // API de vérification : c'est elle qui fait autorité sur le montant réellement
  // encaissé, pas le corps du webhook.
  verifyUrl: process.env.KKIAPAY_VERIFY_URL || 'https://api.kkiapay.me/api/v1/transactions/status',
  // Mode bac à sable du WIDGET, à annoncer à la page de paiement. Le widget doit
  // tourner dans le même mode que les clés utilisées ici : ouvert en test avec
  // des clés de production (ou l'inverse), il crée la transaction dans un
  // environnement et nous la vérifions dans l'autre — le client paie et
  // n'obtient rien.
  sandbox: String(process.env.KKIAPAY_SANDBOX || '').toLowerCase() === 'true',
};

const PAYPAL = {
  clientId: process.env.PAYPAL_CLIENT_ID || '',
  clientSecret: process.env.PAYPAL_CLIENT_SECRET || '',
  webhookId: process.env.PAYPAL_WEBHOOK_ID || '',
  // Bac à sable par défaut : une erreur de configuration doit produire des
  // paiements de test, jamais des débits réels sur les cartes des clients.
  apiBase: process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com',
};

const kkiapayConfigured = () => Boolean(KKIAPAY.privateKey && KKIAPAY.secret);
const paypalConfigured = () => Boolean(PAYPAL.clientId && PAYPAL.clientSecret);

// Site vitrine : c'est lui qui porte la page de tarifs et la page de succès, donc
// c'est là que PayPal doit ramener l'acheteur. Plusieurs URL peuvent être
// déclarées (prévisualisations Vercel) — la première fait foi. Sans valeur, les
// adresses de retour sont omises plutôt qu'inventées : une URL fausse enverrait
// le client sur une page morte après avoir payé.
const LANDING_URL = String(process.env.LANDING_URL || process.env.APP_URL || '')
  .split(',')[0].trim().replace(/\/+$/, '');

/** État des moyens de paiement, pour la page publique de tarifs. */
function providersStatus() {
  return {
    // Seules les données PUBLIQUES : la page de paiement en a besoin pour ouvrir
    // le widget KkiaPay et le bouton PayPal. Les clés privées et le secret HMAC
    // n'apparaissent jamais ici — cette route est publique et non authentifiée.
    kkiapay: {
      available: kkiapayConfigured(),
      public_key: KKIAPAY.publicKey || null,
      sandbox: KKIAPAY.sandbox,
    },
    paypal: {
      available: paypalConfigured(),
      client_id: PAYPAL.clientId || null,
      // Le SDK PayPal du navigateur doit charger la devise dans laquelle la
      // commande est créée, sinon la capture échoue sur un écart de devise.
      currency: 'EUR',
    },
  };
}

// ---------------------------------------------------------------------------
// Appels HTTP
// ---------------------------------------------------------------------------

// axios est déjà une dépendance du backend (package.json) : pas de module
// supplémentaire pour ces deux appels.
const axios = require('axios');

// Délai borné : ces appels ont lieu pendant le traitement d'un webhook, et le
// fournisseur réémettra si nous ne répondons pas. Attendre longtemps ne fait
// qu'accumuler les notifications en attente.
const HTTP_TIMEOUT_MS = 15000;

// ---------------------------------------------------------------------------
// Vérification KkiaPay
// ---------------------------------------------------------------------------

/**
 * Signature du webhook KkiaPay : HMAC-SHA256 du corps BRUT avec le secret.
 *
 * Le corps brut est indispensable — reconstruire du JSON à partir de l'objet
 * analysé change l'ordre des clés et l'espacement, donc l'empreinte. D'où le
 * montage en `express.raw` avant le `express.json()` global (voir app.js).
 */
function verifyKkiapaySignature(rawBody, signature) {
  if (!KKIAPAY.secret || !signature || !rawBody) return false;
  const attendu = crypto.createHmac('sha256', KKIAPAY.secret).update(rawBody).digest('hex');
  const recu = String(signature).trim().toLowerCase();
  // timingSafeEqual exige des longueurs identiques : la comparer d'abord évite
  // l'exception, et une longueur différente est de toute façon un refus.
  if (recu.length !== attendu.length) return false;
  return crypto.timingSafeEqual(Buffer.from(recu), Buffer.from(attendu));
}

/**
 * Interroge KkiaPay sur une transaction. C'est la SEULE source du montant.
 *
 * @returns {Promise<{ok: boolean, status: string, amount: number, currency: string, ref: string, raw: Object}>}
 */
async function verifyKkiapayTransaction(transactionId) {
  const { data } = await axios.post(
    KKIAPAY.verifyUrl,
    { transactionId },
    {
      timeout: HTTP_TIMEOUT_MS,
      headers: {
        'X-API-KEY': KKIAPAY.publicKey,
        'X-PRIVATE-KEY': KKIAPAY.privateKey,
        'X-SECRET-KEY': KKIAPAY.secret,
        'Content-Type': 'application/json',
      },
    }
  );

  // KkiaPay renvoie 'SUCCESS' sur une transaction aboutie. Tout autre état
  // (PENDING, FAILED) n'est pas un encaissement.
  const status = String(data?.status || '').toUpperCase();
  return {
    ok: status === 'SUCCESS',
    status,
    amount: Number(data?.amount) || 0,
    // KkiaPay opère en zone UEMOA : XOF quand la devise n'est pas précisée.
    currency: String(data?.currency || 'XOF').toUpperCase(),
    ref: String(data?.transactionId || transactionId),
    raw: data,
  };
}

// ---------------------------------------------------------------------------
// Vérification PayPal
// ---------------------------------------------------------------------------

/**
 * Jeton d'accès PayPal (OAuth2 client_credentials).
 *
 * Mis en cache : sa durée de vie est de plusieurs heures et chaque webhook en a
 * besoin. Sans cache, une rafale de notifications produirait autant
 * d'authentifications, que PayPal finit par limiter en débit.
 */
let paypalToken = null; // { value, expiresAt }

async function paypalAccessToken() {
  if (paypalToken && paypalToken.expiresAt > Date.now()) return paypalToken.value;

  const identifiants = Buffer.from(`${PAYPAL.clientId}:${PAYPAL.clientSecret}`).toString('base64');
  const { data } = await axios.post(
    `${PAYPAL.apiBase}/v1/oauth2/token`,
    'grant_type=client_credentials',
    {
      timeout: HTTP_TIMEOUT_MS,
      headers: {
        Authorization: `Basic ${identifiants}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );

  // Marge de 60 s : un jeton qui expire pendant l'appel qui l'utilise produirait
  // un 401 impossible à distinguer d'un problème d'identifiants.
  paypalToken = {
    value: data.access_token,
    expiresAt: Date.now() + Math.max(0, (Number(data.expires_in) || 3600) - 60) * 1000,
  };
  return paypalToken.value;
}

/**
 * Fait vérifier la signature du webhook par PayPal lui-même.
 *
 * PayPal ne publie pas de secret partagé : on lui soumet les en-têtes reçus et
 * le corps brut, et son API répond SUCCESS ou FAILURE. Le corps doit être
 * transmis TEL QUEL — d'où, là encore, le montage en `express.raw`.
 */
async function verifyPaypalSignature(headers, rawBody) {
  if (!PAYPAL.webhookId) {
    // Sans PAYPAL_WEBHOOK_ID, aucune vérification n'est possible. On REFUSE :
    // accepter un webhook non vérifié reviendrait à laisser n'importe qui
    // annoncer un paiement PayPal et obtenir une licence.
    console.error('[payment] PAYPAL_WEBHOOK_ID absent — webhook PayPal refusé.');
    return false;
  }

  const token = await paypalAccessToken();
  const { data } = await axios.post(
    `${PAYPAL.apiBase}/v1/notifications/verify-webhook-signature`,
    {
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: PAYPAL.webhookId,
      // Objet et non chaîne : l'API attend le corps analysé à cet emplacement,
      // alors que la signature porte sur les octets bruts.
      webhook_event: JSON.parse(rawBody.toString('utf8')),
    },
    {
      timeout: HTTP_TIMEOUT_MS,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    }
  );

  return String(data?.verification_status).toUpperCase() === 'SUCCESS';
}

/**
 * Crée une commande PayPal au tarif du serveur.
 *
 * LE MONTANT EST CALCULÉ ICI, à partir de config/pricing.js. Le contrôleur ne
 * transmet que la durée : s'il pouvait transmettre un montant, la page de
 * paiement pourrait aussi, et un client achèterait un an pour un centime.
 *
 * @param {number} months
 * @param {string} [customId] contexte à retrouver au retour (voir webhook)
 */
async function createPaypalOrder(months, customId = null) {
  const mois = Math.max(1, Math.min(36, parseInt(months, 10) || 1));
  const tarif = priceFor('paypal');
  // toFixed(2) : PayPal refuse une commande dont la valeur n'a pas exactement
  // deux décimales pour l'EUR ("115" est rejeté, "115.00" accepté).
  const total = (tarif.amount * mois).toFixed(2);

  const token = await paypalAccessToken();
  const { data } = await axios.post(
    `${PAYPAL.apiBase}/v2/checkout/orders`,
    {
      intent: 'CAPTURE',
      purchase_units: [{
        amount: { currency_code: tarif.currency, value: total },
        description: `DocuFlow — abonnement ${mois} mois`,
        // custom_id nous est rendu tel quel dans le webhook et dans le détail de
        // la commande : c'est ainsi qu'on retrouve l'acheteur et la durée sans
        // tenir d'état intermédiaire à recoller ensuite.
        ...(customId ? { custom_id: customId.slice(0, 127) } : {}),
      }],
      application_context: {
        brand_name: 'DocuFlow',
        user_action: 'PAY_NOW',
        locale: 'fr-FR',
        // Sans ces deux adresses, PayPal renvoie le client vers l'URL configurée
        // dans le compte marchand — souvent aucune. L'acheteur approuve alors son
        // paiement et se retrouve bloqué chez PayPal, sans jamais atteindre la
        // page qui déclenche la capture : le règlement reste approuvé mais non
        // encaissé, et aucune licence n'est émise.
        ...(LANDING_URL ? {
          return_url: `${LANDING_URL}/paiement/succes`,
          cancel_url: `${LANDING_URL}/tarifs`,
        } : {}),
      },
    },
    {
      timeout: HTTP_TIMEOUT_MS,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    }
  );

  return {
    order_id: data.id,
    amount: total,
    currency: tarif.currency,
    // Lien de règlement fourni PAR PayPal. Le transmettre évite au navigateur de
    // reconstruire l'URL, ce qui l'obligerait à connaître le mode (bac à sable ou
    // production) : se tromper de domaine afficherait « commande introuvable »,
    // la commande n'existant que dans l'environnement où elle a été créée.
    approve_url: (data.links || []).find((l) => l.rel === 'approve' || l.rel === 'payer-action')?.href || null,
  };
}

/**
 * Encaisse une commande approuvée par le client.
 *
 * Ne renvoie RIEN d'exploitable volontairement : c'est verifyPaypalOrder, juste
 * après, qui établit le montant qui fait foi. Une commande déjà capturée n'est
 * pas une erreur — le client a payé, et PayPal se contente de nous dire qu'il
 * l'avait déjà noté.
 */
async function capturePaypalOrder(orderId) {
  const token = await paypalAccessToken();
  try {
    await axios.post(
      `${PAYPAL.apiBase}/v2/checkout/orders/${orderId}/capture`,
      {},
      {
        timeout: HTTP_TIMEOUT_MS,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      }
    );
  } catch (err) {
    const issue = err.response?.data?.details?.[0]?.issue;
    if (issue !== 'ORDER_ALREADY_CAPTURED') throw err;
  }
}

/** Détail d'une commande PayPal — source du montant, comme pour KkiaPay. */
async function verifyPaypalOrder(orderId) {
  const token = await paypalAccessToken();
  const { data } = await axios.get(`${PAYPAL.apiBase}/v2/checkout/orders/${orderId}`, {
    timeout: HTTP_TIMEOUT_MS,
    headers: { Authorization: `Bearer ${token}` },
  });

  const capture = data?.purchase_units?.[0]?.payments?.captures?.[0];
  const montant = capture?.amount || data?.purchase_units?.[0]?.amount;
  return {
    ok: String(data?.status).toUpperCase() === 'COMPLETED',
    status: String(data?.status || '').toUpperCase(),
    amount: Number(montant?.value) || 0,
    currency: String(montant?.currency_code || 'EUR').toUpperCase(),
    ref: capture?.id || orderId,
    payer_email: data?.payer?.email_address || null,
    raw: data,
  };
}

// ---------------------------------------------------------------------------
// Encaissement
// ---------------------------------------------------------------------------

/**
 * Enregistre un paiement vérifié et émet ou prolonge la licence correspondante.
 *
 * SEUL POINT D'ENTRÉE de la création de licence par paiement, et il n'accepte
 * que des montants déjà confirmés par le fournisseur. L'ordre des opérations
 * compte : le paiement est inséré AVANT toute prolongation, parce que c'est son
 * insertion qui décide s'il s'agit d'une notification neuve ou d'un doublon.
 *
 * @param {Object} p
 * @param {'kkiapay'|'paypal'} p.provider
 * @param {string} p.providerRef  référence chez le fournisseur (clé d'idempotence)
 * @param {number} p.amount       montant CONFIRMÉ par le fournisseur
 * @param {string} p.currency
 * @param {string} [p.customerEmail]
 * @param {string} [p.customerCompany]
 * @param {string} [p.licenseKey]  renouvellement d'une licence existante
 * @param {number} [p.months]
 * @param {Object} [p.raw]         charge utile d'origine, conservée pour litige
 */
async function recordPayment({
  provider, providerRef, amount, currency,
  customerEmail = null, customerCompany = null, licenseKey = null, months = 1, raw = null,
}) {
  const mois = Math.max(1, Math.min(36, parseInt(months, 10) || 1));

  if (!providerRef) {
    // Sans référence, l'idempotence est impossible : le même paiement pourrait
    // être encaissé plusieurs fois. On refuse plutôt que d'insérer un NULL, que
    // la contrainte UNIQUE ne dédoublonnerait pas (NULL ≠ NULL en SQL).
    throw new Error('Référence de transaction absente — encaissement refusé.');
  }

  if (!amountIsSufficient(provider, amount, currency, mois)) {
    const attendu = priceFor(provider);
    console.warn(
      `[payment] Montant insuffisant (${provider}) : ${amount} ${currency} pour ${mois} mois, `
      + `attendu ${attendu ? attendu.amount * mois : '?'} ${attendu?.currency}. Réf ${providerRef}`
    );
    // Le paiement est tout de même tracé, en 'failed' : il y a de l'argent en
    // jeu, et un litige se règle sur des traces. Aucune licence n'est émise.
    await db.query(
      `INSERT INTO payments (provider, provider_ref, amount, currency, status, months, customer_email, raw_payload)
       VALUES ($1, $2, $3, $4, 'failed', $5, $6, $7)
       ON CONFLICT (provider, provider_ref) DO NOTHING`,
      [provider, providerRef, amount, currency, mois, customerEmail, raw ? JSON.stringify(raw) : null]
    );
    return { ok: false, code: 'AMOUNT_MISMATCH', message: 'Montant insuffisant pour cet abonnement.' };
  }

  // Insertion d'abord, et c'est ELLE qui tranche l'idempotence : deux
  // notifications simultanées pour le même règlement se présentent en même temps
  // ici, et la contrainte UNIQUE n'en laisse aboutir qu'une. Un test préalable
  // « cette référence existe-t-elle ? » les laisserait toutes deux passer.
  const { rows: inseres } = await db.query(
    `INSERT INTO payments (provider, provider_ref, amount, currency, status, months, customer_email, raw_payload, paid_at)
     VALUES ($1, $2, $3, $4, 'paid', $5, $6, $7, now())
     ON CONFLICT (provider, provider_ref) DO NOTHING
     RETURNING id`,
    [provider, providerRef, amount, currency, mois, customerEmail, raw ? JSON.stringify(raw) : null]
  );

  if (inseres.length === 0) {
    // Notification déjà traitée. Réponse en succès délibérée : le fournisseur
    // doit cesser de réémettre, et de son point de vue tout s'est bien passé.
    const { rows } = await db.query(
      `SELECT p.id, l.license_key
         FROM payments p LEFT JOIN licenses l ON l.id = p.license_id
        WHERE p.provider = $1 AND p.provider_ref = $2`,
      [provider, providerRef]
    );
    console.log(`[payment] Notification déjà traitée (${provider} ${providerRef}) — ignorée.`);
    return { ok: true, duplicate: true, license_key: rows[0]?.license_key || null };
  }

  const paymentId = inseres[0].id;

  // --- Licence : prolongation d'un abonnement existant, ou émission ---
  let license = null;
  let renouvellement = false;

  if (licenseKey) {
    const existante = await licenseService.findByKey(licenseService.normalizeKey(licenseKey));
    if (existante) {
      // Une licence révoquée ne se réhabilite PAS par un paiement : la révocation
      // est une décision commerciale (fraude, litige) que le vendeur seul lève.
      if (existante.status === 'revoked') {
        console.warn(`[payment] Paiement sur licence révoquée ${existante.license_key} — non prolongée.`);
      } else {
        // extendLicense renvoie la nouvelle ÉCHÉANCE, pas la ligne : la licence
        // est donc relue. S'en dispenser laisserait ici une date là où le reste
        // du code attend un objet (license.id à l'UPDATE, license.license_key
        // dans l'e-mail).
        const echeance = await licenseService.extendLicense(existante.id, mois);
        license = { ...existante, valid_until: echeance, status: 'active' };
        renouvellement = true;
      }
    } else {
      console.warn(`[payment] Clé ${licenseKey} inconnue — une nouvelle licence est émise.`);
    }
  }

  if (!license) {
    license = await licenseService.createLicense({
      customer_email: customerEmail,
      customer_company: customerCompany,
      months: mois,
      notes: `Paiement ${provider} ${providerRef}`,
    });
  }

  await db.query('UPDATE payments SET license_id = $1 WHERE id = $2', [license.id, paymentId]);

  // --- Remise de la clé au client ---
  //
  // Hors transaction et non bloquant : la licence est payée et enregistrée, elle
  // ne doit pas être annulée parce qu'un e-mail n'est pas parti. Le vendeur
  // retrouve la clé dans la console d'administration et peut la renvoyer.
  if (customerEmail) {
    sendLicenseEmail({ email: customerEmail, license, months: mois, renouvellement })
      .catch((err) => console.error('[payment] E-mail de licence non envoyé :', err.message));
  }

  console.log(
    `[payment] ${renouvellement ? 'Renouvellement' : 'Émission'} ${license.license_key} `
    + `(${provider} ${providerRef}, ${amount} ${currency}, ${mois} mois)`
  );

  return {
    ok: true,
    license_key: license.license_key,
    valid_until: license.valid_until,
    renewal: renouvellement,
  };
}

/**
 * Envoie la clé au client.
 *
 * La clé est le livrable : ce message doit être compréhensible sans
 * documentation, et rappeler qu'un abonnement vaut pour UN poste — c'est la
 * source d'incompréhension la plus probable au support.
 */
async function sendLicenseEmail({ email, license, months, renouvellement }) {
  const echeance = license.valid_until
    ? new Date(license.valid_until).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
    : null;

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
      <h2 style="margin:0 0 4px">${renouvellement ? 'Abonnement renouvelé' : 'Votre licence DocuFlow'}</h2>
      <p style="color:#64748b;margin:0 0 24px">
        ${renouvellement
    ? 'Merci. Votre abonnement a été prolongé.'
    : 'Merci pour votre confiance. Voici la clé qui active votre poste.'}
      </p>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:8px">
          Clé de licence
        </div>
        <div style="font-family:ui-monospace,Consolas,monospace;font-size:20px;font-weight:700;letter-spacing:2px">
          ${license.license_key}
        </div>
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px">
        <tr>
          <td style="padding:8px 0;color:#64748b">Durée réglée</td>
          <td style="padding:8px 0;text-align:right;font-weight:600">${months} mois</td>
        </tr>
        ${echeance ? `<tr>
          <td style="padding:8px 0;color:#64748b;border-top:1px solid #f1f5f9">Valable jusqu'au</td>
          <td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #f1f5f9">${echeance}</td>
        </tr>` : ''}
      </table>

      <ol style="color:#334155;font-size:14px;line-height:1.7;padding-left:20px;margin:0 0 24px">
        <li>Ouvrez DocuFlow sur l'ordinateur à équiper.</li>
        <li>Saisissez la clé ci-dessus sur l'écran d'activation.</li>
        <li>C'est terminé : vos documents restent sur cet ordinateur.</li>
      </ol>

      <p style="color:#94a3b8;font-size:13px;line-height:1.6;margin:0">
        Cette licence active <strong>un seul poste de travail</strong>. Pour changer d'ordinateur,
        écrivez-nous : nous transférons la licence sans frais.
      </p>
    </div>`;

  return mailService.sendMail({
    to: email,
    subject: renouvellement ? 'Votre abonnement DocuFlow est renouvelé' : `Votre licence DocuFlow : ${license.license_key}`,
    html,
  });
}

module.exports = {
  providersStatus,
  kkiapayConfigured,
  paypalConfigured,
  verifyKkiapaySignature,
  verifyKkiapayTransaction,
  verifyPaypalSignature,
  createPaypalOrder,
  capturePaypalOrder,
  verifyPaypalOrder,
  recordPayment,
  sendLicenseEmail,
  // Exportés pour les essais : permettent de viser un serveur d'essai sans
  // toucher au code appelant.
  KKIAPAY,
  PAYPAL,
};
