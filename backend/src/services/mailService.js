/**
 * Service d'envoi d'e-mails transactionnels (nodemailer).
 * Les variables SMTP sont lues depuis .env. Si SMTP n'est pas configuré,
 * l'envoi est ignoré proprement (logs) — l'application reste fonctionnelle.
 */
const nodemailer = require('nodemailer');
require('dotenv').config({ path: './.env' });

const isConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);
const transporter = isConfigured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      // Gmail (587) : STARTTLS obligatoire — nodemailer lève la connexion en TLS
      requireTLS: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })
  : null;

const FROM = `"${process.env.MAIL_FROM_NAME || 'DocuFlow'}" <${process.env.MAIL_FROM || 'noreply@docuflow.local'}>`;
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

/* ---- Templates HTML ---- */

const COLORS = {
  primary: '#0f172a',
  secondary: '#3b82f6',
  slate: '#64748b',
  border: '#e2e8f0',
  bg: '#f8fafc',
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

function layout(body) {
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
              <span style="color:#ffffff;font-size:20px;font-weight:800;letter-spacing:.5px;">${process.env.MAIL_FROM_NAME || 'DocuFlow'}</span>
              <span style="color:${COLORS.secondary};font-size:20px;font-weight:800;">AFGC</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 32px 24px;">
              ${body}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;border-top:1px solid ${COLORS.border};font-size:12px;color:${COLORS.slate};">
              Ceci est un message automatique — merci de ne pas y répondre.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function requestBlock(r) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${COLORS.border};border-radius:12px;margin:16px 0;">
    <tr>
      <td style="padding:16px 20px;font-size:14px;color:${COLORS.slate};">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:${COLORS.slate};margin-bottom:4px;">Entreprise</div>
        <div style="font-weight:700;color:${COLORS.primary};font-size:16px;">${r.nom_entreprise || '—'}</div>
      </td>
    </tr>
    <tr>
      <td style="padding:0 20px 16px;font-size:13px;color:${COLORS.slate};line-height:1.6;">
        Dossier <b>${r.num_dossier || '—'}</b> · Acte <b>${r.num_acte || '—'}</b> · ${r.annee || '—'}<br />
        Type : <b>${r.type_document || '—'}</b> · Priorité : <b>${r.priorite || '—'}</b>
      </td>
    </tr>
  </table>`;
}

function statusPill(status) {
  const color = statusColor(status);
  return `<div style="display:inline-block;padding:6px 14px;border-radius:999px;background:${color}1a;color:${color};border:1px solid ${color}44;font-weight:700;font-size:13px;">${STATUS_LABELS[status] || status}</div>`;
}

const STATUS_LABELS = {
  'en attente': 'En attente',
  'a traiter': 'À traiter',
  'transmis': 'Transmis',
  'livré': 'Livré',
  'rejete': 'Rejeté',
  'annulé': 'Annulé',
};

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

const TEMPLATES = {
  request_created: (r) => ({
    subject: `Accusé de réception — demande ${r.nom_entreprise}`,
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
    `),
  }),

  status_update: (r) => ({
    subject: `Mise à jour de votre demande — ${r.nom_entreprise}`,
    html: layout(`
      <h1 style="font-size:18px;color:${COLORS.primary};margin:0 0 8px;">Mise à jour de votre demande</h1>
      <p style="font-size:14px;color:${COLORS.slate};line-height:1.6;margin:0 0 8px;">
        Bonjour,<br />
        Le statut de votre demande est passé à :
      </p>
      <div style="margin:8px 0 0;">${statusPill(r.statut)}</div>
      ${requestBlock(r)}
      ${ctaButton('Voir ma demande', `${APP_URL}/dashboard`)}
    `),
  }),

  delivered: (r) => ({
    subject: `Votre document est disponible — ${r.nom_entreprise}`,
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
    `),
  }),

  assigned: (r, assigneeName) => ({
    subject: `Nouvelle demande assignée — ${r.nom_entreprise}`,
    html: layout(`
      <h1 style="font-size:18px;color:${COLORS.primary};margin:0 0 8px;">Une demande vous a été assignée</h1>
      <p style="font-size:14px;color:${COLORS.slate};line-height:1.6;margin:0 0 8px;">
        Bonjour${assigneeName ? ` ${assigneeName}` : ''},<br />
        Une demande vous a été confiée pour traitement.
      </p>
      ${requestBlock(r)}
      ${statusPill(r.statut)}
      ${ctaButton('Traiter la demande', `${APP_URL}/dashboard`)}
    `),
  }),
};

/**
 * Envoie un e-mail transactionnel.
 * @param {Object} p - { to, subject, html }
 */
async function sendMail({ to, subject, html }) {
  if (!isConfigured || !transporter) {
    console.log(`[mail] SMTP non configuré — e-mail ignoré pour ${to} : « ${subject} »`);
    return { sent: false, skipped: true };
  }

  // Mode test : redirige TOUS les e-mails vers une seule adresse (dev uniquement).
  // MAIL_TEST_TO défini dans .env → le vrai destinataire est noté dans le sujet.
  const testTo = process.env.MAIL_TEST_TO;
  const actualTo = testTo || to;
  const actualSubject = testTo ? `${subject} [→ ${to}]` : subject;

  try {
    await transporter.sendMail({ from: FROM, to: actualTo, subject: actualSubject, html });
    console.log(`[mail] E-mail envoyé à ${actualTo}${testTo ? ` (redirigé depuis ${to})` : ''} : « ${subject} »`);
    return { sent: true };
  } catch (err) {
    console.error('[mail] Erreur d\'envoi :', err.message);
    return { sent: false, error: err.message };
  }
}

module.exports = { sendMail, TEMPLATES, isConfigured, APP_URL };
