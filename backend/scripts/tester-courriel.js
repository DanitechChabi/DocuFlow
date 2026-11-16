// ============================================================================
// tester-courriel.js — vérifie l'envoi des courriels depuis le serveur :
// connexion au serveur de messagerie, puis un message d'essai.
//   node scripts/tester-courriel.js prenom.nom@afgcsa.com
// (la configuration vient des variables d'environnement : SMTP_HOST…)
// ============================================================================
const smtp = require('../src/services/smtpMail');

(async () => {
  const a = String(process.argv[2] || '').trim();
  if (!/^[^\s@]+@[^\s@]+$/.test(a)) throw new Error('indiquez une adresse : node scripts/tester-courriel.js prenom.nom@afgcsa.com');
  if (!smtp.estConfigure()) throw new Error('SMTP_HOST et SMTP_FROM ne sont pas renseignés dans la configuration.');
  const c = smtp.config();
  console.log(`Serveur ${c.hote}:${c.port}${c.utilisateur ? ` (compte ${c.utilisateur})` : ' (sans authentification)'} · expéditeur ${c.expediteur}`);
  await smtp.verifier();
  console.log('Connexion au serveur de messagerie : OK');
  await smtp.envoyer({
    to: a,
    subject: 'DocuFlow AFGC — essai d\'envoi',
    nomExpediteur: process.env.MAIL_FROM_NAME || 'Archives AFGC',
    html: '<p>Bonjour,</p><p>Ce message confirme que le serveur DocuFlow AFGC peut envoyer des courriels.</p>',
  });
  console.log(`Message d'essai envoyé à ${a}.`);
})().then(() => process.exit(0)).catch((err) => { console.error(`ÉCHEC : ${err.message}`); process.exit(1); });
