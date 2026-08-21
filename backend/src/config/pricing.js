// ============================================================================
// Tarifs de l'abonnement DocuFlow — source unique de vérité.
//
// 75 000 FCFA / mois. PayPal ne supporte PAS le franc CFA (XOF) : le montant y
// est donc libellé en euros. Le peg XOF/EUR est FIXE à 655,957 (garantie du
// Trésor français), donc 75 000 XOF = 114,34 € exactement, arrondi à 115 € pour
// une facture lisible. Ce n'est pas un taux de change flottant : il n'y a aucun
// risque de dérive entre les deux prix.
//
// Ces montants sont la référence côté SERVEUR. Un webhook de paiement annonce
// toujours un montant ; il ne faut jamais le croire sur parole (le client peut
// avoir manipulé la requête de création). paymentService compare au tarif ci-
// dessous avant d'activer une licence.
// ============================================================================

// Peg officiel, pour mémoire et pour recalculer si le tarif FCFA change.
const XOF_PER_EUR = 655.957;

const PRICING = {
  // Mobile Money / cartes via KkiaPay — devise locale.
  XOF: {
    amount: 75000,
    currency: 'XOF',
    label: '75 000 FCFA',
    provider: 'kkiapay',
  },
  // PayPal — le XOF n'étant pas supporté, équivalent arrondi.
  EUR: {
    amount: 115,
    currency: 'EUR',
    label: '115 €',
    provider: 'paypal',
  },
};

/** Tarif attendu pour un fournisseur donné. */
function priceFor(provider) {
  if (provider === 'kkiapay') return PRICING.XOF;
  if (provider === 'paypal') return PRICING.EUR;
  return null;
}

/**
 * Le montant encaissé correspond-il au tarif du fournisseur ?
 *
 * Tolérance de 1 unité : PayPal peut renvoyer « 115.00 » et certains
 * agrégateurs arrondissent au franc près. Au-delà, on refuse — un écart réel
 * signale soit une manipulation, soit un changement de tarif non répercuté.
 * Un paiement SUPÉRIEUR est accepté (le client a payé plus, ce n'est pas à son
 * détriment) ; c'est le paiement insuffisant qui est rejeté.
 */
function amountIsSufficient(provider, amount, currency, months = 1) {
  const price = priceFor(provider);
  if (!price) return false;
  if (String(currency).toUpperCase() !== price.currency) return false;
  const expected = price.amount * Math.max(1, months);
  return Number(amount) >= expected - 1;
}

module.exports = { PRICING, XOF_PER_EUR, priceFor, amountIsSufficient };
