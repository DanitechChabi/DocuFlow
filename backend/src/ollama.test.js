// ============================================================================
// ollama.test.js — lien DocuFlow ↔ Ollama et jeu d'entraînement de DocuBot.
// Un faux serveur Ollama remplace le vrai. Sans base.
// Exécution : node src/ollama.test.js
// ============================================================================
let verifs = 0;
let echecs = 0;
const ok = (cond, nom) => { verifs += 1; console.log(`${cond ? '  ok  ' : '  ÉCHEC'} ${nom}`); if (!cond) echecs += 1; };
const http = require('http');

(async () => {
  console.log('\n1. Jeu d\'entraînement');
  const { generer } = require('./services/jeuDocubotService');
  const ollama = require('./services/ollamaService');
  const a = generer({ nombre: 600 });
  const b = generer({ nombre: 600 });
  ok(JSON.stringify(a) === JSON.stringify(b), 'reproductible : le même jeu à chaque fois');
  ok(a.entrainement.length > 600 && a.test.length > 60, 'entraînement et test');
  const analyses = [...a.entrainement, ...a.test].filter((x) => x.prompt[0].content === ollama.CONSIGNE_ANALYSE);
  const lus = analyses.map((x) => JSON.parse(x.completion[0].content));
  ok(lus.every((l) => ollama.INTENTIONS.includes(l.intention) && 'entreprise' in l && 'acte' in l && 'date' in l), 'chaque réponse : une intention connue, les quatre champs');
  ok(new Set(lus.map((l) => l.intention)).size === ollama.INTENTIONS.length, 'toutes les intentions sont représentées');
  ok(lus.filter((l) => l.date).every((l) => /^\d{4}-\d{2}-\d{2}$/.test(l.date)), 'dates au format AAAA-MM-JJ');
  const noms = (l) => new Set(l.map((x) => JSON.parse(x.completion[0].content).entreprise).filter(Boolean).map((n) => n.toLowerCase()));
  const nomsEntr = noms(a.entrainement.filter((x) => x.prompt[0].content === ollama.CONSIGNE_ANALYSE));
  const nomsTest = noms(a.test.filter((x) => x.prompt[0].content === ollama.CONSIGNE_ANALYSE));
  ok([...nomsTest].filter((n) => nomsEntr.has(n)).length <= nomsTest.size * 0.05, 'les noms du test ne sont (presque) pas vus à l\'entraînement');
  ok(analyses.every((x) => x.prompt[1].role === 'user' && x.completion[0].role === 'assistant'), 'format prompt/completion de TRL');
  ok(a.entrainement.some((x) => x.prompt[0].content.startsWith(ollama.CONSIGNE_REDACTION)), 'des exemples de rédaction, avec la même consigne que DocuFlow');

  console.log('\n2. Faux serveur Ollama');
  let reponse = '{"intention":"qui_a","entreprise":"Kpadonou et Fils","acte":null,"date":null}';
  let installes = ['qwen3:4b-instruct'];
  let dernier = null;
  const serveur = http.createServer((req, res) => {
    let corps = '';
    req.on('data', (c) => { corps += c; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: installes.map((name) => ({ name })) }));
      dernier = JSON.parse(corps);
      return res.end(JSON.stringify({ message: { role: 'assistant', content: reponse } }));
    });
  });
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
  process.env.OLLAMA_URL = `http://127.0.0.1:${serveur.address().port}`;
  const lu = await ollama.analyser(999999, 'le dossier des Ets Kpadonou et fils est-il revenu ?');
  ok(lu?.intention === 'qui_a' && lu.entreprise === 'Kpadonou et Fils', 'question lue : intention et entreprise');
  ok(dernier.model === 'qwen3:4b-instruct' && dernier.format === 'json' && dernier.messages[0].content === ollama.CONSIGNE_ANALYSE, 'docubot-afgc absent : repli sur qwen3:4b-instruct, en JSON, avec la consigne d\'entraînement');
  reponse = '{"intention":"pirater","entreprise":"null"}';
  const bizarre = await ollama.analyser(999999, 'xxx');
  ok(bizarre.intention === 'autre' && bizarre.entreprise === null, 'intention inconnue → « autre » ; « null » écrit → vide');
  reponse = 'pas du JSON';
  ok(await ollama.analyser(999999, 'xxx') === null, 'réponse illisible : rien (DocuBot garde ses règles)');
  reponse = 'Une semaine va du vendredi au jeudi.';
  const r = await ollama.rediger(999999, 'la semaine ?', ['Une semaine de production va du vendredi au jeudi.']);
  ok(r?.texte === reponse && dernier.messages[0].content.includes('[1] Une semaine de production'), 'rédaction : les passages sont fournis au modèle');
  ok(await ollama.rediger(999999, 'x', []) === null, 'sans passage : pas de rédaction');
  const e = await ollama.etat(999999);
  ok(e.joignable && e.modele_servi === 'qwen3:4b-instruct' && e.installes.length === 1, 'état : joignable, modèle servi');
  serveur.close();
  process.env.OLLAMA_URL = 'http://127.0.0.1:1';
  ok(await ollama.analyser(999998, 'x') === null && (await ollama.etat(999998)).joignable === false, 'Ollama arrêté : rien, sans erreur');
  delete process.env.OLLAMA_URL;
  ok((await ollama.etat(999997)).configure === false, 'sans adresse : non configuré');

  console.log('\n3. DocuBot : passages pour la rédaction');
  const d = require('./services/docubotService');
  const p = d.passagesPour('pourquoi la semaine commence le vendredi ?', { archive: false });
  ok(p.length > 0 && p.length <= 4 && p.some((x) => x.includes('vendredi')), 'les passages pertinents sont retenus');
  ok(d.passagesPour('xyz', { archive: false }).length === 0, 'aucun passage pour une question hors sujet');

  console.log(`\n${verifs - echecs}/${verifs} vérifications réussies`);
  process.exit(echecs ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
