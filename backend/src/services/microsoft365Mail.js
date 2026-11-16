// ============================================================================
// microsoft365Mail — envoi des e-mails par une boîte Outlook (Microsoft 365),
// via l'API Microsoft Graph.
//
// Pourquoi Graph et pas le SMTP d'Outlook : le port 587 est bloqué chez
// l'hébergeur (Render) ; Graph passe en HTTPS (443). Les messages partent de
// la boîte de l'organisation, restent dans ses « Éléments envoyés » et
// circulent à l'intérieur de son Microsoft 365 : ils n'arrivent pas en
// indésirables chez ses agents.
//
// Configuration — variables d'environnement du serveur, JAMAIS dans un fichier
// ni dans le code :
//   MS365_TENANT_ID      identifiant de l'annuaire Microsoft Entra de l'organisation
//   MS365_CLIENT_ID      identifiant de l'application autorisée à envoyer (Mail.Send)
//   MS365_CLIENT_SECRET  secret de cette application
//   MS365_SENDER         boîte d'envoi (adresse Outlook de l'organisation)
//   MS365_ORGANISATIONS  espaces DocuFlow (codes, ex. « afgc ») qui envoient par
//                        cette boîte, séparés par des virgules. Les autres
//                        espaces gardent l'envoi habituel : une organisation ne
//                        peut pas écrire au nom d'une autre.
// ============================================================================

const config = () => ({
  annuaire: (process.env.MS365_TENANT_ID || '').trim(),
  client: (process.env.MS365_CLIENT_ID || '').trim(),
  secret: process.env.MS365_CLIENT_SECRET || '',
  boite: (process.env.MS365_SENDER || '').trim(),
  organisations: String(process.env.MS365_ORGANISATIONS || '')
    .split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean),
});

/** Les quatre valeurs de connexion sont-elles posées ? */
function estConfigure() {
  const c = config();
  return Boolean(c.annuaire && c.client && c.secret && c.boite);
}

/** Cet espace (code) envoie-t-il ses e-mails par la boîte Microsoft 365 ? */
function concerne(slug) {
  return estConfigure() && Boolean(slug) && config().organisations.includes(String(slug).toLowerCase());
}

// Jeton d'accès de l'application, réutilisé jusqu'à une minute de son expiration.
let jeton = null;

/** Oublie le jeton (tests, ou refus de Graph). */
function oublierJeton() { jeton = null; }

async function obtenirJeton(fetchImpl = fetch) {
  if (jeton && jeton.expire > Date.now() + 60_000) return jeton.valeur;
  const c = config();
  const r = await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(c.annuaire)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.client,
      client_secret: c.secret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }).toString(),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) {
    // Le message de Microsoft peut citer l'application ; jamais le secret.
    throw new Error(`autorisation Microsoft refusée (${r.status}${d.error ? ` : ${d.error}` : ''})`);
  }
  jeton = { valeur: d.access_token, expire: Date.now() + (Number(d.expires_in) || 3600) * 1000 };
  return jeton.valeur;
}

/**
 * Envoie un e-mail HTML depuis la boîte de l'organisation.
 * @returns {Promise<{ sent: true, via: 'microsoft365' }>}
 */
async function envoyer({ to, subject, html }, fetchImpl = fetch) {
  const { boite } = config();
  const valeur = await obtenirJeton(fetchImpl);
  const r = await fetchImpl(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(boite)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${valeur}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: true,
    }),
  });
  if (r.status === 401) oublierJeton();
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(`Microsoft Graph a refusé l'envoi (${r.status}${d.error?.code ? ` : ${d.error.code}` : ''})`);
  }
  return { sent: true, via: 'microsoft365' };
}

module.exports = { estConfigure, concerne, envoyer, obtenirJeton, oublierJeton };
