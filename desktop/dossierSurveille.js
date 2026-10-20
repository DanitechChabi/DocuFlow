// ============================================================================
// Dossier surveillé — le « dossier de dépôt » (hot folder) du poste.
//
// L'utilisateur désigne un dossier — typiquement la sortie de son scanner.
// Chaque fichier qui y arrive est signalé, une fois COMPLET, pour être versé
// dans DocuFlow (statut « À indexer »), puis rangé :
//   <dossier>/_Importés DocuFlow/AAAA-MM-JJ/<fichier>   versé
//   <dossier>/_Non importés/<fichier> (+ .raison.txt)   refusé 3 fois
// Rien n'est jamais supprimé : l'original reste sur le poste, rangé.
//
// Module Node PUR (aucune dépendance à Electron) : testé hors de l'application
// (dossierSurveille.test.js). main.js le branche sur l'IPC ; le versement
// lui-même est fait par la fenêtre, AU NOM de l'utilisateur connecté.
//
// « Complet » : un scanner écrit son fichier en plusieurs fois. Un fichier
// n'est signalé que si sa taille et sa date n'ont pas bougé entre deux passes
// ET qu'il s'ouvre en écriture (sous Windows, un fichier en cours d'écriture
// est verrouillé).
// ============================================================================
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const SOUS_DOSSIER_IMPORTES = '_Importés DocuFlow';
const SOUS_DOSSIER_REFUSES = '_Non importés';
const ESSAIS_MAX = 3;
const EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'tif', 'tiff', 'gif', 'doc', 'docx', 'xls', 'xlsx', 'txt']);
const TYPES = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', tif: 'image/tiff', tiff: 'image/tiff',
  gif: 'image/gif', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', txt: 'text/plain',
};

/** Fichier à ignorer : caché, temporaire (Office, navigateur, scanner), système. */
function ignore(nom) {
  const n = nom.toLowerCase();
  return n.startsWith('.') || n.startsWith('~$') || n === 'desktop.ini' || n === 'thumbs.db'
    || /\.(tmp|part|crdownload|partial|download)$/.test(n);
}

const extension = (nom) => path.extname(nom).toLowerCase().replace(/^\./, '');
const typeDe = (nom) => TYPES[extension(nom)] || 'application/octet-stream';
const jour = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Destination libre : « scan.pdf » existe déjà → « scan (2).pdf ». */
function destinationLibre(dossier, nom) {
  const ext = path.extname(nom);
  const base = path.basename(nom, ext);
  let cible = path.join(dossier, nom);
  for (let i = 2; fs.existsSync(cible); i += 1) cible = path.join(dossier, `${base} (${i})${ext}`);
  return cible;
}

/** Déplace un fichier (repli copie + suppression si autre volume). */
function deplacer(source, dossierCible) {
  fs.mkdirSync(dossierCible, { recursive: true });
  const cible = destinationLibre(dossierCible, path.basename(source));
  try {
    fs.renameSync(source, cible);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.copyFileSync(source, cible);
    fs.unlinkSync(source);
  }
  return cible;
}

class DossierSurveille extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.dossier       chemin absolu du dossier surveillé
   * @param {number} [opts.intervalleMs] délai entre deux passes (4 s)
   */
  constructor({ dossier, intervalleMs = 4000 } = {}) {
    super();
    this.dossier = dossier;
    this.intervalleMs = intervalleMs;
    this.suivis = new Map();     // nom → { taille, mtimeMs, passesStables, essais, signale }
    this.minuterie = null;
    this.stats = { importesAujourdhui: 0, jour: jour(), dernierImport: null, erreurs: [] };
  }

  demarrer() {
    if (this.minuterie) return;
    const tour = () => {
      try { this.passe(); } catch (err) { this.noterErreur(null, err.message); }
      this.minuterie = setTimeout(tour, this.intervalleMs);
      this.minuterie.unref?.();
    };
    tour();
  }

  arreter() {
    clearTimeout(this.minuterie);
    this.minuterie = null;
  }

  /** Une passe sur le dossier : signale les fichiers devenus complets. */
  passe() {
    if (!this.dossier || !fs.existsSync(this.dossier)) {
      this.noterErreur(null, 'Dossier surveillé introuvable : vérifiez le chemin dans les réglages.');
      return [];
    }
    const presents = new Set();
    const prets = [];
    for (const entree of fs.readdirSync(this.dossier, { withFileTypes: true })) {
      if (!entree.isFile() || ignore(entree.name) || !EXTENSIONS.has(extension(entree.name))) continue;
      presents.add(entree.name);
      const chemin = path.join(this.dossier, entree.name);
      let st;
      try { st = fs.statSync(chemin); } catch { continue; }
      const suivi = this.suivis.get(entree.name) || { taille: -1, mtimeMs: -1, passesStables: 0, essais: 0, signale: false };
      if (st.size === suivi.taille && st.mtimeMs === suivi.mtimeMs && st.size > 0) suivi.passesStables += 1;
      else { suivi.passesStables = 0; suivi.taille = st.size; suivi.mtimeMs = st.mtimeMs; }
      this.suivis.set(entree.name, suivi);
      if (suivi.signale || suivi.passesStables < 1 || !this.ouvrable(chemin)) continue;
      suivi.signale = true;
      const fichier = { chemin, nom: entree.name, taille: st.size, type: typeDe(entree.name) };
      prets.push(fichier);
      this.emit('pret', fichier);
    }
    for (const nom of this.suivis.keys()) if (!presents.has(nom)) this.suivis.delete(nom);
    return prets;
  }

  /** Le fichier n'est-il plus en cours d'écriture ? */
  ouvrable(chemin) {
    try {
      fs.closeSync(fs.openSync(chemin, 'r+'));
      return true;
    } catch {
      return false;
    }
  }

  /** Le chemin désigne-t-il un fichier signalé de CE dossier ? (garde de l'IPC) */
  estSignale(chemin) {
    if (typeof chemin !== 'string' || path.dirname(path.resolve(chemin)) !== path.resolve(this.dossier)) return false;
    return this.suivis.get(path.basename(chemin))?.signale === true;
  }

  /** Contenu d'un fichier signalé (et de lui seul). */
  lire(chemin) {
    if (!this.estSignale(chemin)) throw new Error('Fichier non signalé par le dossier surveillé.');
    return { nom: path.basename(chemin), type: typeDe(chemin), donnees: fs.readFileSync(chemin) };
  }

  /**
   * Résultat du versement d'un fichier signalé.
   * `transitoire` : échec qui ne tient pas au fichier (serveur injoignable,
   * erreur interne) — nouvel essai sans le compter : une coupure ne doit pas
   * envoyer un bon scan dans « _Non importés ».
   * @param {{ ok: boolean, raison?: string, transitoire?: boolean }} resultat
   * @returns {string|null} nouvel emplacement du fichier s'il a été rangé
   */
  confirmer(chemin, { ok, raison, transitoire = false } = {}) {
    if (!this.estSignale(chemin)) return null;
    const nom = path.basename(chemin);
    const suivi = this.suivis.get(nom);
    if (ok) {
      const range = deplacer(chemin, path.join(this.dossier, SOUS_DOSSIER_IMPORTES, jour()));
      this.suivis.delete(nom);
      if (this.stats.jour !== jour()) Object.assign(this.stats, { jour: jour(), importesAujourdhui: 0 });
      this.stats.importesAujourdhui += 1;
      this.stats.dernierImport = { nom, le: new Date().toISOString() };
      this.emit('etat', this.etat());
      return range;
    }
    if (!transitoire) suivi.essais += 1;
    this.noterErreur(nom, raison || 'Versement refusé.');
    if (suivi.essais >= ESSAIS_MAX) {
      const range = deplacer(chemin, path.join(this.dossier, SOUS_DOSSIER_REFUSES));
      fs.writeFileSync(`${range}.raison.txt`, `${new Date().toLocaleString('fr-FR')} — ${raison || 'Versement refusé.'}\n`);
      this.suivis.delete(nom);
      this.emit('etat', this.etat());
      return range;
    }
    // Nouvel essai à la passe suivante.
    suivi.signale = false;
    suivi.passesStables = 0;
    return null;
  }

  noterErreur(nom, message) {
    this.stats.erreurs = [{ nom, message, le: new Date().toISOString() }, ...this.stats.erreurs].slice(0, 5);
    this.emit('etat', this.etat());
  }

  etat() {
    const enAttente = [...this.suivis.values()].filter((s) => !s.signale).length;
    return { dossier: this.dossier, enAttente, ...this.stats };
  }
}

module.exports = { DossierSurveille, ignore, typeDe, SOUS_DOSSIER_IMPORTES, SOUS_DOSSIER_REFUSES, ESSAIS_MAX };
