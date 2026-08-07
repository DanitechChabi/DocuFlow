// Génère build/icon.png (512×512) et build/icon.ico depuis le logo frontend
// (favicon.svg).
//   - icon.png  : icône pour electron-builder (installateur bureau).
//   - icon.ico  : icône pour l'installateur Inno Setup (installer/docuflow-setup.iss).
// Non bloquant : en cas d'échec, l'icône par défaut est utilisée.
const sharp = require('sharp');
const pngToIco = require('png-to-ico');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, 'build');
const svgPath = path.join(root, '..', 'frontend', 'public', 'favicon.svg');

(async () => {
  fs.mkdirSync(buildDir, { recursive: true });
  const svg = sharp(svgPath);

  // PNG 512 pour electron-builder
  const png512 = await svg.clone().resize(512, 512).png().toBuffer();
  fs.writeFileSync(path.join(buildDir, 'icon.png'), png512);
  console.log('[icon] build/icon.png (512×512) généré.');

  // ICO multi-tailles pour Inno Setup
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = await Promise.all(sizes.map((s) => svg.clone().resize(s, s).png().toBuffer()));
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), await pngToIco(pngs));
  console.log('[icon] build/icon.ico (multi-tailles) généré.');
})().catch((err) => {
  console.warn('[icon] Échec de génération de l’icône (défaut utilisé).', err.message);
  process.exit(0);
});
