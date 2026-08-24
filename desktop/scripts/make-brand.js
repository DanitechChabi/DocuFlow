/**
 * Génère toutes les déclinaisons de la marque DocuFlow depuis le logo officiel
 * (assets/brand/docuflow-logo.png).
 *
 * Le master est un wordmark cursif : encre noire opaque sur fond blanc opaque,
 * 512×512 sans canal alpha. Deux traitements en découlent :
 *
 *   1. Détourage — l'alpha est dérivé de la luminance plutôt que par seuillage
 *      binaire, ce qui préserve l'anticrénelage des courbes. Sans cela, le fond
 *      blanc s'affiche en rectangle sur les fonds sombres (topbar, splash).
 *   2. Monogramme — le wordmark fait 3,3:1 ; dans un cadre carré (favicon,
 *      icône d'application) il devient illisible. Le « D » initial est donc
 *      extrait pour ces usages, le wordmark complet restant réservé aux
 *      emplacements larges.
 *
 * Sorties (frontend/public/brand/ + desktop/build/) : voir TARGETS plus bas.
 * Idempotent : réécrit systématiquement toutes les cibles.
 */
const sharp = require('sharp');
const pngToIco = require('png-to-ico');
const path = require('path');
const fs = require('fs');

// Le script vit dans desktop/scripts/ parce que sharp et png-to-ico y sont déjà
// déclarés ; il écrit néanmoins dans frontend/public/ et desktop/build/.
const root = path.resolve(__dirname, '..', '..');
const MASTER = path.join(root, 'assets', 'brand', 'docuflow-logo.png');
const publicBrand = path.join(root, 'frontend', 'public', 'brand');
const desktopBuild = path.join(root, 'desktop', 'build');
// Boîte du glyphe « D » dans le master, mesurée sur le profil d'encre du tracé.
// La coupe tombe au point le plus fin du délié reliant le « D » au « o » ; le
// résidu du « o » est ensuite retiré par keepLargestComponent().
const MONO_BOX = { left: 52, top: 190, width: 96, height: 145 };

// Marge autour du glyphe dans le carré final (18 % du plus grand côté).
const MONO_PADDING = 1.18;

/**
 * Remplace le fond blanc par de la transparence et recolore l'encre.
 *
 * @param {Buffer} buf - Image source (fond blanc opaque)
 * @param {number} ink - Niveau de gris de l'encre de sortie (0 = noir, 255 = blanc)
 * @returns {Promise<Buffer>} PNG RGBA détouré
 */
async function detour(buf, ink) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const out = Buffer.alloc(width * height * 4);

  for (let p = 0; p < width * height; p++) {
    const i = p * channels;
    const luminance = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    // La borne haute à 250 (et non 255) écarte le blanc légèrement bruité du
    // fond du master, qui laisserait sinon un voile opaque.
    let alpha = (250 - luminance) / 245;
    alpha = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    out[p * 4] = ink;
    out[p * 4 + 1] = ink;
    out[p * 4 + 2] = ink;
    out[p * 4 + 3] = Math.round(alpha * 255);
  }

  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/**
 * Rogne au plus juste sur les pixels réellement encrés.
 *
 * `sharp.trim()` n'est pas utilisable ici : son seuil compare au pixel de coin
 * et le master contient un fond légèrement bruité, si bien que des pixels
 * quasi transparents retiennent le cadrage — le wordmark se retrouvait alors
 * dans le tiers supérieur d'un canevas trois fois trop haut, et paraissait
 * deux fois trop petit là où il est contraint en hauteur. Le seuil explicite
 * ci-dessous rend le rognage indépendant de ce bruit.
 *
 * @param {Buffer} buf - PNG RGBA
 * @param {number} [minAlpha] - Alpha minimal considéré comme encré
 * @returns {Promise<Buffer>} PNG RGBA rogné
 */
async function cropToInk(buf, minAlpha = 12) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;

  let x0 = W; let y0 = H; let x1 = -1; let y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * C + 3] <= minAlpha) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return buf; // image entièrement transparente

  return sharp(buf)
    .extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 })
    .png()
    .toBuffer();
}

/**
 * Ne conserve que la composante connexe la plus étendue.
 *
 * La coupe du monogramme tombe au point le plus fin du délié reliant le « D »
 * au « o » : elle emporte une écaille du « o » suivant, visible comme un point
 * parasite au bord droit. Élargir ou resserrer la boîte ne résout rien — cela
 * tronque la panse du « D » ou ramène davantage du « o ». Le tracé cursif du
 * « D » étant d'un seul trait, il forme la plus grande composante et l'écaille
 * disparaît par sélection.
 *
 * @param {Buffer} buf - PNG RGBA détouré
 * @returns {Promise<Buffer>} PNG RGBA sans composantes parasites
 */
async function keepLargestComponent(buf) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const opaque = (p) => data[p * C + 3] > 12;

  const label = new Int32Array(W * H).fill(-1);
  const sizes = [];

  for (let start = 0; start < W * H; start++) {
    if (label[start] !== -1 || !opaque(start)) continue;
    const id = sizes.length;
    let count = 0;
    // Parcours itératif : une récursion déborderait la pile sur 512×512.
    const stack = [start];
    label[start] = id;
    while (stack.length) {
      const p = stack.pop();
      count++;
      const x = p % W;
      const y = (p - x) / W;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const np = ny * W + nx;
          if (label[np] !== -1 || !opaque(np)) continue;
          label[np] = id;
          stack.push(np);
        }
      }
    }
    sizes.push(count);
  }

  if (sizes.length <= 1) return buf;
  const keep = sizes.indexOf(Math.max(...sizes));

  const out = Buffer.from(data);
  for (let p = 0; p < W * H; p++) {
    if (label[p] !== keep) out[p * C + 3] = 0;
  }
  return sharp(out, { raw: { width: W, height: H, channels: C } }).png().toBuffer();
}

/**
 * Extrait le monogramme « D » et le centre dans un carré transparent.
 *
 * @param {number} ink - Niveau de gris de l'encre
 * @returns {Promise<Buffer>} PNG RGBA carré
 */
async function monogram(ink) {
  const cut = await sharp(MASTER).extract(MONO_BOX).png().toBuffer();
  const clean = await keepLargestComponent(await detour(cut, ink));
  const glyph = await cropToInk(clean);
  const { width, height } = await sharp(glyph).metadata();
  const side = Math.round(Math.max(width, height) * MONO_PADDING);

  return sharp({
    create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: glyph, gravity: 'center' }])
    .png()
    .toBuffer();
}

/**
 * Détoure le wordmark complet en le rognant au plus juste.
 *
 * @param {number} ink - Niveau de gris de l'encre
 * @returns {Promise<Buffer>} PNG RGBA
 */
async function wordmark(ink) {
  return cropToInk(await detour(await sharp(MASTER).png().toBuffer(), ink));
}

/**
 * Écrit un PNG redimensionné (fond transparent, aucun rognage).
 */
async function emit(buf, dir, name, size) {
  const target = path.join(dir, name);
  await sharp(buf)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(target);
  return target;
}

/**
 * Encode une image RGB en BMP 24 bits (BITMAPINFOHEADER, non compressé).
 *
 * Écrit à la main parce que sharp ne sait pas produire de BMP (`sharp.format`
 * n'expose pas ce format en sortie) et que NSIS n'accepte QUE du BMP pour
 * l'artwork de l'assistant : un PNG renommé en .bmp est refusé, et
 * `warningsAsErrors` étant activé par défaut, le build entier échoue.
 *
 * Deux particularités du format, sources d'images inversées ou décalées :
 *   - les lignes sont stockées de bas en haut (hauteur positive) ;
 *   - l'ordre des octets est BGR, et chaque ligne est complétée à un multiple
 *     de 4 octets.
 *
 * L'alpha est aplati en amont (l'assistant n'a pas de transparence) : les BMP
 * 32 bits sont diversement interprétés selon les versions de NSIS, on reste donc
 * en 24 bits, qui est le cas universellement supporté.
 *
 * @param {Buffer} rgb - pixels bruts, 3 canaux, sans alpha
 * @param {number} width
 * @param {number} height
 * @returns {Buffer} fichier BMP complet
 */
function encodeBmp24(rgb, width, height) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelsSize = rowSize * height;
  const HEADER = 14 + 40;
  const out = Buffer.alloc(HEADER + pixelsSize);

  out.write('BM', 0, 'ascii');
  out.writeUInt32LE(HEADER + pixelsSize, 2); // taille totale
  out.writeUInt32LE(HEADER, 10);             // décalage des pixels
  out.writeUInt32LE(40, 14);                 // taille de BITMAPINFOHEADER
  out.writeInt32LE(width, 18);
  out.writeInt32LE(height, 22);              // positif => lignes de bas en haut
  out.writeUInt16LE(1, 26);                  // plans
  out.writeUInt16LE(24, 28);                 // bits par pixel
  out.writeUInt32LE(0, 30);                  // BI_RGB, non compressé
  out.writeUInt32LE(pixelsSize, 34);

  for (let y = 0; y < height; y++) {
    // Ligne 0 du BMP = dernière ligne de l'image.
    const src = (height - 1 - y) * width * 3;
    let dst = HEADER + y * rowSize;
    for (let x = 0; x < width; x++) {
      out[dst++] = rgb[src + x * 3 + 2]; // B
      out[dst++] = rgb[src + x * 3 + 1]; // G
      out[dst++] = rgb[src + x * 3];     // R
    }
    // Le reste de la ligne (remplissage) est déjà à zéro grâce à Buffer.alloc.
  }

  return out;
}

/**
 * Compose le monogramme clair sur le bleu nuit de la marque et écrit un BMP.
 *
 * @param {Buffer} glyph - monogramme à encre claire
 * @param {string} target - chemin du .bmp à écrire
 * @param {number} width
 * @param {number} height
 * @param {number} ratio - part de la plus petite dimension occupée par le glyphe
 * @param {'center'|'centre'} [gravity]
 */
async function emitBmp(glyph, target, width, height, ratio, gravity = 'center') {
  const cote = Math.round(Math.min(width, height) * ratio);
  const fond = sharp({
    create: { width, height, channels: 3, background: { r: 15, g: 23, b: 42 } },
  }).composite([{
    input: await sharp(glyph)
      .resize(cote, cote, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer(),
    gravity,
  }]);

  // removeAlpha : l'aplatissement sur le fond est déjà fait par le composite,
  // mais sharp conserve un canal alpha que l'encodeur 24 bits n'attend pas.
  const { data } = await fond.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  fs.writeFileSync(target, encodeBmp24(data, width, height));
}

(async () => {
  if (!fs.existsSync(MASTER)) {
    throw new Error(`logo officiel introuvable : ${MASTER}`);
  }
  fs.mkdirSync(publicBrand, { recursive: true });
  fs.mkdirSync(desktopBuild, { recursive: true });

  const monoDark = await monogram(0);     // encre noire — fonds clairs
  const monoLight = await monogram(255);  // encre blanche — fonds sombres
  const wordDark = await wordmark(0);
  const wordLight = await wordmark(255);

  // --- Wordmarks (emplacements larges : page de connexion, splash, à propos) --
  fs.writeFileSync(path.join(publicBrand, 'docuflow-wordmark.png'), wordDark);
  fs.writeFileSync(path.join(publicBrand, 'docuflow-wordmark-light.png'), wordLight);

  // --- Monogrammes (emplacements carrés : topbar, avatars) -------------------
  fs.writeFileSync(path.join(publicBrand, 'docuflow-mark.png'), monoDark);
  fs.writeFileSync(path.join(publicBrand, 'docuflow-mark-light.png'), monoLight);

  // --- Favicons ---------------------------------------------------------------
  // Encre noire : les navigateurs affichent l'onglet sur fond clair.
  for (const size of [16, 32, 48, 192, 512]) {
    await emit(monoDark, publicBrand, `favicon-${size}.png`, size);
  }

  // --- apple-touch-icon -------------------------------------------------------
  // iOS ignore les SVG et aplatit l'alpha sur du noir : on compose donc
  // explicitement le monogramme clair sur le bleu de la marque.
  const APPLE = 180;
  await sharp({
    create: { width: APPLE, height: APPLE, channels: 4, background: { r: 15, g: 23, b: 42, alpha: 255 } },
  })
    .composite([{
      input: await sharp(monoLight).resize(Math.round(APPLE * 0.68), Math.round(APPLE * 0.68), { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer(),
      gravity: 'center',
    }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(publicBrand, 'apple-touch-icon.png'));

  // --- Icônes bureau (electron-builder + Inno Setup) --------------------------
  // Fond opaque : une icône de barre des tâches à fond transparent disparaît
  // selon le thème Windows.
  const desktopIcon = async (size) => sharp({
    create: { width: size, height: size, channels: 4, background: { r: 15, g: 23, b: 42, alpha: 255 } },
  })
    .composite([{
      input: await sharp(monoLight).resize(Math.round(size * 0.68), Math.round(size * 0.68), { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer(),
      gravity: 'center',
    }])
    .png({ compressionLevel: 9 })
    .toBuffer();

  fs.writeFileSync(path.join(desktopBuild, 'icon.png'), await desktopIcon(512));
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoPngs = await Promise.all(icoSizes.map((s) => desktopIcon(s)));
  const ico = await pngToIco(icoPngs);
  fs.writeFileSync(path.join(desktopBuild, 'icon.ico'), ico);

  // --- Artwork de l'assistant NSIS -------------------------------------------
  //
  // Sans ces trois fichiers, electron-builder se rabat sur nsis3-metro.bmp :
  // l'installateur d'un logiciel vendu afficherait le visuel générique de NSIS,
  // reconnaissable et sans rapport avec la marque.
  //
  // Les dimensions ne sont pas indicatives : NSIS ne redimensionne pas l'artwork
  // de l'assistant. Un bitmap plus grand est rogné, un plus petit laisse du gris.
  //   - bandeau (header)  : 150×57, image cadrée à droite ;
  //   - panneau latéral   : 164×314, colonne de gauche des pages d'accueil et de
  //                         fin (installateur ET désinstallateur).
  await emitBmp(monoLight, path.join(desktopBuild, 'installerHeader.bmp'), 150, 57, 0.82);
  await emitBmp(monoLight, path.join(desktopBuild, 'installerSidebar.bmp'), 164, 314, 0.62);
  // Le désinstallateur reçoit le même panneau : un visuel différent au moment de
  // désinstaller laisse croire qu'on a lancé le programme d'un autre éditeur.
  fs.copyFileSync(
    path.join(desktopBuild, 'installerSidebar.bmp'),
    path.join(desktopBuild, 'uninstallerSidebar.bmp')
  );

  // --- Icônes de l'installateur et du désinstallateur ------------------------
  //
  // electron-builder ne déduit PAS ces deux icônes de win.icon : sans elles,
  // DocuFlow-Setup.exe et l'entrée « Ajout/Suppression de programmes » portent
  // l'icône NSIS par défaut, alors que l'application installée porte la nôtre.
  fs.writeFileSync(path.join(desktopBuild, 'installerIcon.ico'), ico);
  fs.writeFileSync(path.join(desktopBuild, 'uninstallerIcon.ico'), ico);

  console.log('[brand] frontend/public/brand/ : wordmark ×2, mark ×2, favicon ×5, apple-touch-icon');
  console.log('[brand] desktop/build/ : icon.png (512×512), icon.ico (7 tailles)');
  console.log('[brand] desktop/build/ : artwork NSIS (header 150×57, sidebar 164×314 ×2) + icônes installateur/désinstallateur');
})().catch((err) => {
  console.error('[brand] Échec de génération :', err.message);
  process.exit(1);
});
