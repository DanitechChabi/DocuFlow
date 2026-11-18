// ============================================================================
// Jeu d'entraînement de DocuBot (Hugging Face → Ollama).
//
// Fabrique des milliers d'exemples « question → lecture attendue » au format
// conversationnel prompt/completion de TRL, avec exactement la consigne que
// DocuFlow envoie à Ollama (ollamaService) :
//   - analyse : la question → {"intention", "entreprise", "acte", "date"} ;
//   - rédaction : question + passages des procédures → réponse brève, fondée
//     sur les passages seulement (ou « je ne sais pas »).
//
// Les noms d'entreprise sont INVENTÉS par défaut : le jeu peut partir sur
// Google Colab sans rien emporter de l'AFGC. --noms-reels prend les noms des
// dossiers entrés (base locale) : à réserver à un entraînement sur un poste
// de l'AFGC.
//
//   node scripts/ia-documentaire/generer-jeu.js [--sortie dossier] [--nombre 4000] [--noms-reels --espace afgc]
// Produit jeu-docubot-entrainement.jsonl et jeu-docubot-test.jsonl.
// ============================================================================
const fs = require('fs');
const path = require('path');
const { generer, enJsonl } = require('../../src/services/jeuDocubotService');

const arg = (nom, defaut) => {
  const i = process.argv.indexOf(`--${nom}`);
  return i < 0 ? defaut : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true);
};

async function nomsReels(espace) {
  const db = require('../../src/config/db');
  const r = await db.query(
    `SELECT DISTINCT d.denomination FROM dossiers_entres d JOIN tenants t ON t.id = d.tenant_id
      WHERE t.slug = $1 AND d.denomination IS NOT NULL AND length(d.denomination) BETWEEN 3 AND 60 LIMIT 3000`,
    [espace]
  );
  return r.rows.map((x) => x.denomination);
}

(async () => {
  const sortie = path.resolve(arg('sortie', '.'));
  const reels = arg('noms-reels', false);
  const { entrainement, test } = generer({ nombre: Number(arg('nombre', 4000)), noms: reels ? await nomsReels(arg('espace', 'afgc')) : null });
  fs.mkdirSync(sortie, { recursive: true });
  fs.writeFileSync(path.join(sortie, 'jeu-docubot-entrainement.jsonl'), enJsonl(entrainement));
  fs.writeFileSync(path.join(sortie, 'jeu-docubot-test.jsonl'), enJsonl(test));
  console.log(`Entraînement : ${entrainement.length} exemples · test : ${test.length} exemples · noms ${reels ? 'réels (à garder à l\'AFGC)' : 'inventés'}`);
  console.log(`→ ${sortie}`);
  process.exit(0);
})().catch((err) => { console.error(err.message); process.exit(1); });
