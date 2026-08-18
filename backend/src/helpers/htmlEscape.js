/**
 * Échappement HTML pour les sorties rendues comme du balisage (corps d'e-mails).
 *
 * Les gabarits de mailService interpolaient les champs de demande bruts
 * (`nom_entreprise`, `num_dossier`, `type_document`…). Ces champs viennent
 * de `req.body` dans createRequest et sont stockés tels quels : un `<img
 * src=x onerror=…>` saisi dans « Entreprise » se retrouvait donc exécuté
 * dans la boîte de réception de l'archiviste, pas seulement chez l'auteur —
 * injection stockée, et non simple reflet.
 *
 * `escapeHtml` couvre le contenu textuel ET les valeurs d'attribut : les
 * guillemets simples et doubles sont échappés, ce qui suffit à empêcher la
 * sortie d'un attribut cité.
 */

const HTML_ENTITIES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Neutralise le balisage HTML d'une valeur quelconque.
 * `null` et `undefined` rendent une chaîne vide plutôt que « null » / « undefined ».
 * @param {*} value
 * @returns {string}
 */
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => HTML_ENTITIES[c]);
}

/**
 * Comme `escapeHtml`, mais rend un texte de remplacement quand la valeur est
 * vide — les gabarits affichaient « — » via `${r.champ || '—'}`, ce qui
 * laissait passer la valeur non échappée dès qu'elle était renseignée.
 * @param {*} value
 * @param {string} [fallback='—']
 * @returns {string}
 */
function escapeOr(value, fallback = '—') {
  if (value === null || value === undefined || String(value).trim() === '') return fallback;
  return escapeHtml(value);
}

/**
 * Nettoie une valeur destinée à un en-tête d'e-mail (sujet, nom d'expéditeur).
 * Les retours chariot permettraient d'injecter des en-têtes supplémentaires si
 * le transport était SMTP ; l'API HTTP de Resend les transporte en JSON, mais on
 * ne fait pas dépendre la sûreté du choix de transport.
 * @param {*} value
 * @returns {string}
 */
function sanitizeHeader(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[\r\n]+/g, ' ').trim();
}

module.exports = { escapeHtml, escapeOr, sanitizeHeader, HTML_ENTITIES };
