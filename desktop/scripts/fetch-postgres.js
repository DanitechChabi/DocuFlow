// ============================================================================
// fetch-postgres.js — récupère les binaires PostgreSQL portables.
//
// POURQUOI
// Aujourd'hui, un client qui installe DocuFlow doit installer PostgreSQL
// lui-même, sinon il voit la modale « PostgreSQL introuvable » (main.js). C'est
// le seul obstacle sérieux à un logiciel qui se lance au double-clic — et pour
// un acheteur non technique, c'est un obstacle rédhibitoire.
//
// Ce script télécharge l'archive « binaries only » d'EnterpriseDB (les mêmes
// binaires que l'installateur officiel, sans l'installateur) et n'en garde que
// ce dont le serveur a besoin à l'exécution. Il ne s'exécute QU'À LA COMPILATION,
// jamais chez le client : le résultat est embarqué dans l'installateur.
//
// À lancer une seule fois avant de compiler :  node scripts/fetch-postgres.js
// Idempotent — si vendor/pgsql est déjà en place, il ne fait rien.
//
// Même esprit que installer/prepare.bat pour le runtime Node, en Node plutôt
// qu'en batch : il y a ici un élagage à faire et une somme de contrôle à
// calculer, ce qui est pénible en .bat.
// ============================================================================
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const os = require('os');
const { execFileSync } = require('child_process');

// Version épinglée. NE PAS suivre aveuglément la dernière : un changement de
// version majeure change le format de PGDATA sur disque, et un client qui met à
// jour DocuFlow se retrouverait avec un cluster illisible (« database files are
// incompatible with server »). Changer ce numéro impose donc de prévoir une
// migration pg_upgrade, ou au minimum de le documenter.
const PG_VERSION = '17.6-1';
const ARCHIVE = `postgresql-${PG_VERSION}-windows-x64-binaries.zip`;
const URL = `https://get.enterprisedb.com/postgresql/${ARCHIVE}`;

// Empreinte de l'archive. `null` = premier passage : le script l'affiche et
// poursuit. La recopier ici transforme le téléchargement en artefact vérifié —
// HTTPS garantit l'authenticité du SERVEUR, pas l'immuabilité du fichier servi.
// C'est la différence entre « ça vient bien d'EnterpriseDB » et « c'est bien
// l'archive que j'ai auditée ».
//
// Relevée le 19/08/2026 sur postgresql-17.6-1-windows-x64-binaries.zip
// (329 891 687 octets). Un écart signalé ici n'est pas forcément une attaque —
// EnterpriseDB republie parfois sous le même nom — mais il impose de vérifier
// avant d'embarquer le résultat dans un installateur diffusé sous notre nom.
const EXPECTED_SHA256 = 'd378882abd001a186735acd6f6ba716bca6ccd192e800412d4fd15ed25376b3e';

const DESKTOP_DIR = path.join(__dirname, '..');
const DEST = path.join(DESKTOP_DIR, 'vendor', 'pgsql');
const TMP = path.join(os.tmpdir(), 'docuflow-pgsql');

// ----------------------------------------------------------------------------
// Élagage
//
// L'archive complète pèse ~330 Mo décompressés, dont une bonne partie ne sert
// pas à faire tourner un serveur : en-têtes de compilation, documentation,
// interface graphique de l'outil « Stack Builder » d'EnterpriseDB.
//
// Règle appliquée : on garde tout ce qui peut servir à FAIRE TOURNER ou à
// RÉPARER un cluster, on jette le reste. pg_dump et pg_controldata restent, par
// exemple, parce que le jour où un client appelle avec une base abîmée, ce sont
// exactement les outils qu'on regrettera de ne pas avoir embarqués.
// ----------------------------------------------------------------------------

// Répertoires entiers inutiles à l'exécution.
const DROP_DIRS = [
  'include',          // en-têtes C — compilation uniquement
  'doc',              // documentation
  'pgAdmin 4',        // client graphique (plusieurs centaines de Mo)
  'StackBuilder',
  'symbols',          // symboles de débogage
  'installer',
];

// Bibliothèques wxWidgets : interface graphique du Stack Builder d'EnterpriseDB,
// ~14 Mo. Le serveur n'en dépend pas.
const DROP_BIN_PATTERNS = [/^wx(msw|base)\d/i];

// Outils dont ni DocuFlow ni le support n'ont l'usage. Ceux de RÉPLICATION
// (pg_basebackup, pg_receivewal…) n'ont aucun sens sur un poste unique ; ceux de
// MESURE (pgbench, pg_test_*) sont des outils de développement.
const DROP_BIN_FILES = new Set([
  'stackbuilder.exe',
  'pgbench.exe', 'pg_test_fsync.exe', 'pg_test_timing.exe',
  'ecpg.exe', 'oid2name.exe', 'vacuumlo.exe',
  'pg_basebackup.exe', 'pg_receivewal.exe', 'pg_recvlogical.exe',
  'pg_createsubscriber.exe', 'pg_rewind.exe', 'pg_combinebackup.exe',
  'pg_verifybackup.exe', 'pg_upgrade.exe', 'pg_archivecleanup.exe',
  'pg_waldump.exe', 'pg_walsummary.exe', 'pg_amcheck.exe',
  'createuser.exe', 'dropuser.exe', 'clusterdb.exe', 'reindexdb.exe',
]);

// Binaires SANS LESQUELS RIEN NE MARCHE. Vérifiés après élagage : une faute de
// frappe dans une liste ci-dessus doit faire échouer la compilation ici, pas se
// manifester chez le client sous la forme d'un « initdb introuvable ».
const REQUIRED = [
  'bin/postgres.exe',
  'bin/initdb.exe',
  'bin/pg_ctl.exe',
  'bin/libpq.dll',
  'share/postgres.bki',           // catalogue système — initdb en dépend
  'share/postgresql.conf.sample',
];

const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(1);

/** Téléchargement avec suivi de progression et redirections. */
function download(url, dest, redirects = 0) {
  if (redirects > 5) return Promise.reject(new Error('Trop de redirections'));
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        file.close();
        fs.rmSync(dest, { force: true });
        res.resume();
        return download(res.headers.location, dest, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.rmSync(dest, { force: true });
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} sur ${url}`));
      }

      const total = Number(res.headers['content-length']) || 0;
      let seen = 0;
      let lastShown = 0;
      res.on('data', (chunk) => {
        seen += chunk.length;
        // Un point tous les 5 % : le journal reste lisible même redirigé dans un
        // fichier, contrairement à une barre de progression réécrite en place.
        const pct = total ? Math.floor((seen / total) * 100) : 0;
        if (pct >= lastShown + 5) {
          lastShown = pct;
          process.stdout.write(`\r      ${pct}% (${mb(seen)} / ${mb(total)} Mo)   `);
        }
      });
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          process.stdout.write('\n');
          resolve();
        });
      });
    }).on('error', (err) => {
      file.close();
      fs.rmSync(dest, { force: true });
      reject(err);
    });
  });
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

/** Copie récursive en élaguant. Renvoie le nombre d'octets réellement copiés. */
function copyPruned(src, dst, relative = '') {
  let bytes = 0;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      if (DROP_DIRS.includes(entry.name)) continue;
      bytes += copyPruned(path.join(src, entry.name), path.join(dst, entry.name), rel);
      continue;
    }

    if (relative === 'bin') {
      if (DROP_BIN_FILES.has(entry.name.toLowerCase())) continue;
      if (DROP_BIN_PATTERNS.some((re) => re.test(entry.name))) continue;
    }

    const from = path.join(src, entry.name);
    fs.copyFileSync(from, path.join(dst, entry.name));
    bytes += fs.statSync(from).size;
  }
  return bytes;
}

async function main() {
  if (fs.existsSync(path.join(DEST, 'bin', 'postgres.exe'))) {
    console.log(`[OK] Binaires PostgreSQL déjà présents : ${DEST}`);
    console.log('     Supprimer ce dossier pour forcer un nouveau téléchargement.');
    return;
  }

  fs.mkdirSync(TMP, { recursive: true });
  const zip = path.join(TMP, ARCHIVE);

  if (fs.existsSync(zip) && fs.statSync(zip).size > 100 * 1024 * 1024) {
    console.log(`[1/4] Archive déjà téléchargée : ${zip} (${mb(fs.statSync(zip).size)} Mo)`);
  } else {
    console.log(`[1/4] Téléchargement de PostgreSQL ${PG_VERSION} (~330 Mo)...`);
    console.log(`      ${URL}`);
    await download(URL, zip);
  }

  console.log('[2/4] Vérification de l\'empreinte...');
  const digest = sha256(zip);
  if (EXPECTED_SHA256 && digest !== EXPECTED_SHA256) {
    // Un binaire de base de données qui ne correspond pas à ce qui a été audité
    // ne doit surtout pas atterrir dans un installateur signé de notre nom.
    throw new Error(
      `Empreinte incorrecte.\n  attendue : ${EXPECTED_SHA256}\n  obtenue  : ${digest}\n`
      + '  L\'archive a changé côté serveur, ou le téléchargement est corrompu.'
    );
  }
  console.log(`      sha256 : ${digest}`);
  if (!EXPECTED_SHA256) {
    console.log('      ↑ à recopier dans EXPECTED_SHA256 pour verrouiller cette version.');
  }

  console.log('[3/4] Extraction...');
  const extract = path.join(TMP, 'extract');
  fs.rmSync(extract, { recursive: true, force: true });
  fs.mkdirSync(extract, { recursive: true });
  // Expand-Archive plutôt qu'une dépendance npm : présent sur tout Windows
  // moderne, et ce script tourne à la compilation sur un poste de développeur.
  execFileSync('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Expand-Archive -Path '${zip}' -DestinationPath '${extract}' -Force`,
  ], { stdio: 'inherit' });

  const root = path.join(extract, 'pgsql');
  if (!fs.existsSync(root)) {
    throw new Error(`Structure d'archive inattendue : ${root} absent`);
  }

  console.log('[4/4] Copie vers vendor/pgsql avec élagage...');
  fs.rmSync(DEST, { recursive: true, force: true });
  const copied = copyPruned(root, DEST);

  // Contrôle d'intégrité : l'élagage n'a pas emporté l'essentiel.
  const missing = REQUIRED.filter((rel) => !fs.existsSync(path.join(DEST, ...rel.split('/'))));
  if (missing.length) {
    throw new Error(
      `Élagage trop agressif — fichiers indispensables absents :\n  ${missing.join('\n  ')}`
    );
  }

  // Trace de version : postgres.js la lit pour détecter un cluster créé par une
  // version majeure différente, cas où le serveur refuserait de démarrer.
  fs.writeFileSync(
    path.join(DEST, 'DOCUFLOW_PG_VERSION.txt'),
    `${PG_VERSION}\nsha256=${digest}\n`,
    'utf8'
  );

  fs.rmSync(extract, { recursive: true, force: true });

  console.log(`\n[OK] PostgreSQL portable prêt : ${DEST}`);
  console.log(`     ${mb(copied)} Mo après élagage`);
  console.log(`     Archive conservée dans ${TMP} (supprimable).`);
}

main().catch((err) => {
  console.error(`\n[ERREUR] ${err.message}`);
  process.exit(1);
});
