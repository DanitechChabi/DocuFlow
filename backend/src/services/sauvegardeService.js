// ============================================================================
// sauvegardeService — sauvegarde intégrée de l'application de bureau.
//
// Sur un poste Windows, toute la GED tient sur un disque : base PostgreSQL
// embarquée et dossier des documents. Une panne, un vol ou un rançongiciel, et
// le fonds disparaît — l'archivage électronique exige pourtant la restitution
// des données « dans leur intégrité » (Code du numérique, art. 302).
//
// Chaque sauvegarde est un dossier daté, autonome, dans le dossier choisi
// (disque externe, clé USB, partage réseau) :
//   DocuFlow-sauvegarde-AAAA-MM-JJ_HHMM/
//     base.dump        pg_dump au format « custom » (pg_restore)
//     documents/       copie des fichiers stockés
//     manifeste.json   date, version, empreinte SHA-256 du vidage, volumes
//     RESTAURER.txt    la marche à suivre, en français
// Les plus anciennes au-delà du nombre à conserver sont supprimées — seulement
// celles que DocuFlow a créées (nom reconnu), jamais un autre dossier.
//
// Disponible là où le serveur connaît un répertoire de données de poste
// (DOCUFLOW_DATA_DIR, posé par l'application de bureau) et un pg_dump. Sur un
// serveur hébergé, la sauvegarde relève de l'hébergeur : l'écran le dit.
// ============================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const PREFIXE = 'DocuFlow-sauvegarde-';
const RE_DOSSIER = /^DocuFlow-sauvegarde-\d{4}-\d{2}-\d{2}_\d{4}(-\d+)?$/;
const DEFAUT = { actif: false, dossier: '', conserver: 7 };

const repertoireDonnees = () => process.env.DOCUFLOW_DATA_DIR || null;
const fichierConfig = () => (repertoireDonnees() ? path.join(repertoireDonnees(), 'sauvegarde.json') : null);

function pgDump() {
  const candidats = [process.env.PG_DUMP_PATH, '/usr/bin/pg_dump', '/usr/lib/postgresql/16/bin/pg_dump'].filter(Boolean);
  return candidats.find((c) => { try { return fs.existsSync(c); } catch { return false; } }) || null;
}

/** La sauvegarde intégrée est-elle possible ici ? */
function disponibilite() {
  if (!repertoireDonnees()) return { disponible: false, raison: "Sur un serveur hébergé, la sauvegarde de la base et des fichiers relève de l'hébergeur." };
  if (!pgDump()) return { disponible: false, raison: "Outil pg_dump introuvable : la sauvegarde intégrée est indisponible sur ce poste." };
  return { disponible: true, raison: null };
}

function lire() {
  const f = fichierConfig();
  if (!f) return { ...DEFAUT, etat: null };
  try { return { ...DEFAUT, etat: null, ...JSON.parse(fs.readFileSync(f, 'utf8')) }; } catch { return { ...DEFAUT, etat: null }; }
}

function ecrire(config) {
  const f = fichierConfig();
  if (!f) throw Object.assign(new Error("La sauvegarde intégrée n'est disponible que dans l'application de bureau."), { status: 409 });
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(config, null, 2));
}

/** Réglages enregistrés (le dossier doit exister et être accessible en écriture). */
function enregistrer(corps = {}) {
  const actuel = lire();
  const dossier = corps.dossier === undefined ? actuel.dossier : String(corps.dossier || '').trim();
  if (dossier) {
    if (!path.isAbsolute(dossier)) throw Object.assign(new Error('Indiquez un chemin de dossier complet.'), { status: 400 });
    try { fs.accessSync(dossier, fs.constants.W_OK); } catch { throw Object.assign(new Error('Dossier introuvable ou en lecture seule.'), { status: 400 }); }
    if (repertoireDonnees() && path.resolve(dossier).startsWith(path.resolve(repertoireDonnees()))) {
      throw Object.assign(new Error('Choisissez un dossier hors des données de DocuFlow, idéalement sur un autre disque.'), { status: 400 });
    }
  }
  const conserver = corps.conserver === undefined ? actuel.conserver : Number(corps.conserver);
  if (!Number.isInteger(conserver) || conserver < 1 || conserver > 60) throw Object.assign(new Error('Nombre de sauvegardes à conserver : de 1 à 60.'), { status: 400 });
  const actif = corps.actif === undefined ? actuel.actif : corps.actif === true;
  if (actif && !dossier) throw Object.assign(new Error('Choisissez d\'abord le dossier de sauvegarde.'), { status: 400 });
  const suivant = { ...actuel, actif, dossier, conserver };
  ecrire(suivant);
  return etat();
}

function etat() {
  const c = lire();
  return { ...disponibilite(), actif: c.actif, dossier: c.dossier, conserver: c.conserver, derniere: c.etat, sauvegardes: lister(c.dossier) };
}

function lister(dossier) {
  if (!dossier) return [];
  try {
    return fs.readdirSync(dossier, { withFileTypes: true })
      .filter((d) => d.isDirectory() && RE_DOSSIER.test(d.name))
      .map((d) => {
        let manifeste = null;
        try { manifeste = JSON.parse(fs.readFileSync(path.join(dossier, d.name, 'manifeste.json'), 'utf8')); } catch { /* incomplète */ }
        return { nom: d.name, date: manifeste?.date || null, complete: Boolean(manifeste), octets: manifeste ? manifeste.base.octets + manifeste.documents.octets : null };
      })
      .sort((a, b) => b.nom.localeCompare(a.nom));
  } catch { return []; }
}

const sha256Fichier = (f) => new Promise((resolve, reject) => {
  const h = crypto.createHash('sha256');
  fs.createReadStream(f).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
});

/** Copie récursive ; rend { fichiers, octets }. */
function copier(source, cible) {
  let fichiers = 0;
  let octets = 0;
  if (!fs.existsSync(source)) return { fichiers, octets };
  fs.mkdirSync(cible, { recursive: true });
  for (const e of fs.readdirSync(source, { withFileTypes: true })) {
    const s = path.join(source, e.name);
    const c = path.join(cible, e.name);
    if (e.isDirectory()) {
      const r = copier(s, c);
      fichiers += r.fichiers; octets += r.octets;
    } else if (e.isFile()) {
      fs.copyFileSync(s, c);
      fichiers += 1; octets += fs.statSync(c).size;
    }
  }
  return { fichiers, octets };
}

function vider(base, dumpPath) {
  const env = { ...process.env };
  const args = ['-Fc', '-f', dumpPath];
  if (process.env.DATABASE_URL) args.push(process.env.DATABASE_URL);
  else {
    args.push('-h', process.env.DB_HOST || '127.0.0.1', '-p', String(process.env.DB_PORT || 5432), '-U', process.env.DB_USER || 'postgres', process.env.DB_NAME || base);
    if (process.env.DB_PASSWORD) env.PGPASSWORD = process.env.DB_PASSWORD;
  }
  return new Promise((resolve, reject) => {
    execFile(pgDump(), args, { env, timeout: 30 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 }, (err, _o, stderr) => {
      if (err) reject(new Error(`pg_dump a échoué : ${String(stderr || err.message).split('\n')[0]}`));
      else resolve();
    });
  });
}

const RESTAURER = (m) => `DocuFlow — restaurer cette sauvegarde
=====================================

Sauvegarde du ${new Date(m.date).toLocaleString('fr-FR')} (DocuFlow ${m.version || '?'}).
Empreinte SHA-256 de base.dump : ${m.base.empreinte_sha256}

1. Quittez DocuFlow.
2. Vérifiez l'empreinte de base.dump (PowerShell) :
     Get-FileHash base.dump -Algorithm SHA256
   Elle doit être identique à celle ci-dessus.
3. Démarrez DocuFlow une fois sur le poste de destination (la base vide est créée), puis quittez-le.
4. Restaurez la base (les outils sont dans le dossier d'installation, sous resources\\postgres\\bin) :
     pg_restore --clean --if-exists -h 127.0.0.1 -p <port> -U postgres -d docuflow base.dump
   Le port figure dans %APPDATA%\\DocuFlow\\pgdata\\postmaster.pid (4e ligne) pendant que DocuFlow tourne.
5. Recopiez le dossier « documents » dans %APPDATA%\\DocuFlow\\uploads.
6. Relancez DocuFlow, puis Archivage & preuve › Intégrité des fichiers › Contrôler maintenant :
   chaque fichier doit être déclaré intact.
`;

let enCours = null;

/** Une sauvegarde complète, maintenant. */
async function executer({ origine = 'manuelle' } = {}) {
  if (enCours) throw Object.assign(new Error('Une sauvegarde est déjà en cours.'), { status: 409 });
  const dispo = disponibilite();
  if (!dispo.disponible) throw Object.assign(new Error(dispo.raison), { status: 409 });
  const config = lire();
  if (!config.dossier) throw Object.assign(new Error("Choisissez d'abord le dossier de sauvegarde."), { status: 400 });
  enCours = (async () => {
    const debut = new Date();
    const horodate = `${debut.getFullYear()}-${String(debut.getMonth() + 1).padStart(2, '0')}-${String(debut.getDate()).padStart(2, '0')}_${String(debut.getHours()).padStart(2, '0')}${String(debut.getMinutes()).padStart(2, '0')}`;
    let nom = `${PREFIXE}${horodate}`;
    for (let i = 2; fs.existsSync(path.join(config.dossier, nom)); i += 1) nom = `${PREFIXE}${horodate}-${i}`;
    const cible = path.join(config.dossier, nom);
    const provisoire = `${cible}.en-cours`;
    try {
      fs.mkdirSync(provisoire, { recursive: true });
      const dump = path.join(provisoire, 'base.dump');
      await vider('docuflow', dump);
      const { UPLOADS_DIR } = require('../config/paths');
      const docs = copier(UPLOADS_DIR, path.join(provisoire, 'documents'));
      const manifeste = {
        date: debut.toISOString(), duree_s: Math.round((Date.now() - debut.getTime()) / 1000), origine,
        version: process.env.npm_package_version || require('../../package.json').version,
        base: { fichier: 'base.dump', octets: fs.statSync(dump).size, empreinte_sha256: await sha256Fichier(dump) },
        documents: docs,
      };
      fs.writeFileSync(path.join(provisoire, 'manifeste.json'), JSON.stringify(manifeste, null, 2));
      fs.writeFileSync(path.join(provisoire, 'RESTAURER.txt'), RESTAURER(manifeste));
      fs.renameSync(provisoire, cible);
      // Rotation : seules les sauvegardes complètes créées par DocuFlow.
      const completes = lister(config.dossier).filter((s) => s.complete);
      for (const s of completes.slice(config.conserver)) fs.rmSync(path.join(config.dossier, s.nom), { recursive: true, force: true });
      const derniere = { ok: true, at: new Date().toISOString(), nom, octets: manifeste.base.octets + docs.octets, fichiers: docs.fichiers, erreur: null };
      ecrire({ ...lire(), etat: derniere });
      return derniere;
    } catch (err) {
      fs.rmSync(provisoire, { recursive: true, force: true });
      const derniere = { ok: false, at: new Date().toISOString(), nom: null, erreur: err.message };
      try { ecrire({ ...lire(), etat: derniere }); } catch { /* dossier de données inaccessible */ }
      throw Object.assign(err, { status: err.status || 500 });
    }
  })();
  try { return await enCours; } finally { enCours = null; }
}

/** Passe planifiée : une sauvegarde par jour si activée. */
async function sauvegarderSiDue() {
  const c = lire();
  if (!c.actif || !c.dossier || !disponibilite().disponible || enCours) return null;
  const derniere = c.etat?.ok ? Date.parse(c.etat.at) : 0;
  if (Date.now() - derniere < 23 * 3600 * 1000) return null;
  return executer({ origine: 'automatique' }).catch((err) => { console.warn('[sauvegarde]', err.message); return null; });
}

let minuterie = null;
function demarrerSauvegarde() {
  if (minuterie || !repertoireDonnees()) return;
  setTimeout(() => sauvegarderSiDue(), 5 * 60 * 1000).unref?.();
  minuterie = setInterval(() => sauvegarderSiDue(), 60 * 60 * 1000);
  minuterie.unref?.();
}

module.exports = { etat, enregistrer, executer, sauvegarderSiDue, demarrerSauvegarde, disponibilite, lister, RE_DOSSIER };
