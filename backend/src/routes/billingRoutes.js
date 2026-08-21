// ============================================================================
// billingRoutes — routes PUBLIQUES d'achat d'un abonnement.
//
// Aucun authMiddleware, et c'est délibéré : l'acheteur n'a pas encore de compte
// — il achète justement le logiciel qui lui en créera un. La sécurité ne repose
// donc PAS sur l'identité de l'appelant mais sur deux invariants :
//
//   • le montant est fixé par le serveur (config/pricing.js), jamais reçu ;
//   • aucune licence n'est émise sans confirmation du FOURNISSEUR (appel sortant
//     vers KkiaPay/PayPal, ou signature vérifiée pour un webhook).
//
// POURQUOI CHAQUE ROUTE DÉCLARE SON ANALYSEUR DE CORPS
// Les webhooks doivent recevoir les OCTETS BRUTS : la signature HMAC de KkiaPay
// et la vérification PayPal portent sur eux, et réencoder l'objet analysé
// changerait l'ordre des clés donc l'empreinte. Or body-parser saute tout corps
// déjà lu (`req._body`) : un express.json() global passé avant ce routeur
// remplirait req.body d'un objet, et l'express.raw des webhooks ne servirait à
// rien — la vérification échouerait sur TOUS les paiements, silencieusement.
//
// Ce routeur est donc monté dans app.js AVANT l'express.json() global, et
// chaque route porte l'analyseur qui lui convient. Ce petit surcroît de
// verbosité est ce qui rend la contrainte visible et non contournable par
// inadvertance.
// ============================================================================
const express = require('express');
const router = express.Router();
const billingController = require('../controllers/billingController');

// Limite à 1 Mo au lieu des 10 Mo du reste de l'application : une notification
// de paiement fait quelques kilo-octets. Un corps plus gros n'est pas légitime,
// et l'analyser n'offrirait qu'un levier de saturation sur des routes publiques
// et non authentifiées.
const corpsBrut = express.raw({ type: '*/*', limit: '1mb' });
const corpsJson = express.json({ limit: '100kb' });

// Tarif public et moyens de paiement réellement configurés. Aucun corps.
router.get('/pricing', billingController.pricing);

// --- Webhooks (fournisseur → nous) -----------------------------------------
router.post('/webhook/kkiapay', corpsBrut, billingController.kkiapayWebhook);
router.post('/webhook/paypal', corpsBrut, billingController.paypalWebhook);

// --- Confirmation depuis le navigateur -------------------------------------
// Doublent les webhooks pour afficher la clé immédiatement après le paiement.
// L'idempotence de recordPayment fait que le premier arrivé gagne et que le
// second n'encaisse rien.
router.post('/paypal/order', corpsJson, billingController.createPaypalOrder);
router.post('/paypal/capture', corpsJson, billingController.capturePaypalOrder);
router.post('/kkiapay/confirm', corpsJson, billingController.confirmKkiapay);

module.exports = router;
