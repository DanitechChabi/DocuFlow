// ============================================================================
// zip — écriture d'archives ZIP sans dépendance (APPNOTE 6.3, sous-ensemble).
//
// Pourquoi écrire le format plutôt qu'ajouter une bibliothèque : le paquet
// d'archive (035) n'a besoin que de l'essentiel — entrées « stockées » ou
// « deflate », noms UTF-8 — et chaque dépendance alourdit l'installateur de
// bureau. Le format est simple et stable depuis trente ans :
//
//   [en-tête local + données] × n   puis   [répertoire central] × n   puis   EOCD
//
// - CRC-32 : zlib.crc32 (Node ≥ 20.15 / 22.2) s'il existe, sinon une table.
// - Compression : zlib.deflateRaw (asynchrone : le fil principal n'est pas
//   bloqué), conservée seulement si elle fait gagner de la place ; les formats
//   déjà compressés (JPEG, PNG, DOCX, ZIP…) sont stockés tels quels.
// - Noms : UTF-8 déclaré par le bit 11 (« Évaluation été.pdf » s'ouvre juste
//   sous Windows, macOS et Linux) ; chemins relatifs, sans « .. » ni « / »
//   initial — une archive ne doit jamais pouvoir écrire hors de son dossier.
// - Horodatage : date DOS (heure locale, résolution 2 s) et champ étendu
//   0x5455 (secondes UTC) que lisent unzip et la plupart des outils.
// - ZIP64 hors périmètre : 4 Gio par entrée et par archive, 65 535 entrées ;
//   l'appelant borne le volume (réglage export_taille_max_mo), et l'écrivain
//   refuse de dépasser plutôt que de produire une archive illisible.
//
// L'écrivain émet ses octets vers une fonction `ecrire(tampon)` (fichier
// temporaire, flux de réponse, tableau en mémoire) : il n'a jamais l'archive
// entière en mémoire.
// ============================================================================
const zlib = require('zlib');
const { promisify } = require('util');

const deflateRaw = promisify(zlib.deflateRaw);

const LIMITE_32 = 0xffffffff;
const MAX_ENTREES = 0xffff;

// ------------------------------------------------------------------ CRC-32
let TABLE = null;
/** CRC-32 (polynôme 0xEDB88320) par table — repli et référence des tests. */
function crc32Table(tampon, depart = 0) {
  if (!TABLE) {
    TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLE[n] = c >>> 0;
    }
  }
  let crc = (depart ^ 0xffffffff) >>> 0;
  for (let i = 0; i < tampon.length; i += 1) crc = TABLE[(crc ^ tampon[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** CRC-32 d'un tampon : natif si disponible. */
function crc32(tampon, depart = 0) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(tampon, depart) >>> 0;
  return crc32Table(tampon, depart);
}

// ----------------------------------------------------------- dates et noms
/** Date et heure DOS (heure locale, secondes paires). */
function dateDos(d = new Date()) {
  const annee = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  return {
    heure: ((d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)) & 0xffff,
    date: (((annee - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff,
  };
}

/**
 * Chemin sûr dans l'archive : séparateurs « / », sans segment vide, « . » ni
 * « .. », sans caractère de contrôle. Lève si rien ne reste.
 */
function nomSur(nom) {
  const propre = String(nom || '')
    .replace(/\\/g, '/')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s && s !== '.' && s !== '..')
    .join('/');
  if (!propre) throw new Error(`Nom d'entrée ZIP invalide : « ${nom} »`);
  return propre;
}

/** Nom de fichier lisible et sûr (un segment), pour composer un chemin. */
function segmentSur(nom, repli = 'fichier') {
  const s = String(nom || '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 150);
  return s || repli;
}

const DEJA_COMPRESSES = /^(image\/(jpeg|png|gif|webp|avif|heic)|video\/|audio\/|application\/(zip|gzip|x-7z|x-rar|vnd\.openxmlformats|vnd\.oasis\.opendocument|epub))/i;
const EXTENSIONS_COMPRESSEES = /\.(jpe?g|png|gif|webp|zip|gz|7z|rar|docx|xlsx|pptx|odt|ods|odp|mp3|mp4|mov|avi|heic)$/i;

/** Vaut-il la peine d'essayer de compresser ? */
function compressible(nom, typeMime) {
  if (typeMime && DEJA_COMPRESSES.test(typeMime)) return false;
  return !EXTENSIONS_COMPRESSEES.test(nom || '');
}

// ------------------------------------------------------------------ écrivain
class EcrivainZip {
  /**
   * @param {(tampon: Buffer) => (void|Promise<void>)} ecrire puits des octets
   * @param {{ date?: Date }} [opts] date des entrées (défaut : maintenant)
   */
  constructor(ecrire, { date = new Date() } = {}) {
    this.ecrire = ecrire;
    this.date = date;
    this.position = 0;
    this.entrees = [];
    this.noms = new Set();
    this.termine = false;
  }

  async _emettre(tampon) {
    if (this.position + tampon.length > LIMITE_32) {
      throw Object.assign(new Error('Archive trop volumineuse pour le format ZIP (4 Gio).'), { status: 413 });
    }
    this.position += tampon.length;
    await this.ecrire(tampon);
  }

  _extraTemps() {
    // 0x5455 « extended timestamp » : drapeau 1 (mtime) + secondes UTC.
    const e = Buffer.alloc(9);
    e.writeUInt16LE(0x5455, 0);
    e.writeUInt16LE(5, 2);
    e.writeUInt8(1, 4);
    e.writeUInt32LE(Math.max(0, Math.floor(this.date.getTime() / 1000)) >>> 0, 5);
    return e;
  }

  /**
   * Ajoute une entrée.
   * @param {string} nom chemin dans l'archive (rendu sûr)
   * @param {Buffer|string} contenu
   * @param {{ compresser?: boolean, typeMime?: string }} [opts]
   * @returns {Promise<{ nom, crc, taille, tailleCompressee, methode }>}
   */
  async ajouter(nom, contenu, { compresser, typeMime } = {}) {
    if (this.termine) throw new Error('Archive déjà terminée.');
    if (this.entrees.length >= MAX_ENTREES) throw Object.assign(new Error('Trop de fichiers pour une archive ZIP (65 535).'), { status: 413 });
    const chemin = nomSur(nom);
    if (this.noms.has(chemin)) throw new Error(`Entrée en double dans l'archive : ${chemin}`);
    this.noms.add(chemin);
    const donnees = Buffer.isBuffer(contenu) ? contenu : Buffer.from(String(contenu), 'utf8');
    if (donnees.length >= LIMITE_32) throw Object.assign(new Error(`Fichier trop volumineux pour le format ZIP : ${chemin}`), { status: 413 });

    const crc = crc32(donnees);
    let methode = 0;
    let charge = donnees;
    const essayer = compresser === undefined ? compressible(chemin, typeMime) : compresser;
    if (essayer && donnees.length > 64) {
      const comprime = await deflateRaw(donnees, { level: 6 });
      if (comprime.length < donnees.length * 0.95) { methode = 8; charge = comprime; }
    }

    const nomOctets = Buffer.from(chemin, 'utf8');
    const extra = this._extraTemps();
    const { heure, date } = dateDos(this.date);
    const versionRequise = methode === 8 ? 20 : 10;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(versionRequise, 4);
    local.writeUInt16LE(0x0800, 6); // bit 11 : noms en UTF-8
    local.writeUInt16LE(methode, 8);
    local.writeUInt16LE(heure, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(charge.length, 18);
    local.writeUInt32LE(donnees.length, 22);
    local.writeUInt16LE(nomOctets.length, 26);
    local.writeUInt16LE(extra.length, 28);

    const decalage = this.position;
    await this._emettre(Buffer.concat([local, nomOctets, extra]));
    await this._emettre(charge);
    const entree = { nom: chemin, nomOctets, crc, taille: donnees.length, tailleCompressee: charge.length, methode, versionRequise, heure, date, decalage, extra };
    this.entrees.push(entree);
    return { nom: chemin, crc, taille: entree.taille, tailleCompressee: entree.tailleCompressee, methode };
  }

  /** Écrit le répertoire central et la fin d'archive. */
  async terminer(commentaire = '') {
    if (this.termine) return { taille: this.position, entrees: this.entrees.length };
    const debutCentral = this.position;
    for (const e of this.entrees) {
      const extra = Buffer.alloc(9);
      e.extra.copy(extra); // même champ de temps (5 octets de données)
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE((3 << 8) | 20, 4); // créé sous Unix, spécification 2.0
      c.writeUInt16LE(e.versionRequise, 6);
      c.writeUInt16LE(0x0800, 8);
      c.writeUInt16LE(e.methode, 10);
      c.writeUInt16LE(e.heure, 12);
      c.writeUInt16LE(e.date, 14);
      c.writeUInt32LE(e.crc, 16);
      c.writeUInt32LE(e.tailleCompressee, 20);
      c.writeUInt32LE(e.taille, 24);
      c.writeUInt16LE(e.nomOctets.length, 28);
      c.writeUInt16LE(extra.length, 30);
      c.writeUInt16LE(0, 32); // commentaire
      c.writeUInt16LE(0, 34); // disque
      c.writeUInt16LE(0, 36); // attributs internes
      c.writeUInt32LE(((0o100644 << 16) >>> 0), 38); // fichier ordinaire rw-r--r--
      c.writeUInt32LE(e.decalage, 42);
      await this._emettre(Buffer.concat([c, e.nomOctets, extra]));
    }
    const tailleCentral = this.position - debutCentral;
    const com = Buffer.from(String(commentaire || ''), 'utf8').subarray(0, 0xffff);
    const fin = Buffer.alloc(22);
    fin.writeUInt32LE(0x06054b50, 0);
    fin.writeUInt16LE(0, 4);
    fin.writeUInt16LE(0, 6);
    fin.writeUInt16LE(this.entrees.length, 8);
    fin.writeUInt16LE(this.entrees.length, 10);
    fin.writeUInt32LE(tailleCentral, 12);
    fin.writeUInt32LE(debutCentral, 16);
    fin.writeUInt16LE(com.length, 20);
    await this._emettre(Buffer.concat([fin, com]));
    this.termine = true;
    return { taille: this.position, entrees: this.entrees.length };
  }
}

module.exports = { EcrivainZip, crc32, crc32Table, dateDos, nomSur, segmentSur, compressible };
