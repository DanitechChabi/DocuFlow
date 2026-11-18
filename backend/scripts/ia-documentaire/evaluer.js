// ============================================================================
// Mesure un modèle Ollama sur le jeu de test de DocuBot : bonne intention,
// bonne entreprise, bon acte, bonne date. À lancer avant et après
// l'entraînement pour voir le gain.
//   node scripts/ia-documentaire/evaluer.js --modele docubot-afgc [--url http://localhost:11434] [--jeu jeu-docubot-test.jsonl] [--max 200]
// ============================================================================
const fs = require('fs');

const arg = (nom, defaut) => {
  const i = process.argv.indexOf(`--${nom}`);
  return i < 0 ? defaut : process.argv[i + 1];
};
const url = String(arg('url', 'http://localhost:11434')).replace(/\/+$/, '');
const modele = arg('modele', 'docubot-afgc');
const max = Number(arg('max', 200));
const norme = (s) => (s === null || s === undefined ? null : String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\b(societe|ets|etablissements|entreprise|groupe|cabinet|groupement|sarl|sa|sas|sarlu|gie)\b/g, '').replace(/[^a-z0-9/]+/g, ' ').trim() || null);

(async () => {
  const lignes = fs.readFileSync(arg('jeu', 'jeu-docubot-test.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    .filter((x) => x.prompt[0].content.startsWith('Tu analyses')).slice(0, max);
  const n = { total: 0, intention: 0, entreprise: 0, acte: 0, date: 0, json: 0 };
  const erreurs = {};
  let duree = 0;
  for (const x of lignes) {
    const attendu = JSON.parse(x.completion[0].content);
    const debut = Date.now();
    const r = await fetch(`${url}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: modele, stream: false, format: 'json', messages: x.prompt, options: { temperature: 0, num_predict: 120 }, keep_alive: '30m' }),
    }).then((y) => y.json());
    duree += Date.now() - debut;
    n.total += 1;
    let lu = null;
    try { lu = JSON.parse(r.message?.content || ''); n.json += 1; } catch { /* JSON illisible : tout faux */ }
    const ok = (k) => lu && norme(lu[k]) === norme(attendu[k]);
    if (lu && lu.intention === attendu.intention) n.intention += 1;
    else { const cle = `${attendu.intention} → ${lu?.intention}`; erreurs[cle] = (erreurs[cle] || 0) + 1; }
    for (const k of ['entreprise', 'acte', 'date']) if (ok(k)) n[k] += 1;
    process.stdout.write(`\r${n.total}/${lignes.length}`);
  }
  const pc = (k) => `${Math.round((100 * n[k]) / n.total)} %`;
  console.log(`\n\nModèle ${modele} · ${n.total} questions · ${Math.round(duree / n.total)} ms par question`);
  console.log(`  intention juste  : ${pc('intention')}`);
  console.log(`  entreprise juste : ${pc('entreprise')}`);
  console.log(`  acte juste       : ${pc('acte')}`);
  console.log(`  date juste       : ${pc('date')}`);
  console.log(`  JSON valide      : ${pc('json')}`);
  const top = Object.entries(erreurs).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (top.length) console.log(`  confusions : ${top.map(([k, v]) => `${k} (${v})`).join(', ')}`);
})().catch((err) => { console.error(err.message); process.exit(1); });
