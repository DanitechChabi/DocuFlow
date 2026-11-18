// ============================================================================
// Télécharge les modèles de l'aide automatique (iaService) dans le dossier
// des modèles, pour un serveur sans accès à Internet.
//   node scripts/telecharger-modeles.js [dossier]
// Dossier par défaut : IA_MODELES_DIR, sinon backend/.modeles.
//
// Les fichiers sont téléchargés ici même, entièrement écrits et fermés, puis
// le chargement est vérifié dans un AUTRE processus : sous Windows, un modèle
// ouvert pendant que la bibliothèque l'écrit encore échoue (« system error
// number 13 »).
// ============================================================================
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const FICHIERS = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'];

async function telecharger(depot, fichier, dossier) {
  const cible = path.join(dossier, depot, fichier);
  if (fs.existsSync(cible) && fs.statSync(cible).size > 0) return 'déjà là';
  fs.mkdirSync(path.dirname(cible), { recursive: true });
  const r = await fetch(`https://huggingface.co/${depot}/resolve/main/${fichier}`);
  if (!r.ok) throw new Error(`${depot}/${fichier} : HTTP ${r.status}`);
  const provisoire = `${cible}.partiel`;
  await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(provisoire));
  fs.renameSync(provisoire, cible);
  return `${Math.round(fs.statSync(cible).size / 1e6)} Mo`;
}

(async () => {
  if (process.argv[2] === '--verifier') {
    // Processus fils : charge chaque modèle depuis le disque, sans réseau.
    process.env.IA_LOCALE = 'oui';
    process.env.IA_TELECHARGER = 'non';
    const ia = require('../src/services/iaService');
    for (const nom of Object.keys(ia.MODELES)) {
      if (!(await ia.charger(nom))) { console.log(`ÉCHEC du chargement : ${nom}`); process.exit(1); }
    }
    process.exit(0);
  }
  const dossier = path.resolve(process.argv[2] || process.env.IA_MODELES_DIR || path.join(__dirname, '..', '.modeles'));
  const { MODELES } = require('../src/services/iaService');
  console.log(`Modèles dans ${dossier}`);
  for (const [nom, m] of Object.entries(MODELES)) {
    for (const f of FICHIERS) {
      let essai = 0;
      for (;;) {
        try {
          console.log(`- ${nom} · ${f} : ${await telecharger(m.id, f, dossier)}`);
          break;
        } catch (err) {
          essai += 1;
          if (essai >= 4) throw err;
          await new Promise((r) => setTimeout(r, 3000 * essai));
        }
      }
    }
  }
  const v = spawnSync(process.execPath, [__filename, '--verifier'], { env: { ...process.env, IA_MODELES_DIR: dossier }, stdio: 'inherit' });
  if (v.status !== 0) { console.log('Les modèles téléchargés ne se chargent pas.'); process.exit(1); }
  console.log('Modèles prêts.');
  process.exit(0);
})().catch((err) => { console.error(err.message); process.exit(1); });
