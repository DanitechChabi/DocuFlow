// ============================================================================
// courriels.test.js — notifications par courriel (Outlook) des demandes.
// Un petit serveur SMTP de test, local, reçoit les messages : rien ne sort.
// 1. Sans base : gabarits, envoi par le serveur de messagerie (SMTP).
// 2. Avec base : qui reçoit quoi — nouvelle demande, liste, compléments —
//    et les bascules de l'organisation.
// Exécution : npm run test:courriels
// ============================================================================
const net = require('net');

let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };
const avecBase = Boolean(process.env.DB_HOST || process.env.DATABASE_URL);
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

// Serveur SMTP minimal : garde chaque message reçu { de, a: [], donnees }.
const recus = [];
function serveurSmtp() {
  return new Promise((resolve) => {
    const srv = net.createServer((sock) => {
      let courant = { a: [] };
      let enDonnees = false;
      let tampon = '';
      sock.write('220 test ESMTP\r\n');
      sock.on('data', (morceau) => {
        tampon += morceau.toString('utf8');
        let i;
        while ((i = tampon.indexOf('\r\n')) >= 0) {
          const ligne = tampon.slice(0, i);
          tampon = tampon.slice(i + 2);
          if (enDonnees) {
            if (ligne === '.') { enDonnees = false; recus.push(courant); courant = { a: [] }; sock.write('250 OK\r\n'); } else courant.donnees = `${courant.donnees || ''}${ligne}\n`;
            continue;
          }
          const cmd = ligne.slice(0, 4).toUpperCase();
          if (cmd === 'EHLO' || cmd === 'HELO') sock.write('250-test\r\n250 8BITMIME\r\n');
          else if (cmd === 'MAIL') { courant.de = ligne; sock.write('250 OK\r\n'); }
          else if (cmd === 'RCPT') { courant.a.push(ligne.replace(/^RCPT TO:\s*<?|>?$/gi, '')); sock.write('250 OK\r\n'); }
          else if (cmd === 'DATA') { enDonnees = true; sock.write('354 go\r\n'); }
          else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
          else sock.write('250 OK\r\n');
        }
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

(async () => {
  const srv = await serveurSmtp();
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(srv.address().port);
  process.env.SMTP_FROM = 'archives@exemple.test';
  delete process.env.MAIL_TEST_TO;
  const mail = require('./services/mailService');
  const smtp = require('./services/smtpMail');

  console.log('\n1. Gabarits et envoi (sans base)');
  const r = { nom_entreprise: 'Agro <Fictive>', num_acte: '2026/58', type_document: 'Bonne exécution (CBE)' };
  const t1 = mail.TEMPLATES.complement_demande(r, { siteName: 'Archives' }, { manque: 'le n° d\'acte', message: 'Trois <dossiers>', par: 'Carine' });
  ok(/Demande à compléter/.test(t1.subject) && t1.html.includes('Trois &lt;dossiers&gt;') && !t1.html.includes('<dossiers>'), 'compléments demandés : sujet, mot de l\'archive échappé');
  const t2 = mail.TEMPLATES.complement_fourni(r, { siteName: 'Archives' }, { demandeur: 'Nadia', reponse: 'La CBE de mars' });
  ok(/Demande complétée/.test(t2.subject) && t2.html.includes('/demandes/a-traiter'), 'demande complétée : lien vers « À traiter »');
  const t3 = mail.TEMPLATES.nouvelle_demande(r, { siteName: 'Archives', appUrl: 'https://archives.exemple.test' }, { demandeur: 'Nadia' });
  ok(t3.html.includes('https://archives.exemple.test/demandes/a-traiter'), 'nouvelle demande : lien vers le site de l\'organisation');
  ok(smtp.estConfigure() && mail.envoiPossible(), 'serveur de messagerie configuré');
  const env = await mail.sendMail({ to: 'agent@exemple.test', subject: 'Essai', html: '<p>Bonjour</p>', branding: { senderName: 'Archives "AFGC"', emailsEnabled: true, values: {} } });
  ok(env.sent && env.via === 'smtp', 'envoi par SMTP');
  await attendre(100);
  const m = recus[recus.length - 1];
  if (process.env.DEBUG_SMTP) console.log(JSON.stringify(m));
  ok(m && m.a[0] === 'agent@exemple.test' && /From: "?Archives AFGC"? <archives@exemple.test>/.test(m.donnees) && /Subject: Essai/.test(m.donnees), 'expéditeur « Archives AFGC » <archives@…>, destinataire, sujet');

  if (!avecBase) {
    console.log('\n2. Sur PostgreSQL — SAUTÉ');
  } else {
    console.log('\n2. Qui reçoit quoi (PostgreSQL)');
    const db = require('./config/db');
    const s = Date.now();
    const t = (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Test courriels ${s}`, `test-courriels-${s}`])).rows[0].id;
    await require('./services/roleService').provisionRoles(t);
    const compte = async (role, nom, email = `${nom.toLowerCase()}-${s}@exemple.test`) => (await db.query(
      "INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', $3, $4, $5) RETURNING id, full_name, role, tenant_id, email",
      [t, `${nom}-${s}`, nom, email, role])).rows[0];
    const archiviste = await compte('archiviste', 'Carine');
    const agent = await compte('demandeur', 'Nadia');
    const sansAdresse = await compte('demandeur', 'Sansmail', '');
    const pour = (adresse) => recus.filter((x) => x.a.includes(adresse));
    const sujetDe = (x) => (/Subject: (.*)/.exec(x.donnees) || [])[1] || '';

    ok(await mail.notifierComptes(t, [archiviste.id, agent.id, sansAdresse.id, null], 'nouvelle_demande', r, { demandeur: 'Nadia' }) === 2, 'plusieurs comptes : un courriel chacun, sans adresse ignoré');

    const req = (await db.query(
      "INSERT INTO requests (id_user, nom_entreprise, motif, statut, tenant_id) VALUES ($1, 'Agro Fictive', 'Consultation', 'en attente', $2) RETURNING *",
      [agent.id, t])).rows[0];
    const avant = pour(agent.email).length;
    await require('./services/complementService').demander(t, archiviste, req.id, { champs: ['num_acte'], message: 'Plusieurs dossiers à ce nom.' });
    await attendre(400);
    const m1 = pour(agent.email).slice(avant);
    ok(m1.length === 1 && /Demande =C3=A0 compl=C3=A9ter|Demande à compléter|=\?UTF-8\?/i.test(sujetDe(m1[0])), 'compléments demandés : courriel au demandeur');
    const avantArchive = pour(archiviste.email).length;
    await require('./services/complementService').completer(t, agent, req.id, { num_acte: '2026/58', reponse: 'La CBE.' });
    await attendre(400);
    ok(pour(archiviste.email).length === avantArchive + 1, 'demande complétée : courriel à l\'archive');

    const listes = require('./services/listeService');
    await db.query("INSERT INTO settings (tenant_id, key, value) VALUES ($1, 'request_motifs', $2)", [t, JSON.stringify([{ value: 'Soldes créditeurs', label: 'Soldes créditeurs' }])]);
    require('./services/settingsService').invalidate(t);
    const a0 = pour(archiviste.email).length;
    const l = await listes.creer(t, agent, { libelle: 'Liste test', cadre: 'Soldes créditeurs', lignes: [{ nom_entreprise: 'Un Fictif' }, { nom_entreprise: 'Deux Fictif' }] });
    await attendre(400);
    ok(pour(archiviste.email).length === a0 + 1, 'nouvelle liste : UN courriel à l\'archive pour toute la liste');
    const g0 = pour(agent.email).length;
    await listes.transmettre(t, l.id, archiviste, {});
    await attendre(400);
    const mt = pour(agent.email).slice(g0);
    ok(mt.length === 1 && mt[0].donnees.includes('Un Fictif') && mt[0].donnees.includes('Deux Fictif'), 'liste transmise : UN courriel à l\'agent, avec ses 2 dossiers');
    await listes.retourner(t, l.id, archiviste, {});
    await attendre(400);
    ok(pour(agent.email).length === g0 + 2, 'liste retournée : un courriel de décharge');

    await db.query("INSERT INTO settings (tenant_id, key, value) VALUES ($1, 'notify_archive_on_request', 'false') ON CONFLICT (tenant_id, key) DO UPDATE SET value = 'false'", [t]);
    require('./services/settingsService').invalidate(t);
    ok(await mail.notifierComptes(t, [archiviste.id], 'nouvelle_demande', r) === 0, 'bascule « courriel à l\'archive » coupée : rien n\'est envoyé');
    await db.query("INSERT INTO settings (tenant_id, key, value) VALUES ($1, 'enable_email_notifications', 'false') ON CONFLICT (tenant_id, key) DO UPDATE SET value = 'false'", [t]);
    require('./services/settingsService').invalidate(t);
    ok(await mail.notifierComptes(t, [agent.id], 'complement_demande', r) === 0, 'notifications coupées pour l\'organisation : rien n\'est envoyé');
  }
  srv.close();
  console.log(`\n${verifs - echecs}/${verifs} vérifications réussies`);
  process.exit(echecs ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
