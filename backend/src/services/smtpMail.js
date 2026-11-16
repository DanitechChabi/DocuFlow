// ============================================================================
// smtpMail — envoi des e-mails par le serveur de messagerie de l'organisation
// (SMTP) : Exchange interne (relais, souvent port 25 sans authentification)
// ou Microsoft 365 (smtp.office365.com, port 587, compte d'envoi). C'est la
// voie d'une installation sur le serveur interne : les messages partent de
// la boîte des archives, comme un courriel Outlook ordinaire.
//
// Variables d'environnement (jamais dans un fichier du dépôt) :
//   SMTP_HOST        serveur (ex. mail.afgcsa.com, smtp.office365.com)
//   SMTP_PORT        25, 587 (STARTTLS) ou 465 (TLS direct) — 587 par défaut
//   SMTP_SECURE      true pour le port 465
//   SMTP_USER        compte d'envoi (vide pour un relais sans authentification)
//   SMTP_PASSWORD    son mot de passe
//   SMTP_FROM        adresse d'expédition (ex. archives@afgcsa.com)
//   SMTP_TLS_ACCEPTER_CERTIFICAT_INTERNE=true  certificat d'une autorité
//                    interne non connue de Node (Exchange sur le réseau)
// ============================================================================
const nodemailer = require('nodemailer');

const config = () => ({
  hote: (process.env.SMTP_HOST || '').trim(),
  port: Number(process.env.SMTP_PORT) || 587,
  securise: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
  utilisateur: (process.env.SMTP_USER || '').trim(),
  motDePasse: process.env.SMTP_PASSWORD || '',
  expediteur: (process.env.SMTP_FROM || process.env.SMTP_USER || '').trim(),
  certificatInterne: String(process.env.SMTP_TLS_ACCEPTER_CERTIFICAT_INTERNE || '').toLowerCase() === 'true',
});

function estConfigure() {
  const c = config();
  return Boolean(c.hote && c.expediteur);
}

let transport = null;
let cle = null;
function transporteur() {
  const c = config();
  const k = JSON.stringify(c);
  if (!transport || cle !== k) {
    transport = nodemailer.createTransport({
      host: c.hote,
      port: c.port,
      secure: c.securise,
      auth: c.utilisateur ? { user: c.utilisateur, pass: c.motDePasse } : undefined,
      tls: c.certificatInterne ? { rejectUnauthorized: false } : undefined,
      connectionTimeout: 15000,
    });
    cle = k;
  }
  return transport;
}

/** Nom affiché sans guillemets ni retours à la ligne (en-tête From). */
const nomPropre = (n) => String(n || '').replace(/["\r\n]/g, '').trim();

/**
 * Envoie un e-mail HTML. `nomExpediteur` : nom affiché (« Archives AFGC »).
 * @returns {Promise<{ sent: true, via: 'smtp', id: string }>}
 */
async function envoyer({ to, subject, html, nomExpediteur }) {
  const c = config();
  const nom = nomPropre(nomExpediteur);
  const info = await transporteur().sendMail({
    from: nom ? `"${nom}" <${c.expediteur}>` : c.expediteur,
    to,
    subject,
    html,
  });
  return { sent: true, via: 'smtp', id: info.messageId };
}

/** Vérifie la connexion au serveur (script de test, écran d'administration). */
async function verifier() {
  await transporteur().verify();
  return true;
}

module.exports = { estConfigure, envoyer, verifier, config };
