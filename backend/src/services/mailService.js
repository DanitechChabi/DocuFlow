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
const { libelleDemande } = require('../helpers/requestInput');
const settings = require('./settingsService');
const db = require('../config/db');
const microsoft365 = require('./microsoft365Mail');
const smtp = require('./smtpMail');
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
 */
const EVENT_SETTING = {
  // Avec des demandes en un clic, l'accusé de réception peut devenir de trop :
  // l'organisation peut le couper (l'écran confirme déjà chaque demande).
  request_created: 'notify_on_request_created',
  // Nouvelles demandes et listes : un e-mail à l'archive, si l'organisation le veut.
  nouvelle_demande: 'notify_archive_on_request',
  nouvelle_liste: 'notify_archive_on_request',
  // Listes transmises ou retournées d'un geste : un e-mail par agent.
  liste_transmise: 'notify_on_status_change',
  liste_retournee: 'notify_on_status_change',
  complement_demande: 'notify_on_status_change',
  servi_mfiles: 'notify_on_status_change',
  complement_fourni: 'notify_archive_on_request',
  status_update: 'notify_on_status_change',
  delivered: 'notify_on_status_change',
  assigned: 'notify_on_assignment',
  share: 'notify_on_share',
  loan_handover: 'notify_on_status_change',
  loan_returned: 'notify_on_status_change',
  loan_overdue: 'notify_on_status_change',
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
    appUrl: APP_URL,
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
      // Le site de l'organisation (ex. son site dédié) : les liens des e-mails
      // y mènent, plutôt qu'à la plateforme générale.
      appUrl: /^https?:\/\/[^\s"'<>]+$/.test(String(values.app_url || '').trim())
        ? String(values.app_url).trim().replace(/\/+$/, '')
        : APP_URL,
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
  // Demande rapide (migration 023) : sans entreprise, l'objet de la demande est
  // sa description — « Entreprise : — » ne dirait rien au destinataire.
  const titre = r.nom_entreprise ? 'Entreprise' : 'Document demandé';
  const valeur = r.nom_entreprise || r.description;
  const descriptionEnPlus = r.nom_entreprise && r.description
    ? `<div style="margin-top:6px;font-size:13px;color:${COLORS.slate};">${escapeHtml(r.description)}</div>`
    : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${COLORS.border};border-radius:12px;margin:16px 0;">
    <tr>
      <td style="padding:16px 20px;font-size:14px;color:${COLORS.slate};">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:${COLORS.slate};margin-bottom:4px;">${titre}</div>
        <div style="font-weight:700;color:${COLORS.primary};font-size:16px;">${escapeOr(valeur)}</div>${descriptionEnPlus}
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

/** Lien vers une page du site de l'organisation (habillage chargé), sinon de la plateforme. */
function lien(branding, chemin) {
  return `${(branding && branding.appUrl) || APP_URL}${chemin}`;
}

/** Les dossiers d'une liste, en tableau (intitulé, références) ; les suivants résumés. */
function dossiersBlock(dossiers = [], max = 15) {
  const lignes = dossiers.slice(0, max).map((d) => {
    const refs = [d.num_dossier && `Dossier ${d.num_dossier}`, d.num_acte && `Acte ${d.num_acte}`, d.annee].filter(Boolean).join(' · ');
    return `<tr><td style="padding:10px 16px;border-top:1px solid ${COLORS.border};font-size:14px;">
      <div style="font-weight:700;color:${COLORS.primary};">${escapeHtml(libelleDemande(d))}</div>
      ${refs ? `<div style="font-size:12px;color:${COLORS.slate};margin-top:2px;">${escapeHtml(refs)}</div>` : ''}
    </td></tr>`;
  }).join('');
  const reste = dossiers.length - max;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${COLORS.border};border-radius:12px;margin:16px 0;border-collapse:separate;">
    ${lignes}
    ${reste > 0 ? `<tr><td style="padding:10px 16px;border-top:1px solid ${COLORS.border};font-size:13px;color:${COLORS.slate};">… et ${reste} autre${reste > 1 ? 's' : ''}</td></tr>` : ''}
  </table>`;
}

const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;

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
    subject: `Accusé de réception — demande ${sanitizeHeader(libelleDemande(r))}`,
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
      ${ctaButton('Suivre ma demande', lien(branding, '/demandes/mes-demandes'))}
    `, branding),
  }),

  status_update: (r, branding) => ({
    subject: `Mise à jour de votre demande — ${sanitizeHeader(libelleDemande(r))}`,
    html: layout(`
      <h1 style="font-size:18px;color:${COLORS.primary};margin:0 0 8px;">Mise à jour de votre demande</h1>
      <p style="font-size:14px;color:${COLORS.slate};line-height:1.6;margin:0 0 8px;">
        Bonjour,<br />
        Le statut de votre demande est passé à :
      </p>
      <div style="margin:8px 0 0;">${statusPill(r.statut)}</div>
      ${requestBlock(r)}
      ${ctaButton('Voir ma demande', lien(branding, '/demandes/mes-demandes'))}
    `, branding),
  }),

  delivered: (r, branding) => ({
    subject: `Votre document est disponible — ${sanitizeHeader(libelleDemande(r))}`,
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
      ${ctaButton('Télécharger / confirmer', lien(branding, '/demandes/mes-demandes'))}
    `, branding),
  }),

  assigned: (r, branding, assigneeName) => ({
    subject: `Nouvelle demande assignée — ${sanitizeHeader(libelleDemande(r))}`,
    html: layout(`
      <h1 style="font-size:18px;color:${COLORS.primary};margin:0 0 8px;">Une demande vous a été assignée</h1>
      <p style="font-size:14px;color:${COLORS.slate};line-height:1.6;margin:0 0 8px;">
        Bonjour${assigneeName ? ` ${escapeHtml(assigneeName)}` : ''},<br />
        Une demande vous a été confiée pour traitement.
      </p>
      ${requestBlock(r)}
      ${statusPill(r.statut)}
      ${ctaButton('Traiter la demande', lien(branding, '/demandes/a-traiter'))}
    `, branding),
  }),

  // --- Prêt des dossiers physiques (migration 025) ---
  // `extra` : { dateRetour (AAAA-MM-JJ), par (nom de l'archiviste), requireConfirmation }

  loan_handover: (r, branding, extra = {}) => ({
    subject: `Dossier remis — ${sanitizeHeader(libelleDemande(r))}`,
    html: layout(`
      <h1 style="font-size:18px;color:${COLORS.primary};margin:0 0 8px;">Le dossier vous a été remis</h1>
      <p style="font-size:14px;color:${COLORS.slate};line-height:1.6;margin:0 0 8px;">
        Bonjour,<br />
        Le dossier physique demandé vous a été remis${extra.par ? ` par <b>${escapeHtml(extra.par)}</b>` : ''}.
        Merci de le retourner aux archives avant le <b>${escapeHtml(dateFr(extra.dateRetour))}</b>.
      </p>
      ${requestBlock(r)}
      <p style="font-size:13px;color:${COLORS.slate};line-height:1.6;margin:16px 0 0;">
        ${extra.requireConfirmation
          ? 'Merci de <b>confirmer la réception</b> depuis votre espace.'
          : 'Vous n\'avez rien à faire. <b>Si vous n\'avez pas reçu ce dossier</b>, signalez-le depuis votre espace.'}
      </p>
      ${ctaButton(extra.requireConfirmation ? 'Confirmer la réception' : 'Voir ma demande', lien(branding, '/demandes/mes-demandes'))}
    `, branding),
  }),

  loan_returned: (r, branding, extra = {}) => ({
    subject: `Retour enregistré — ${sanitizeHeader(libelleDemande(r))}`,
    html: layout(`
      <h1 style="font-size:18px;color:${COLORS.primary};margin:0 0 8px;">Retour du dossier enregistré ✅</h1>
      <p style="font-size:14px;color:${COLORS.slate};line-height:1.6;margin:0 0 8px;">
        Bonjour,<br />
        Le retour du dossier aux archives a été enregistré${extra.par ? ` par <b>${escapeHtml(extra.par)}</b>` : ''}.
        Ce message vous décharge de sa garde : conservez-le comme preuve de restitution.
      </p>
      ${requestBlock(r)}
    `, branding),
  }),

  // --- Archive : nouvelles demandes et listes ---
  // `extra` : { demandeur (nom de l'agent) }

  nouvelle_demande: (r, branding, extra = {}) => ({
    subject: `Nouvelle demande — ${sanitizeHeader(libelleDemande(r))}`,
    html: layout(`
      <h1 style="font-size:18px;color:${COLORS.primary};margin:0 0 8px;">Nouvelle demande de dossier</h1>
      <p style="font-size:14px;color:${COLORS.slate};line-height:1.6;margin:0 0 8px;">
        Bonjour,<br />
        ${extra.demandeur ? `<b>${escapeHtml(extra.demandeur)}</b> demande` : 'Un agent demande'} le dossier ci-dessous${r.motif ? ` (motif : <b>${escapeHtml(r.motif)}</b>)` : ''}.
      </p>
      ${requestBlock(r)}
      ${ctaButton('Voir les demandes à traiter', lien(branding, '/demandes/a-traiter'))}
    `, branding),
  }),

  nouvelle_liste: (l, branding, extra = {}) => ({
    subject: `Nouvelle liste — ${sanitizeHeader(l.libelle)} (${pluriel((l.dossiers || []).length, 'dossier')})`,
    html: layout(`
      <h1 style="font-size:18px;color:${COLORS.primary};margin:0 0 8px;">Nouvelle liste de dossiers</h1>
      <p style="font-size:14px;color:${COLORS.slate};line-height:1.6;margin:0 0 8px;">
        Bonjour,<br />
        ${extra.demandeur ? `<b>${escapeHtml(extra.demandeur)}</b> a déposé` : 'Un agent a déposé'} la liste
        « <b>${escapeHtml(l.libelle)}</b> »${l.cadre ? ` (motif : <b>${escapeHtml(l.cadre)}</b>)` : ''} :
        ${pluriel((l.dossiers || []).length, 'dossier')} à sortir.
      </p>
      ${dossiersBlock(l.dossiers)}
      ${ctaButton('Voir la liste', lien(branding, '/demandes/a-traiter'))}
    `, branding),
  }),

  // --- Listes transmises ou retournées d'un geste : un e-mail par agent ---
  // `extra` : { dateRetour (AAAA-MM-JJ), par (nom de l'archiviste) }

  liste_transmise: (l, branding, extra = {}) => ({
    subject: `Dossiers transmis — ${sanitizeHeader(l.libelle)} (${pluriel((l.dossiers || []).length, 'dossier')})`,
    html: layout(`
      <h1 style="font-size:18px;color:${COLORS.primary};margin:0 0 8px;">Des dossiers vous ont été transmis</h1>
      <p style="font-size:14px;color:${COLORS.slate};line-height:1.6;margin:0 0 8px;">
        Bonjour,<br />
        ${pluriel((l.dossiers || []).length, 'dossier')} de la liste « <b>${escapeHtml(l.libelle)}</b> » vous
        ${(l.dossiers || []).length > 1 ? 'ont été transmis' : 'a été transmis'}${extra.par ? ` par <b>${escapeHtml(extra.par)}</b>` : ''}.
        ${extra.dateRetour ? `Merci de ${(l.dossiers || []).length > 1 ? 'les' : 'le'} retourner aux archives avant le <b>${escapeHtml(dateFr(extra.dateRetour))}</b>.` : ''}
      </p>
      ${dossiersBlock(l.dossiers)}
      ${ctaButton('Voir mes dossiers', lien(branding, '/demandes/mes-demandes'))}
    `, branding),
  }),

  liste_retournee: (l, branding, extra = {}) => ({
    subject: `Retour enregistré — ${sanitizeHeader(l.libelle)} (${pluriel((l.dossiers || []).length, 'dossier')})`,
    html: layout(`
      <h1 style="font-size:18px;color:${COLORS.primary};margin:0 0 8px;">Retour des dossiers enregistré ✅</h1>
      <p style="font-size:14px;color:${COLORS.slate};line-height:1.6;margin:0 0 8px;">
        Bonjour,<br />
        Le retour aux archives de ${pluriel((l.dossiers || []).length, 'dossier')} de la liste « <b>${escapeHtml(l.libelle)}</b> »
        a été enregistré${extra.par ? ` par <b>${escapeHtml(extra.par)}</b>` : ''}. Ce message vous en décharge :
        conservez-le comme preuve de restitution.
      </p>
      ${dossiersBlock(l.dossiers)}
    `, branding),
  }),

  // Dossier numérisé : copie envoyée depuis M-Files. `extra` : { note, par }
  servi_mfiles: (r, branding, extra = {}) => ({
    subject: `Copie envoyée depuis M-Files — ${sanitizeHeader(libelleDemande(r))}`,
    html: layout(`
      <h1 style="font-size:18px;color:${COLORS.primary};margin:0 0 8px;">Votre dossier vous a été envoyé en copie numérique</h1>
      <p style="font-size:14px;color:${COLORS.slate};line-height:1.6;margin:0 0 8px;">
        Bonjour,<br />
        Ce dossier est numérisé : ${extra.par ? `<b>${escapeHtml(extra.par)}</b> vous` : 'l\'archive vous'} en a envoyé la copie depuis M-Files.
        Le dossier papier reste aux archives.
      </p>
      ${extra.note ? `<div style="margin:12px 0;padding:12px 16px;border-left:4px solid #2563eb;background:#eff6ff;border-radius:8px;font-size:14px;color:#1e3a8a;">${escapeHtml(extra.note)}</div>` : ''}
      ${requestBlock(r)}
      ${ctaButton('Voir mes dossiers', lien(branding, '/demandes/mes-demandes'))}
    `, branding),
  }),

  // --- Compléments (051) ---
  // complement_demande, au demandeur : `extra` : { manque (texte), message, par }
  complement_demande: (r, branding, extra = {}) => ({
    subject: `Demande à compléter — ${sanitizeHeader(libelleDemande(r))}`,
    html: layout(`
      <h1 style="font-size:18px;color:${COLORS.primary};margin:0 0 8px;">L'archive a besoin de précisions</h1>
      <p style="font-size:14px;color:${COLORS.slate};line-height:1.6;margin:0 0 8px;">
        Bonjour,<br />
        L'archive ne peut pas retrouver le dossier ci-dessous${extra.manque ? ` : il manque <b>${escapeHtml(extra.manque)}</b>` : ''}.
      </p>
      ${extra.message ? `<div style="margin:12px 0;padding:12px 16px;border-left:4px solid #f59e0b;background:#fffbeb;border-radius:8px;font-size:15px;color:#78350f;font-style:italic;">« ${escapeHtml(extra.message)} »${extra.par ? `<div style="font-style:normal;font-size:12px;margin-top:4px;">— ${escapeHtml(extra.par)}</div>` : ''}</div>` : ''}
      ${requestBlock(r)}
      <p style="font-size:14px;color:${COLORS.slate};line-height:1.6;margin:12px 0 0;">Complétez-la puis renvoyez-la depuis « Mes dossiers ».</p>
      ${ctaButton('Compléter ma demande', lien(branding, '/demandes/mes-demandes'))}
    `, branding),
  }),

  // complement_fourni, à l'archive : `extra` : { demandeur, reponse }
  complement_fourni: (r, branding, extra = {}) => ({
    subject: `Demande complétée — ${sanitizeHeader(libelleDemande(r))}`,
    html: layout(`
      <h1 style="font-size:18px;color:${COLORS.primary};margin:0 0 8px;">Demande complétée</h1>
      <p style="font-size:14px;color:${COLORS.slate};line-height:1.6;margin:0 0 8px;">
        Bonjour,<br />
        ${extra.demandeur ? `<b>${escapeHtml(extra.demandeur)}</b> a complété` : 'Le demandeur a complété'} sa demande : elle est de retour dans « À traiter ».
      </p>
      ${extra.reponse ? `<div style="margin:12px 0;padding:12px 16px;border-left:4px solid #16a34a;background:#f0fdf4;border-radius:8px;font-size:15px;color:#14532d;font-style:italic;">« ${escapeHtml(extra.reponse)} »</div>` : ''}
      ${requestBlock(r)}
      ${ctaButton('Voir les demandes à traiter', lien(branding, '/demandes/a-traiter'))}
    `, branding),
  }),

  loan_overdue: (r, branding, extra = {}) => ({
    subject: `Dossier à retourner — ${sanitizeHeader(libelleDemande(r))}`,
    html: layout(`
      <h1 style="font-size:18px;color:${COLORS.primary};margin:0 0 8px;">Retour de dossier en retard</h1>
      <p style="font-size:14px;color:${COLORS.slate};line-height:1.6;margin:0 0 8px;">
        Bonjour,<br />
        Le dossier ci-dessous devait être retourné aux archives le <b>${escapeHtml(dateFr(extra.dateRetour))}</b>.
        Merci de le rapporter dès que possible.
      </p>
      ${requestBlock(r)}
      ${ctaButton('Voir ma demande', lien(branding, '/demandes/mes-demandes'))}
    `, branding),
  }),
};

/** AAAA-MM-JJ (ou Date) → JJ/MM/AAAA, sans décalage de fuseau. */
function dateFr(d) {
  if (!d) return '—';
  const s = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

// Code (slug) de chaque organisation, pour savoir par quelle voie elle envoie.
const slugs = new Map();
async function parMicrosoft365(tenantId) {
  if (!tenantId || !microsoft365.estConfigure()) return false;
  if (!slugs.has(tenantId)) {
    try {
      const r = await db.query('SELECT slug FROM tenants WHERE id = $1', [tenantId]);
      slugs.set(tenantId, r.rows[0]?.slug || null);
    } catch {
      return false;
    }
  }
  return microsoft365.concerne(slugs.get(tenantId));
}

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
  // Voie d'envoi, dans l'ordre : le serveur de messagerie de l'organisation
  // (SMTP : installation sur son serveur interne), sa boîte Microsoft 365
  // (Graph, MS365_ORGANISATIONS), sinon le service d'envoi en ligne (Resend).
  const viaSmtp = smtp.estConfigure();
  const viaMicrosoft = !viaSmtp && await parMicrosoft365(tenantId);
  if (!viaSmtp && !viaMicrosoft && (!isConfigured || !resend)) {
    console.log(`[mail] aucun envoi configuré — e-mail ignoré pour ${to} : « ${subject} »`);
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

  if (viaSmtp) {
    try {
      const r = await smtp.envoyer({ to: actualTo, subject: actualSubject, html, nomExpediteur: brand.senderName });
      console.log(`[mail] E-mail envoyé par le serveur de messagerie à ${actualTo}${testTo ? ` (redirigé depuis ${to})` : ''} : « ${subject} »`);
      return r;
    } catch (err) {
      console.error('[mail] Erreur d\'envoi SMTP :', err.message);
      return { sent: false, error: err.message };
    }
  }

  if (viaMicrosoft) {
    try {
      await microsoft365.envoyer({ to: actualTo, subject: actualSubject, html });
      console.log(`[mail] E-mail envoyé par la boîte Microsoft 365 à ${actualTo}${testTo ? ` (redirigé depuis ${to})` : ''} : « ${subject} »`);
      return { sent: true, via: 'microsoft365' };
    } catch (err) {
      console.error('[mail] Erreur d\'envoi Microsoft 365 :', err.message);
      return { sent: false, error: err.message };
    }
  }

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
 * @param {Object} p - { tenantId, to, event, request, assigneeName, extra }
 *        `extra` : données propres à l'événement (prêts : date de retour…)
 */
async function notify({ tenantId, to, event, request, assigneeName = null, extra = null }) {
  const template = TEMPLATES[event];
  if (!template) {
    console.error(`[mail] événement inconnu : « ${event} »`);
    return { sent: false, error: 'unknown_event' };
  }
  if (!to) return { sent: false, skipped: true, reason: 'no_recipient' };

  const branding = await loadBranding(tenantId);
  const { subject, html } = template(request, branding, extra ?? assigneeName);
  return sendMail({ to, subject, html, tenantId, event, branding });
}

/**
 * Envoie l'e-mail d'un événement à des comptes de l'organisation (par leur
 * id) : adresse lue en base, comptes sans adresse ignorés. Ne lève jamais —
 * un courriel manqué ne doit pas défaire le geste qui l'a déclenché ; les
 * appelants peuvent donc ne pas l'attendre (réponse immédiate à l'écran).
 * @returns {Promise<number>} nombre d'e-mails envoyés
 */
async function notifierComptes(tenantId, userIds, event, objet, extra = null) {
  const ids = [...new Set((userIds || []).filter(Boolean).map(Number))];
  if (!ids.length || !envoiPossible()) return 0;
  let envoyes = 0;
  try {
    const r = await db.query(
      "SELECT email FROM users WHERE tenant_id = $1 AND id = ANY($2::int[]) AND COALESCE(email, '') <> ''",
      [tenantId, ids]
    );
    for (const u of r.rows) {
      const res = await notify({ tenantId, to: u.email, event, request: objet, extra });
      if (res.sent) envoyes += 1;
    }
  } catch (err) {
    console.error(`[mail] « ${event} » non envoyé :`, err.message);
  }
  return envoyes;
}

/** Un envoi est-il possible (serveur de messagerie, Microsoft 365 ou service en ligne) ? */
const envoiPossible = () => smtp.estConfigure() || microsoft365.estConfigure() || isConfigured;

module.exports = { sendMail, notify, notifierComptes, loadBranding, TEMPLATES, isConfigured, envoiPossible, APP_URL, EVENT_SETTING };
