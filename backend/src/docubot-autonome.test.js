// ============================================================================
// docubot-autonome.test.js — DocuBot apprend de l'usage, veille, raisonne (056).
// 1. Sans base : réentraînement par organisation ; raisonnement avec un faux Ollama.
// 2. Avec base : échanges, avis, corrections, exemples ; la veille du matin.
// Exécution : node src/docubot-autonome.test.js
// ============================================================================
let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };
const avecBase = Boolean(process.env.DB_HOST || process.env.DATABASE_URL);
process.env.IA_LOCALE = 'non';
const http = require('http');

(async () => {
  console.log('\n1. Réentraînement par organisation');
  const ic = require('./services/intentionService');
  const phrase = 'le grimoire de Zorbalak est dans la tour ?';
  const avant = ic.predire(phrase, 9001).intention;
  ic.entrainerEspace(9001, [
    { question: 'le grimoire de Kalédo est dans la tour ?', intention: 'qui_a' },
    { question: 'le grimoire de Somira est dans la tour', intention: 'qui_a' },
    { question: 'grimoire de Vuzé dans la tour ?', intention: 'qui_a' },
  ]);
  ok(ic.predire(phrase, 9001).intention === 'qui_a', `après 3 exemples de l'usage : « grimoire… tour » → qui_a (avant : ${avant})`);
  ok(ic.predire(phrase, 9002).intention === ic.predire(phrase).intention, 'les autres organisations gardent le modèle de base');
  ok(ic.etatEspace(9001).exemples_usage === 3, 'le nombre d\'exemples de l\'usage est connu');

  console.log('\n2. Raisonnement (faux Ollama)');
  let tour = 0;
  let recu = null;
  const serveur = http.createServer((req, res) => {
    let corps = '';
    req.on('data', (c) => { corps += c; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen3:4b-instruct' }] }));
      recu = JSON.parse(corps);
      tour += 1;
      if (tour === 1) return res.end(JSON.stringify({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'qui_a_le_dossier', arguments: { entreprise: 'Zinvo Transit' } } }] } }));
      return res.end(JSON.stringify({ message: { role: 'assistant', content: 'Le dossier **Zinvo Transit** est chez Awa.' } }));
    });
  });
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
  process.env.OLLAMA_URL = `http://127.0.0.1:${serveur.address().port}`;
  const agent = require('./services/docubotAgent');
  let demande = null;
  const outils = {
    qui_a_le_dossier: async (args) => { demande = args; return { texte: '1 dossier sorti', elements: [{ titre: 'Zinvo Transit', lignes: ['Chez **Awa**'] }] }; },
  };
  const r = await agent.raisonner(990001, 'Le dossier Zinvo Transit est sorti, et chez qui ?', { archive: true }, outils);
  ok(r?.texte.includes('Awa') && r.source === 'agent', 'réponse finale rédigée après l\'outil');
  ok(demande?.entreprise === 'Zinvo Transit' && r.etapes.join() === 'qui_a_le_dossier', 'l\'outil choisi par le modèle est appelé avec ses arguments');
  ok(r.elements.length === 1 && recu.messages.some((m) => m.role === 'tool' && m.content.includes('1 dossier sorti')), 'le résultat de l\'outil est rendu au modèle, et ses fiches gardées pour l\'écran');
  ok(recu.tools.length === agent.OUTILS.length && recu.messages[0].content.includes('N\'invente jamais'), 'les outils et la consigne « n\'invente jamais » sont envoyés');
  ok(agent.complexe('Quels dossiers de Credo BTP sont sortis, et chez qui ?') && !agent.complexe('où est Credo BTP'), 'question complexe reconnue ; simple laissée au chemin rapide');
  serveur.close();
  process.env.OLLAMA_URL = 'http://127.0.0.1:1';
  ok(await agent.raisonner(990002, 'x', { archive: true }, outils) === null, 'Ollama absent : pas de raisonnement (DocuBot garde le chemin rapide)');
  delete process.env.OLLAMA_URL;

  if (!avecBase) {
    console.log('\n3. Sur PostgreSQL — SAUTÉ');
  } else {
    console.log('\n3. Apprentissage et veille sur PostgreSQL');
    const db = require('./config/db');
    const app = require('./services/apprentissageService');
    const veille = require('./services/veilleService');
    const s = Date.now();
    const t = (await db.query("INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id", [`Test DocuBot ${s}`, `test-docubot-${s}`])).rows[0].id;
    await require('./services/roleService').provisionRoles(t);
    const u = (await db.query("INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', 'Agent Test', $3, 'demandeur') RETURNING id", [t, `d-${s}`, `d-${s}@exemple.test`])).rows[0];
    const v = (await db.query("INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', 'Autre', $3, 'demandeur') RETURNING id", [t, `e-${s}`, `e-${s}@exemple.test`])).rows[0];
    const a = (await db.query("INSERT INTO users (tenant_id, username, password_hash, full_name, email, role) VALUES ($1, $2, 'x', 'Archiviste', $3, 'archiviste') RETURNING id", [t, `a-${s}`, `a-${s}@exemple.test`])).rows[0];

    const id1 = await app.noter(t, u.id, 'le grimoire de Lomé est dans la tour ?', { intention: 'ou_est', confiance: 0.4, source: 'regles' });
    const id2 = await app.noter(t, u.id, 'où est Credo BTP', { intention: 'ou_est', confiance: 0.95, source: 'appris' });
    const id3 = await app.noter(t, u.id, 'blabla hors sujet', { intention: 'hors_sujet', confiance: 0.7, source: 'appris' });
    ok(Number.isInteger(id1) && id2 > id1, 'échanges gardés');
    let refus = null; try { await app.avis(t, v.id, id1, { utile: true }); } catch (err) { refus = err.statut; }
    ok(refus === 404, 'on ne donne son avis que sur ses propres échanges');
    await app.avis(t, u.id, id1, { utile: false, voulait: 'qui_a' });
    await app.avis(t, u.id, id2, { utile: true });
    const ex = await app.exemples(t);
    ok(ex.some((x) => x.intention === 'qui_a' && x.question.includes('grimoire')) && ex.some((x) => x.intention === 'ou_est' && x.question === 'où est Credo BTP'), 'exemples : la correction de l\'agent, et la réponse jugée utile');
    const revoir = await app.aRevoir(t);
    ok(revoir.questions.some((x) => x.id === id3) && !revoir.questions.some((x) => x.id === id1 || x.id === id2), 'à revoir : le hors sujet non corrigé ; ni les corrigées, ni les utiles');
    ok(revoir.bilan.questions === 3 && revoir.bilan.utiles === 1 && revoir.bilan.pas_utiles === 1 && revoir.questions.every((x) => !('user_id' in x)), 'bilan sur 30 jours, sans l\'auteur des questions');
    await app.corriger(t, { id: a.id }, id3, 'ignorer');
    ok(!(await app.exemples(t)).some((x) => x.question === 'blabla hors sujet') && (await app.aRevoir(t)).questions.length === 0, '« ignorer » : ni exemple, ni à revoir');
    let mauvais = null; try { await app.corriger(t, { id: a.id }, id2, 'pirater'); } catch (err) { mauvais = err.statut; }
    ok(mauvais === 400, 'correction inconnue refusée');
    await app.reentrainer(t);
    ok(ic.etatEspace(t).exemples_usage === 2 && ic.predire('le grimoire de Lomé est dans la tour ?', t).intention === 'qui_a', 'réentraîné : la question corrigée est désormais comprise');

    // Veille : une demande qui attend depuis 5 jours, deux demandes du même dossier, un retard.
    const demande1 = async (nom, jours, user = u.id) => (await db.query(
      `INSERT INTO requests (tenant_id, id_user, nom_entreprise, num_acte, statut, motif, created_at)
       VALUES ($1, $2, $3, '2025/1', 'en attente', 'Consultation', now() - make_interval(days => $4)) RETURNING id`, [t, user, nom, jours])).rows[0].id;
    await demande1('Vieille Attente SARL', 5);
    await demande1('Doublon Fictif', 0, u.id);
    await demande1('Doublon Fictif', 0, v.id);
    const sortie = await demande1('Retard Fictif', 20);
    await db.query("UPDATE requests SET statut = 'livré' WHERE id = $1", [sortie]);
    await db.query(`INSERT INTO request_loans (tenant_id, request_id, emprunteur_id, remis_par, remis_at, date_retour_prevue, nature)
                    VALUES ($1, $2, $3, $4, now() - interval '15 days', CURRENT_DATE - 3, 'original')`, [t, sortie, u.id, a.id]);
    const b = await veille.bilan(t);
    const cle = (k) => b.items.find((i) => i.cle === k);
    ok(cle('retards')?.nombre === 1 && cle('retards').niveau === 'alerte' && cle('retards').exemples[0].includes('Agent Test'), 'veille : le retard, avec qui l\'a');
    ok(cle('attente')?.nombre === 1 && cle('attente').exemples[0].includes('Vieille Attente'), 'veille : la demande qui attend depuis plus de 2 jours');
    ok(cle('doublons')?.nombre === 1 && cle('doublons').exemples[0].includes('2 demandes, 2 agents'), 'veille : le même dossier demandé deux fois');
    ok(b.alertes === 2 && veille.enTexte(b).startsWith('Ce matin'), 'deux alertes ; le texte de DocuBot');
    const archive = await veille.comptesArchive(t);
    ok(archive.length === 1 && archive[0] === a.id, 'la veille va à l\'archive seulement');
    const e1 = await veille.envoyerDuJour(t);
    const e2 = await veille.envoyerDuJour(t);
    ok(e2.raison === 'déjà envoyée' && (e1.envoye || e1.destinataires === 0), 'une veille par jour, pas deux');
  }
  console.log(`\n${verifs - echecs}/${verifs} vérifications réussies`);
  process.exit(echecs ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
