// ============================================================================
// machineId — empreinte stable du poste, pour lier une licence à un ordinateur.
//
// CE QU'ON CHERCHE : une valeur qui ne bouge PAS entre deux démarrages du même
// poste, mais qui diffère d'un poste à l'autre. Ni plus, ni moins. Ce n'est pas
// un secret : elle est envoyée au serveur d'activation et figure dans le payload
// signé. Le hachage sert à ne pas exposer d'identifiants matériels bruts, pas à
// dissimuler quoi que ce soit.
//
// ORDRE DES SOURCES — DICTÉ PAR LA MESURE, PAS PAR L'HABITUDE
// La recette répandue est « wmic csproduct get uuid ». Mesuré sur ce poste
// (Windows 11 26200) :
//
//   reg query MachineGuid ............ 139 ms (842 ms au tout premier appel)
//   wmic csproduct get uuid .......... ÉCHEC — spawnSync wmic ENOENT
//   powershell Get-CimInstance UUID ... 4034 ms
//
// wmic a été RETIRÉ de Windows 11 récent ; il ne peut donc pas être la source
// principale. Et 4 secondes de PowerShell à chaque démarrage seraient 4 secondes
// d'écran d'attente supplémentaires sur un logiciel vendu pour sa fluidité —
// pour obtenir une information que le registre donne trente fois plus vite.
//
// D'où : registre d'abord, WMI en dernier recours seulement.
//
// STABILITÉ DE CHAQUE SOURCE
//   MachineGuid — écrit à l'installation de Windows, jamais modifié ensuite.
//     Change si le client réinstalle Windows (attendu : le support délie alors
//     la licence via /reset-machine).
//   ProductId + InstallDate — deuxième et troisième couches, même origine
//     (registre), pour qu'un MachineGuid illisible ne réduise pas l'empreinte à
//     rien.
//   UUID matériel (WMI) — survit à une réinstallation de Windows mais coûte 4 s
//     et manque sur certaines machines virtuelles (valeur toute à zéro ou
//     « ffffffff-… »), cas explicitement écartés plus bas.
//
// CE QUI EST DÉLIBÉRÉMENT EXCLU DE L'EMPREINTE
//   • le nom d'hôte : un renommage de poste est courant en entreprise et
//     invaliderait la licence sans raison ;
//   • la mémoire, le disque, l'adresse MAC : une barrette ajoutée, un disque
//     remplacé, un dock Ethernet débranché suffiraient à bloquer le client.
// Chaque élément ajouté à une empreinte est une occasion supplémentaire de
// bloquer un client qui n'a rien fait de mal.
// ============================================================================
const crypto = require('crypto');
const os = require('os');
const { execFileSync } = require('child_process');

// Budget de temps par source. Une source lente est une source abandonnée : mieux
// vaut une empreinte fondée sur deux valeurs de registre qu'un démarrage qui
// traîne. Sur les mesures ci-dessus, 3 s laissent une marge confortable au
// registre tout en écartant un WMI pathologique.
const TIMEOUT_MS = 3000;

/** Lit une valeur du registre. Renvoie '' au moindre problème — jamais d'exception. */
function readRegistry(keyPath, valueName, type = 'REG_SZ') {
  try {
    const out = execFileSync('reg', ['query', keyPath, '/v', valueName], {
      encoding: 'utf8',
      timeout: TIMEOUT_MS,
      windowsHide: true,       // sans quoi une console noire clignote au démarrage
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const m = out.match(new RegExp(`${valueName}\\s+${type}\\s+(\\S+)`, 'i'));
    return m ? m[1].trim() : '';
  } catch {
    return '';
  }
}

/**
 * UUID matériel via WMI. Coûteux (~4 s) : réservé au cas où le registre n'a
 * rien donné du tout.
 */
function readHardwareUuid() {
  try {
    const out = execFileSync('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      '(Get-CimInstance -ClassName Win32_ComputerSystemProduct).UUID',
    ], { encoding: 'utf8', timeout: 8000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const uuid = out.trim().toLowerCase();

    // Valeurs de remplissage rencontrées sur les machines virtuelles et certains
    // BIOS mal renseignés : identiques d'un poste à l'autre, donc pires que rien
    // — deux clients différents obtiendraient la même empreinte, et le second
    // verrait sa licence refusée pour « déjà utilisée sur un autre ordinateur ».
    if (!uuid || /^[0-]+$/.test(uuid) || /^f{8}-f{4}/.test(uuid)) return '';
    return uuid;
  } catch {
    return '';
  }
}

/** Sources non-Windows — l'app cible Windows, mais le développement a lieu partout. */
function unixSources() {
  const parts = [];
  try {
    // Linux : identifiant de machine posé par systemd, équivalent du MachineGuid.
    parts.push(require('fs').readFileSync('/etc/machine-id', 'utf8').trim());
  } catch { /* absent */ }
  try {
    // macOS : IOPlatformUUID.
    const out = execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], {
      encoding: 'utf8', timeout: TIMEOUT_MS,
    });
    const m = out.match(/IOPlatformUUID"\s*=\s*"([^"]+)"/);
    if (m) parts.push(m[1]);
  } catch { /* pas macOS */ }
  return parts.filter(Boolean);
}

let cached = null;

/**
 * Empreinte du poste : SHA-256 hexadécimal (64 caractères).
 *
 * Mise en cache pour la durée du processus. Sans cela, chaque vérification de
 * licence relancerait `reg query` ; avec le rafraîchissement hebdomadaire et les
 * lectures de l'écran de licence, cela finirait par se voir.
 *
 * @returns {string} 64 caractères hexadécimaux
 */
function getMachineId() {
  if (cached) return cached;

  const parts = [];

  if (process.platform === 'win32') {
    const guid = readRegistry('HKLM\\SOFTWARE\\Microsoft\\Cryptography', 'MachineGuid');
    if (guid) parts.push(`guid:${guid.toLowerCase()}`);

    const productId = readRegistry('HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion', 'ProductId');
    if (productId) parts.push(`pid:${productId}`);

    const installDate = readRegistry(
      'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion', 'InstallDate', 'REG_DWORD'
    );
    if (installDate) parts.push(`inst:${installDate}`);

    // Le registre n'a rien donné : c'est anormal (droits restreints, ruche
    // abîmée). On paie alors les 4 s de WMI plutôt que de renoncer.
    if (parts.length === 0) {
      const uuid = readHardwareUuid();
      if (uuid) parts.push(`hw:${uuid}`);
    }
  } else {
    parts.push(...unixSources());
  }

  // Filet de sécurité : aucune source exploitable. Le nom d'hôte et le modèle de
  // processeur sont de piètres identifiants — deux postes d'un même lot
  // produiraient la même empreinte — mais une licence liée à une empreinte
  // médiocre reste préférable à un logiciel qui refuse de s'activer. Le cas est
  // journalisé pour que le support puisse l'identifier.
  if (parts.length === 0) {
    console.warn('[machineId] Aucune source matérielle exploitable — empreinte dégradée.');
    parts.push(`fallback:${os.hostname()}:${os.cpus()[0]?.model || 'cpu'}:${os.arch()}`);
  }

  cached = crypto.createHash('sha256').update(parts.join('|')).digest('hex');
  return cached;
}

/**
 * Libellé du poste, purement informatif : il s'affiche dans la liste des
 * licences pour que le support sache de quel ordinateur on parle au téléphone.
 * N'entre PAS dans l'empreinte (un poste renommé garde sa licence).
 */
function getMachineLabel() {
  return `${os.hostname()} (${os.platform()} ${os.release()})`.slice(0, 255);
}

/** Détail des sources retenues — pour un diagnostic de support, jamais affiché. */
function describe() {
  return {
    machine_id: getMachineId(),
    label: getMachineLabel(),
    platform: process.platform,
  };
}

module.exports = { getMachineId, getMachineLabel, describe };
