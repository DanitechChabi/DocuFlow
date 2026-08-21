// ============================================================================
// billingController — parcours d'achat d'un abonnement DocuFlow.
//
// TROIS FAMILLES DE ROUTES, TROIS NIVEAUX DE CONFIANCE
//
//   • Publiques informatives (GET /pricing) — le tarif et les moyens de paiement
//     disponibles, lus par la page de tarifs. Aucun effet de bord.
//
//   • Publiques de paiement (POST /paypal/order, POST /kkiapay/confirm) —
//     appelées par le navigateur du client. Elles ne CRÉENT JAMAIS de licence
//     sur la seule parole du client : elles font toujours confirmer le montant
//     par le fournisseur avant d'appeler paymentService.recordPayment.
//
//   • Webhooks (POST /webhook/kkiapay, POST /webhook/paypal) — appelées par le
//     fournisseur. Signature vérifiée, sinon refus. Elles reçoivent le corps
//     BRUT (Buffer), monté en express.raw AVANT l'express.json global.
//
// POURQUOI DEUX CHEMINS POUR LE MÊME PAIEMENT
// Le webhook est la source fiable (il arrive même si le client ferme son
// navigateur), mais il peut mettre plusieurs secondes. La route de confirmation
// permet à la page de succès d'afficher la clé tout de suite. Les deux passent
// par recordPayment, dont l'idempotence garantit qu'un règlement n'est encaissé
// qu'une fois, quel que soit celui des deux qui arrive en premier.
// ============================================================================
const paymentService = require('../services/paymentService');
const { PRICING } = require('../config/pricing');

/** Adresse e-mail plausible et bornée — elle part en base et dans un envoi. */
function normalizeEmail(input) {
  if (!input) return null;
  const valeur = String(input).trim().toLowerCase().slice(0, 255);
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valeur) ? valeur : null;
}

function normalizeText(input, max = 255) {
  if (!input) return null;
  return String(input).replace(/[\r\n]/g, ' ').trim().slice(0, max) || null;
}

/** Durée réglée. Bornée à 36 mois, comme la contrainte CHECK de la table. */
const normalizeMonths = (input) => Math.max(1, Math.min(36, parseInt(input, 10) || 1));

/**
 * GET /api/billing/pricing — tarif public et moyens de paiement actifs.
 *
 * La page de tarifs s'en sert pour n'afficher que les boutons réellement
 * utilisables : proposer PayPal quand les identifiants manquent produirait un
 * échec au clic, ce qui coûte une vente.
 */
exports.pricing = (req, res) => {
  res.json({
    monthly: {
      xof: PRICING.XOF,
      eur: PRICING.EUR,
    },
    providers: paymentService.providersStatus(),
  });
};

// ---------------------------------------------------------------------------
// PayPal
// ---------------------------------------------------------------------------

/**
 * POST /api/billing/paypal/order — crée une commande PayPal.
 *
 * LE MONTANT EST FIXÉ ICI, côté serveur, à partir de pricing.js. Le client
 * n'envoie que la durée et ses coordonnées : s'il pouvait transmettre le
 * montant, il achèterait un an à un franc.
 */
exports.createPaypalOrder = async (req, res) => {
  if (!paymentService.paypalConfigured()) {
    return res.status(503).json({
      message: 'Le paiement par PayPal n\'est pas disponible pour le moment.',
      code: 'PAYPAL_UNAVAILABLE',
    });
  }

  const months = normalizeMonths(req.body?.months);
  const contexte = JSON.stringify({
    m: months,
    e: normalizeEmail(req.body?.customer_email),
    c: normalizeText(req.body?.customer_company),
    k: normalizeText(req.body?.license_key, 64),
  });

  try {
    const commande = await paymentService.createPaypalOrder(months, contexte);
    return res.json(commande);
  } catch (err) {
    console.error('[billing] Création de commande PayPal échouée :', err.response?.data || err.message);
    return res.status(502).json({
      message: 'Impossible de joindre PayPal. Réessayez dans un instant.',
      code: 'PAYPAL_ERROR',
    });
  }
};

/**
 * POST /api/billing/paypal/capture — encaisse la commande après accord du client.
 *
 * Appelée par le navigateur au retour de PayPal. Le montant encaissé est relu
 * depuis PayPal (verifyPaypalOrder) et non repris de la requête.
 */
exports.capturePaypalOrder = async (req, res) => {
  const orderId = normalizeText(req.body?.order_id, 64);
  if (!orderId) return res.status(400).json({ message: 'Référence de commande absente.' });

  try {
    await paymentService.capturePaypalOrder(orderId);

    const commande = await paymentService.verifyPaypalOrder(orderId);
    if (!commande.ok) {
      return res.status(402).json({
        message: 'Le paiement n\'est pas encore confirmé par PayPal.',
        code: 'NOT_COMPLETED',
        status: commande.status,
      });
    }

    const contexte = lireCustomId(commande.raw);
    const resultat = await paymentService.recordPayment({
      provider: 'paypal',
      providerRef: commande.ref,
      amount: commande.amount,
      currency: commande.currency,
      customerEmail: contexte.email || commande.payer_email,
      customerCompany: contexte.company,
      licenseKey: contexte.licenseKey,
      months: contexte.months,
      raw: commande.raw,
    });

    if (!resultat.ok) return res.status(402).json({ message: resultat.message, code: resultat.code });
    return res.json(reponseClient(resultat));
  } catch (err) {
    console.error('[billing] Capture PayPal échouée :', err.response?.data || err.message);
    return res.status(502).json({
      message: 'Le paiement n\'a pas pu être finalisé. Contactez-nous, votre règlement est tracé.',
      code: 'CAPTURE_FAILED',
    });
  }
};

/**
 * Relit le contexte glissé dans custom_id à la création de la commande.
 *
 * Défensif : ce champ traverse PayPal, et une commande créée par un autre moyen
 * (bouton PayPal posé à la main, test) n'en aura pas. Sans repli, la lecture
 * ferait échouer un paiement pourtant valide.
 */
function lireCustomId(raw) {
  const brut = raw?.purchase_units?.[0]?.custom_id;
  const vide = { months: 1, email: null, company: null, licenseKey: null };
  if (!brut) return vide;
  try {
    const objet = JSON.parse(brut);
    return {
      months: normalizeMonths(objet.m),
      email: normalizeEmail(objet.e),
      company: normalizeText(objet.c),
      licenseKey: normalizeText(objet.k, 64),
    };
  } catch {
    return vide;
  }
}

// ---------------------------------------------------------------------------
// KkiaPay (Mobile Money — MTN, Moov — et cartes)
// ---------------------------------------------------------------------------

/**
 * POST /api/billing/kkiapay/confirm — confirme une transaction Mobile Money.
 *
 * Le widget KkiaPay s'exécute dans le navigateur du client et lui rend un
 * `transactionId`. Ce n'est PAS une preuve de paiement : la preuve s'obtient en
 * interrogeant l'API de KkiaPay, ce que fait verifyKkiapayTransaction.
 */
exports.confirmKkiapay = async (req, res) => {
  if (!paymentService.kkiapayConfigured()) {
    return res.status(503).json({
      message: 'Le paiement par Mobile Money n\'est pas disponible pour le moment.',
      code: 'KKIAPAY_UNAVAILABLE',
    });
  }

  const transactionId = normalizeText(req.body?.transaction_id, 128);
  if (!transactionId) return res.status(400).json({ message: 'Référence de transaction absente.' });

  const months = normalizeMonths(req.body?.months);
  const email = normalizeEmail(req.body?.customer_email);
  const company = normalizeText(req.body?.customer_company);
  const licenseKey = normalizeText(req.body?.license_key, 64);

  try {
    const transaction = await paymentService.verifyKkiapayTransaction(transactionId);
    if (!transaction.ok) {
      return res.status(402).json({
        message: 'Ce paiement n\'est pas confirmé par KkiaPay.',
        code: 'NOT_CONFIRMED',
        status: transaction.status,
      });
    }

    const resultat = await paymentService.recordPayment({
      provider: 'kkiapay',
      providerRef: transaction.ref,
      amount: transaction.amount,
      currency: transaction.currency,
      customerEmail: email,
      customerCompany: company,
      licenseKey,
      months,
      raw: transaction.raw,
    });

    if (!resultat.ok) return res.status(402).json({ message: resultat.message, code: resultat.code });
    return res.json(reponseClient(resultat));
  } catch (err) {
    console.error('[billing] Confirmation KkiaPay échouée :', err.response?.data || err.message);
    return res.status(502).json({
      message: 'Vérification du paiement impossible. Votre règlement est tracé, contactez-nous.',
      code: 'VERIFY_FAILED',
    });
  }
};

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/**
 * Réponse d'un webhook.
 *
 * TOUJOURS 200 quand la notification a été COMPRISE, même si elle ne donne lieu
 * à aucune licence (montant insuffisant, transaction échouée) : un code d'erreur
 * ferait réémettre le fournisseur indéfiniment pour un événement que nous avons
 * déjà tranché. Seule une signature invalide justifie un refus explicite.
 */
const accuse = (res, detail) => res.status(200).json({ received: true, ...detail });

/**
 * POST /api/billing/webhook/kkiapay
 * Corps BRUT (express.raw) : la signature HMAC porte sur les octets reçus.
 */
exports.kkiapayWebhook = async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
  const signature = req.headers['x-kkiapay-signature'] || req.headers['x-signature'];

  if (!paymentService.verifyKkiapaySignature(rawBody, signature)) {
    console.warn('[billing] Webhook KkiaPay à signature invalide — refusé.');
    return res.status(401).json({ message: 'Signature invalide.' });
  }

  let evenement;
  try {
    evenement = JSON.parse(rawBody.toString('utf8'));
  } catch {
    // Corps illisible : inutile de faire réémettre, il le sera à l'identique.
    console.warn('[billing] Webhook KkiaPay au corps illisible — ignoré.');
    return accuse(res, { ignored: 'corps illisible' });
  }

  const transactionId = evenement.transactionId || evenement.transaction_id;
  if (!transactionId) return accuse(res, { ignored: 'aucune transaction' });

  try {
    // Même en webhook signé, le montant est relu auprès de KkiaPay : la
    // signature prouve l'origine du message, pas l'exactitude de son contenu.
    const transaction = await paymentService.verifyKkiapayTransaction(transactionId);
    if (!transaction.ok) return accuse(res, { ignored: `transaction ${transaction.status}` });

    const contexte = evenement.data || evenement.state || {};
    const resultat = await paymentService.recordPayment({
      provider: 'kkiapay',
      providerRef: transaction.ref,
      amount: transaction.amount,
      currency: transaction.currency,
      customerEmail: normalizeEmail(contexte.email || evenement.email),
      customerCompany: normalizeText(contexte.company),
      licenseKey: normalizeText(contexte.license_key, 64),
      months: normalizeMonths(contexte.months),
      raw: { webhook: evenement, verification: transaction.raw },
    });

    return accuse(res, { license_issued: resultat.ok && !resultat.duplicate });
  } catch (err) {
    console.error('[billing] Traitement du webhook KkiaPay échoué :', err.message);
    // 500 ici est VOULU : l'échec est de notre côté (base indisponible), et la
    // réémission de KkiaPay est alors exactement ce qu'il faut.
    return res.status(500).json({ message: 'Traitement différé.' });
  }
};

/**
 * POST /api/billing/webhook/paypal
 * Corps BRUT (express.raw) : PayPal vérifie la signature sur les octets reçus.
 */
exports.paypalWebhook = async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));

  let valide = false;
  try {
    valide = await paymentService.verifyPaypalSignature(req.headers, rawBody);
  } catch (err) {
    console.error('[billing] Vérification de signature PayPal impossible :', err.message);
    // Vérification injoignable ≠ signature fausse : on fait réémettre plutôt que
    // de perdre un paiement réel parce que l'API de PayPal était indisponible.
    return res.status(500).json({ message: 'Vérification différée.' });
  }

  if (!valide) {
    console.warn('[billing] Webhook PayPal à signature invalide — refusé.');
    return res.status(401).json({ message: 'Signature invalide.' });
  }

  let evenement;
  try {
    evenement = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return accuse(res, { ignored: 'corps illisible' });
  }

  // Seuls les événements de capture aboutie donnent lieu à une licence. Les
  // autres (commande créée, paiement en attente) sont accusés sans effet.
  const type = evenement.event_type;
  if (type !== 'PAYMENT.CAPTURE.COMPLETED' && type !== 'CHECKOUT.ORDER.APPROVED') {
    return accuse(res, { ignored: type });
  }

  try {
    // On remonte à la commande pour obtenir le montant qui fait foi, plutôt que
    // de lire celui du webhook.
    const ressource = evenement.resource || {};
    const orderId = ressource.supplementary_data?.related_ids?.order_id || ressource.id;
    const commande = await paymentService.verifyPaypalOrder(orderId);
    if (!commande.ok) return accuse(res, { ignored: `commande ${commande.status}` });

    const contexte = lireCustomId(commande.raw);
    const resultat = await paymentService.recordPayment({
      provider: 'paypal',
      providerRef: commande.ref,
      amount: commande.amount,
      currency: commande.currency,
      customerEmail: contexte.email || commande.payer_email,
      customerCompany: contexte.company,
      licenseKey: contexte.licenseKey,
      months: contexte.months,
      raw: { webhook: evenement, verification: commande.raw },
    });

    return accuse(res, { license_issued: resultat.ok && !resultat.duplicate });
  } catch (err) {
    console.error('[billing] Traitement du webhook PayPal échoué :', err.message);
    return res.status(500).json({ message: 'Traitement différé.' });
  }
};

/**
 * Réponse envoyée au navigateur après un paiement abouti.
 *
 * La clé y figure : le client vient de payer et doit pouvoir l'utiliser tout de
 * suite, sans attendre son e-mail (qui peut tomber en indésirables). Aucune
 * autre donnée de la licence n'est exposée.
 */
const reponseClient = (resultat) => ({
  license_key: resultat.license_key,
  valid_until: resultat.valid_until || null,
  renewal: Boolean(resultat.renewal),
  already_processed: Boolean(resultat.duplicate),
});
