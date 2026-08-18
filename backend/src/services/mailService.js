/**
 * Service d'envoi d'e-mails transactionnels (Resend).
 * Le port SMTP 587 étant bloqué sur Render (free), l'envoi passe par l'API
 * Resend en HTTPS (port 443). La clé API est lue depuis .env (RESEND_API_KEY).
 * Si elle est absente, l'envoi est ignoré proprement (logs) — l'application
 * reste fonctionnelle (notifications internes uniquement).
 *
 * Les réglages de la console de configuration sont appliqués ici : nom de
 * l'expéditeur, signature, mention de pied de page et bascules d'activation.
 * Ils étaient auparavant purement décoratifs — l'expéditeur était figé au
 * chargement du module depuis MAIL_FROM_NAME, si bien qu'un administrateur
 * décochant « Notifications par e-mail » continuait d'en recevoir.
 */
const { Resend } = require('resend');
const { escapeHtml, escapeOr, sanitizeHeader } = require('../helpers/htmlEscape');
const settings = require('./settingsService');
require('dotenv').config({ path: './.env' });

const isConfigured = Boolean(process.env.RESEND_API_KEY);
const resend = isConfigured ? new Resend(process.env.RESEND_API_KEY) : null;

const APP_URL = process.env.APP_URL || 'http://localhost:5173';

// Adresse d'expédition : RESEND_FROM si un domaine a été vérifié sur Resend,
// sinon onboarding@resend.dev (envoi test — uniquement vers l'e-mail du compte).
// Seule l'adresse vient de l'environnement ; le nom affiché est propre à chaque
// organisation et se décide donc à l'envoi, pas au chargement du module.
const FROM_ADDRESS = process.env.RESEND_FROM || 'onboarding@resend.dev';

/**
 * Compose l'en-tête `From`. Le nom affiché provient de la base (réglage
 * `email_sender_name`, saisi par un administrateur) et atterrit dans un en-tête
 * SMTP entre guillemets : un guillemet ou un retour chariot y disloquerait
 * l'en-tête. Les deux sont donc retirés.
 */
function buildFrom(senderName) {
  const name = sanitizeHeader(senderName || process.env.MAIL_FROM_NAME || 'DocuFlow')
    .replace(/"/g, '')
    .trim();
  return `"${name || 'DocuFlow'}" <${FROM_ADDRESS}>`;
}

/**
 * Bascule d'activation propre à chaque événement, en complément de
 * l'interrupteur général `enable_email_notifications`.
 * `request_created` n'en a pas : c'est l'accusé de réception du demandeur, pas
 * une alerte de suivi — le désactiver laisserait une demande sans confirmation.
 */
const EVENT_SETTING = {
  status_update: 'notify_on_status_change',
  delivered: 'notify_on_status_change',
  assigned: 'notify_on_assignment',
  share: 'notify_on_share',
};

/**
 * Réglages d'habillage des e-mails d'une organisation.
 * En cas d'indisponibilité de la base, on retombe sur les valeurs
 * d'environnement : un e-mail sans signature vaut mieux qu'un e-mail perdu.
 */
async function loadBranding(tenantId) {
  const fallback = {
    senderName: process.env.MAIL_FROM_NAME || 'DocuFlow',
    siteName: process.env.MAIL_FROM_NAME || 'DocuFlow',
    signature: null,
    footerText: null,
    emailsEnabled: true,
    values: null,
  };
  if (!tenantId) return fallback;

  try {
    const values = await settings.getAll(tenantId);
    return {
      senderName: values.email_sender_name || fallback.senderName,
      siteName: values.site_name || values.email_sender_name || fallback.siteName,
      signature: values.email_signature || null,
      footerText: values.footer_text || null,
      emailsEnabled: values.enable_email_notifications !== false,
      values,
    };
  } catch (err) {
    console.warn(`[mail] réglages de l'organisation ${tenantId} illisibles, valeurs par défaut :`, err.message);
    return fallback;
  }
}

/* ---- Templates HTML ---- */

const COLORS = {
  primary: '#0f172a',
  secondary: '#3b82f6',
  slate: '#64748b',
  border: '#e2e8f0',
  bg: '#f8fafc',
};

const STATUS_LABELS = {
  'en attente': 'En attente',
  'a traiter': 'À traiter',
  'transmis': 'Transmis',
  'livré': 'Livré',
  'rejete': 'Rejeté',
  'annulé': 'Annulé',
};

const statusColor = (status) => {
  const map = {
    'en attente': '#ea580c',
    'a traiter': '#9333ea',
    'transmis': '#16a34a',
    'livré': '#2563eb',
    'rejete': '#dc2626',
    'annulé': '#64748b',
  };
  return map[status] || COLORS.slate;
};

/**
 * Convertit un texte libre saisi par un administrateur (signature, pied de
 * page) en HTML sûr. L'échappement précède la conversion des retours à la
 * ligne : dans l'ordre inverse, les `<br />` insérés seraient eux-mêmes
 * échappés et s'afficheraient littéralement.
 */
function richText(value) {
  if (!value || String(value).trim() === '') return '';
  return escapeHtml(String(value).trim()).replace(/\r?\n/g, '<br />');
}

function layout(body, branding = {}) {
  const heading = escapeHtml(branding.siteName || process.env.MAIL_FROM_NAME || 'DocuFlow');
  const signature = richText(branding.signature);
  const footer = richText(branding.footerText);

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="margin:0;padding:0;background:${COLORS.bg};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.bg};padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;border:1px solid ${COLORS.border};overflow:hidden;">
          <tr>
            <td style="background:${COLORS.primary};padding:24px 32px;">
              <span style="color:#ffffff;font-size:20px;font-weight:800;letter-spacing:.5px;">${heading}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 32px 24px;">
              ${body}
              ${signature ? `<div style="margin:24px 0 0;padding-top:16px;border-top:1px solid ${COLORS.border};font-size:13px;color:${COLORS.slate};line-height:1.6;">${signature}</div>` : ''}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;border-top:1px solid ${COLORS.border};font-size:12px;color:${COLORS.slate};">
              Ceci est un message automatique — merci de ne pas y répondre.
              ${footer ? `<div style="margin-top:6px;">${footer}</div>` : ''}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Les champs de demande viennent de `req.body` (createRequest) et sont stockés
// bruts : ils sont échappés ici, au point de rendu, et non à l'enregistrement —
// la base garde la valeur saisie, seul le HTML est neutralisé.
function requestBlock(r) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${COLORS.border};border-radius:12px;margin:16px 0;">
    <tr>
      <td style="padding:16px 20px;font-size:14px;color:${COLORS.slate};">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:${COLORS.slate};margin-bottom:4px;">Entreprise</div>
        <div style="font-weight:700;color:${COLORS.primary};font-size:16px;">${escapeOr(r.nom_entreprise)}</div>
      </td>
    </tr>
    <tr>
      <td style="padding:0 20px 16px;font-size:13px;color:${COLORS.slate};line-height:1.6;">
        Dossier <b>${escapeOr(r.num_dossier)}</b> · Acte <b>${escapeOr(r.num_acte)}</b> · ${escapeOr(r.annee)}<br />
        Type : <b>${escapeOr(r.type_document)}</b> · Priorité : <b>${escapeOr(r.priorite)}</b>
      </td>
    </tr>
  </table>`;
}

// `statusColor` et `STATUS_LABELS` sont des tables fermées, mais un statut absent
// de STATUS_LABELS retombe sur `status` lui-même : on l'échappe donc aussi.
function statusPill(status) {
  const color = statusColor(status);
  return `<div style="display:inline-block;padding:6px 14px;border-radius:999px;background:${color}1a;color:${color};border:1px solid ${color}44;font-weight:700;font-size:13px;">${escapeHtml(STATUS_LABELS[status] || status)}</div>`;
}

function ctaButton(label, url) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 0;">
    <tr>
      <td style="border-radius:10px;background:${COLORS.secondary};padding:12px 24px;">
        <a href="${url}" style="color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;">${label}</a>
      </td>
    </tr>
  </table>`;
}

/* ---- Templates par événement ---- */
// Signature : (requête, habillage, ...extras) → { subject, html }.
// `branding` est facultatif : appelé sans lui, le gabarit reste rendu avec les
// valeurs d'environnement (compatibilité avec les appels existants et les tests).

const TEMPLATES = {
  request_created: (r, branding) => ({
    subject: `Accusé de réception — demande ${sanitizeHeader(r.nom_entreprise)}`,
    html: layout(`
      <h1 style="font-size:18px;color:${COLORS.primary};margin:0 0 8px;">Demande bien reçue ✅</h1>
      <p style="font-size:14px;color:${COLORS.slate};line-height:1.6;margin:0 0 8px;">
        Bonjour,<br />
        Votre demande a bien été enregistrée et est <b>en attente</b> de traitement par nos services.
      </p>
      ${requestBlock(r)}
      ${statusPill('en attente')}
      <p style="font-size:13px;color:${COLORS.slate};line-height:1.6;margin:16px 0 0;">
        Vous serez notifié par e-mail à chaque changement de statut.
      </p>
      ${ctaButton('Suivre ma demande', `${APP_URL}/dashboard`)}
    `, branding),
  }),

  status_update: (r, branding) => ({
    subject: `Mise à jour de votre demande — ${sanitizeHeader(r.nom_entreprise)}`,
    html: layout(`
      <h1 style="font-size:18px;color:${COLORS.primary};margin:0 0 8px;">Mise à jour de votre demande</h1>
      <p style="font-size:14px;color:${COLORS.slate};line-height:1.6;margin:0 0 8px;">
        Bonjour,<br />
        Le statut de votre demande est passé à :
      </p>
      <div style="margin:8px 0 0;">${statusPill(r.statut)}</div>
      ${requestBlock(r)}
      ${ctaButton('Voir ma demande', `${APP_URL}/dashboard`)}
    `, branding),
  }),

  delivered: (r, branding) => ({
    subject: `Votre document est disponible — ${sanitizeHeader(r.nom_entreprise)}`,
    html: layout(`
      <h1 style="font-size:18px;color:${COLORS.primary};margin:0 0 8px;">Votre document a été livré 🎉</h1>
      <p style="font-size:14px;color:${COLORS.slate};line-height:1.6;margin:0 0 8px;">
        Bonjour,<br />
        Le document demandé est désormais <b>livré</b> et disponible dans votre espace.
      </p>
      ${requestBlock(r)}
      ${statusPill('livré')}
      <p style="font-size:13px;color:${COLORS.slate};line-height:1.6;margin:16px 0 0;">
        Merci de confirmer la bonne réception via votre espace de suivi.
      </p>
      ${ctaButton('Télécharger / confirmer', `${APP_URL}/dashboard`)}
    `, branding),
  }),

  assigned: (r, branding, assigneeName) => ({
    subject: `Nouvelle demande assignée — ${sanitizeHeader(r.nom_entreprise)}`,
    html: layout(`
      <h1 style="font-size:18px;color:${COLORS.primary};margin:0 0 8px;">Une demande vous a été assignée</h1>
      <p style="font-size:14px;color:${COLORS.slate};line-height:1.6;margin:0 0 8px;">
        Bonjour${assigneeName ? ` ${escapeHtml(assigneeName)}` : ''},<br />
        Une demande vous a été confiée pour traitement.
      </p>
      ${requestBlock(r)}
      ${statusPill(r.statut)}
      ${ctaButton('Traiter la demande', `${APP_URL}/dashboard`)}
    `, branding),
  }),
};

/**
 * Envoie un e-mail transactionnel.
 *
 * @param {Object} p
 * @param {string} p.to        - destinataire
 * @param {string} p.subject   - sujet (nettoyé des retours chariot)
 * @param {string} p.html      - corps HTML déjà rendu
 * @param {number} [p.tenantId] - organisation, pour lire ses réglages
 * @param {string} [p.event]   - clé d'événement (voir EVENT_SETTING)
 * @param {Object} [p.branding] - habillage déjà chargé, pour éviter une relecture
 * @returns {Promise<{sent: boolean, skipped?: boolean, reason?: string, id?: string, error?: string}>}
 */
async function sendMail({ to, subject, html, tenantId = null, event = null, branding = null }) {
  if (!isConfigured || !resend) {
    console.log(`[mail] Resend non configuré — e-mail ignoré pour ${to} : « ${subject} »`);
    return { sent: false, skipped: true, reason: 'not_configured' };
  }

  const brand = branding || (await loadBranding(tenantId));

  // Interrupteur général, puis bascule propre à l'événement. Le refus est
  // renvoyé à l'appelant avec son motif : un partage silencieusement non envoyé
  // qui annonce « succès » est exactement le défaut que ces réglages doivent
  // éviter, pas en introduire un nouveau.
  if (!brand.emailsEnabled) {
    console.log(`[mail] notifications désactivées pour l'organisation ${tenantId} — e-mail non envoyé à ${to}`);
    return { sent: false, skipped: true, reason: 'notifications_disabled' };
  }
  const eventKey = event && EVENT_SETTING[event];
  if (eventKey && brand.values && brand.values[eventKey] === false) {
    console.log(`[mail] « ${eventKey} » désactivé pour l'organisation ${tenantId} — e-mail non envoyé à ${to}`);
    return { sent: false, skipped: true, reason: eventKey };
  }

  // Mode test : redirige TOUS les e-mails vers une seule adresse (dev uniquement).
  // MAIL_TEST_TO défini dans .env → le vrai destinataire est noté dans le sujet.
  const testTo = process.env.MAIL_TEST_TO;
  const actualTo = testTo || to;
  const actualSubject = sanitizeHeader(testTo ? `${subject} [→ ${to}]` : subject);

  try {
    const { data, error } = await resend.emails.send({
      from: buildFrom(brand.senderName),
      to: [actualTo],
      subject: actualSubject,
      html,
    });
    if (error) {
      console.error(`[mail] Erreur Resend : ${error.message}`);
      return { sent: false, error: error.message };
    }
    console.log(`[mail] E-mail envoyé à ${actualTo}${testTo ? ` (redirigé depuis ${to})` : ''} : « ${subject} » (id ${data?.id})`);
    return { sent: true, id: data?.id };
  } catch (err) {
    console.error('[mail] Erreur d\'envoi :', err.message);
    return { sent: false, error: err.message };
  }
}

/**
 * Envoie une notification d'événement : charge l'habillage de l'organisation,
 * rend le gabarit correspondant, puis délègue à `sendMail`.
 *
 * Point d'entrée unique des e-mails de suivi de demande — les appelants n'ont
 * ainsi pas à connaître les réglages ni à composer le gabarit eux-mêmes.
 *
 * @param {Object} p - { tenantId, to, event, request, assigneeName }
 */
async function notify({ tenantId, to, event, request, assigneeName = null }) {
  const template = TEMPLATES[event];
  if (!template) {
    console.error(`[mail] événement inconnu : « ${event} »`);
    return { sent: false, error: 'unknown_event' };
  }
  if (!to) return { sent: false, skipped: true, reason: 'no_recipient' };

  const branding = await loadBranding(tenantId);
  const { subject, html } = template(request, branding, assigneeName);
  return sendMail({ to, subject, html, tenantId, event, branding });
}

module.exports = { sendMail, notify, loadBranding, TEMPLATES, isConfigured, APP_URL };
