// ============================================================================
// horodatageService — horodatage par une autorité tierce (RFC 3161), loi
// n° 2017-20 portant Code du numérique en République du Bénin, art. 299-300.
//
// Ce qui est horodaté : l'EMPREINTE SHA-256 des pièces probantes de DocuFlow,
//   sceau          tête du journal chaîné scellée (audit_sceaux.chaine_hash) ;
//   pv_elimination procès-verbal d'élimination (bordereaux_elimination.empreinte_pv) ;
//   versement      bordereau de versement transmis (bordereaux_versement.empreinte).
// Seule l'empreinte part chez l'autorité : rien du contenu ne quitte DocuFlow.
//
// Le jeton reçu (TimeStampResp, DER) est conservé TEL QUEL : c'est lui qui
// prouve, et il se vérifie sans DocuFlow :
//   openssl ts -verify -digest <empreinte> -in jeton.tsr -CAfile <certificat de l'autorité>
// DocuFlow contrôle à réception que l'autorité a accordé l'horodatage et que
// le jeton porte bien l'empreinte demandée ; il en lit la date (genTime).
//
// La tâche de fond horodate ce qui ne l'est pas encore, réessaie les échecs
// (au plus une fois par heure), et ne fait jamais échouer une action métier.
// ============================================================================
const crypto = require('crypto');
const axios = require('axios');
const db = require('../config/db');
const settingsService = require('./settingsService');

const OID_SHA256 = Buffer.from('0609608648016503040201', 'hex');
const TSA_DEFAUT = 'https://freetsa.org/tsr';

// ------------------------------------------------------------------ DER

/** Longueur DER (forme courte ou longue). */
function longueur(n) {
  if (n < 0x80) return Buffer.from([n]);
  const octets = [];
  for (let v = n; v > 0; v >>= 8) octets.unshift(v & 0xff);
  return Buffer.from([0x80 | octets.length, ...octets]);
}
const tlv = (tag, contenu) => Buffer.concat([Buffer.from([tag]), longueur(contenu.length), contenu]);
const sequence = (...elements) => tlv(0x30, Buffer.concat(elements));
/** Entier DER positif (un 0x00 de tête si le bit de poids fort est levé). */
const entier = (octets) => {
  let b = Buffer.from(octets);
  while (b.length > 1 && b[0] === 0 && b[1] < 0x80) b = b.subarray(1);
  return tlv(0x02, b[0] & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b);
};

/**
 * TimeStampReq (RFC 3161, § 2.4.1) : version 1, empreinte SHA-256, nonce,
 * certReq vrai (le jeton embarque le certificat de l'autorité).
 */
function requete(empreinteHex, nonce = crypto.randomBytes(8)) {
  if (!/^[0-9a-f]{64}$/i.test(empreinteHex)) throw new Error('Empreinte SHA-256 attendue (64 caractères hexadécimaux).');
  return sequence(
    entier([1]),
    sequence(sequence(OID_SHA256, Buffer.from([0x05, 0x00])), tlv(0x04, Buffer.from(empreinteHex, 'hex'))),
    entier(nonce),
    Buffer.from([0x01, 0x01, 0xff]),
  );
}

/** Lit un élément DER à `pos` : { tag, debut (du contenu), fin }. */
function lire(buf, pos) {
  const tag = buf[pos];
  let l = buf[pos + 1];
  let debut = pos + 2;
  if (l & 0x80) {
    const n = l & 0x7f;
    if (n === 0 || n > 4) throw new Error('Longueur DER non prise en charge.');
    l = 0;
    for (let i = 0; i < n; i += 1) l = (l * 256) + buf[debut + i];
    debut += n;
  }
  const fin = debut + l;
  if (fin > buf.length) throw new Error('Réponse d\'horodatage tronquée.');
  return { tag, debut, fin };
}

/** Enfants directs d'un élément construit. */
function enfants(buf, el) {
  const liste = [];
  for (let p = el.debut; p < el.fin;) {
    const e = lire(buf, p);
    liste.push(e);
    p = e.fin;
  }
  return liste;
}

/** 'YYYYMMDDHHMMSS[.fff]Z' → ISO 8601. */
function dateGeneralisee(s) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\.\d+)?Z$/.exec(s);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] || ''}Z`;
}

/**
 * Analyse un TimeStampResp. Contrôles : statut accordé (0 ou 1), présence du
 * jeton, empreinte demandée retrouvée dans le TSTInfo, date lisible.
 * @returns {{ accorde: boolean, statut: number, genere_at: string|null, numero_serie: string|null, autorite: string|null }}
 */
function analyserReponse(buf, empreinteHex) {
  const racine = lire(buf, 0);
  if (racine.tag !== 0x30) throw new Error('Réponse d\'horodatage invalide (SEQUENCE attendue).');
  const [statutInfo, jeton] = enfants(buf, racine);
  const statutEl = enfants(buf, statutInfo)[0];
  const statut = buf[statutEl.fin - 1];
  if (statut > 1 || !jeton) return { accorde: false, statut, genere_at: null, numero_serie: null, autorite: null };
  // Le TSTInfo est un OCTET STRING enfoui dans le SignedData : on le repère par
  // l'empreinte demandée (messageImprint), puis on lit la séquence qui la porte.
  const empreinte = Buffer.from(empreinteHex, 'hex');
  const imprint = Buffer.concat([Buffer.from([0x04, 0x20]), empreinte]);
  const ou = buf.indexOf(imprint, jeton.debut);
  if (ou < 0) throw new Error("Le jeton ne porte pas l'empreinte demandée.");
  // Après messageImprint : serialNumber (INTEGER) puis genTime (GeneralizedTime).
  let p = ou + imprint.length;
  const serie = lire(buf, p);
  if (serie.tag !== 0x02) throw new Error('Numéro de série du jeton illisible.');
  p = serie.fin;
  const temps = lire(buf, p);
  if (temps.tag !== 0x18) throw new Error('Date du jeton illisible.');
  const genere = dateGeneralisee(buf.subarray(temps.debut, temps.fin).toString('latin1'));
  if (!genere) throw new Error('Date du jeton illisible.');
  // Nom de l'autorité : le CN le plus proche après la date, s'il y en a un.
  const cn = buf.indexOf(Buffer.from('0603550403', 'hex'), temps.fin);
  let autorite = null;
  if (cn > 0) {
    const v = lire(buf, cn + 5);
    if ([0x0c, 0x13, 0x16].includes(v.tag)) autorite = buf.subarray(v.debut, v.fin).toString('utf8');
  }
  return {
    accorde: true, statut, genere_at: genere,
    numero_serie: buf.subarray(serie.debut, serie.fin).toString('hex').replace(/^0+(?=.)/, ''),
    autorite,
  };
}

// ------------------------------------------------------------------ base

let migrationPromesse = null;
const migrationPassee = () => {
  if (!migrationPromesse) {
    migrationPromesse = db.query("SELECT to_regclass('horodatages') IS NOT NULL AS ok")
      .then((r) => r.rows[0].ok).catch(() => { migrationPromesse = null; return false; });
  }
  return migrationPromesse;
};

async function reglages(tenantId) {
  const r = await settingsService.getAll(tenantId);
  return { actif: r.horodatage_actif === true, url: String(r.horodatage_tsa_url || '').trim() || TSA_DEFAUT };
}

/**
 * Horodate une empreinte et enregistre le résultat (jeton ou échec).
 * Un horodatage déjà obtenu pour cet objet et cette empreinte est rendu tel quel.
 */
async function horodater(tenantId, objetType, objetId, empreinteHex, { url = null } = {}) {
  const deja = (await db.query(
    'SELECT * FROM horodatages WHERE tenant_id = $1 AND objet_type = $2 AND objet_id = $3 AND empreinte = $4',
    [tenantId, objetType, objetId, empreinteHex])).rows[0];
  if (deja && deja.statut === 'obtenu') return vers(deja);
  const adresse = url || (await reglages(tenantId)).url;
  let resultat;
  try {
    const rep = await module.exports.http.post(adresse, requete(empreinteHex), {
      headers: { 'Content-Type': 'application/timestamp-query', Accept: 'application/timestamp-reply' },
      responseType: 'arraybuffer', timeout: 30000, maxContentLength: 1024 * 1024,
    });
    const jeton = Buffer.from(rep.data);
    const a = analyserReponse(jeton, empreinteHex);
    resultat = a.accorde
      ? { statut: 'obtenu', jeton, genere_at: a.genere_at, numero_serie: a.numero_serie, autorite: a.autorite, erreur: null }
      : { statut: 'echec', erreur: `Horodatage refusé par l'autorité (statut ${a.statut}).` };
  } catch (err) {
    resultat = { statut: 'echec', erreur: String(err.message || err).slice(0, 500) };
  }
  const { rows } = deja
    ? await db.query(
      `UPDATE horodatages SET statut = $2, jeton = $3, genere_at = $4, numero_serie = $5, autorite = $6, erreur = $7,
              tsa_url = $8, tentatives = tentatives + 1, updated_at = now() WHERE id = $1 RETURNING *`,
      [deja.id, resultat.statut, resultat.jeton || null, resultat.genere_at || null, resultat.numero_serie || null,
        resultat.autorite || null, resultat.erreur, adresse])
    : await db.query(
      `INSERT INTO horodatages (tenant_id, objet_type, objet_id, empreinte, tsa_url, statut, jeton, genere_at, numero_serie, autorite, erreur)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [tenantId, objetType, objetId, empreinteHex, adresse, resultat.statut, resultat.jeton || null, resultat.genere_at || null,
        resultat.numero_serie || null, resultat.autorite || null, resultat.erreur]);
  return vers(rows[0]);
}

function vers(h) {
  return {
    id: h.id, objet_type: h.objet_type, objet_id: h.objet_id, empreinte: String(h.empreinte).trim(), tsa_url: h.tsa_url,
    statut: h.statut, genere_at: h.genere_at, numero_serie: h.numero_serie, autorite: h.autorite, erreur: h.erreur,
    tentatives: h.tentatives, created_at: h.created_at,
  };
}

/** Pièces probantes d'une organisation qui n'ont pas encore leur jeton. */
const SQL_EN_ATTENTE = `
  SELECT 'sceau' AS type, s.id, s.chaine_hash::text AS empreinte FROM audit_sceaux s WHERE s.tenant_id = $1
  UNION ALL
  SELECT 'pv_elimination', b.id, b.empreinte_pv::text FROM bordereaux_elimination b
   WHERE b.tenant_id = $1 AND b.statut = 'execute' AND b.empreinte_pv IS NOT NULL
  UNION ALL
  SELECT 'versement', v.id, v.empreinte::text FROM bordereaux_versement v
   WHERE v.tenant_id = $1 AND v.statut IN ('transmis', 'pris_en_charge') AND v.empreinte IS NOT NULL`;

async function enAttente(tenantId) {
  const { rows } = await db.query(
    `SELECT a.type, a.id, trim(a.empreinte) AS empreinte, h.statut, h.updated_at
       FROM (${SQL_EN_ATTENTE}) a
       LEFT JOIN horodatages h ON h.tenant_id = $1 AND h.objet_type = a.type AND h.objet_id = a.id AND h.empreinte = trim(a.empreinte)
      WHERE h.id IS NULL OR (h.statut = 'echec' AND h.updated_at < now() - interval '1 hour')
      ORDER BY a.type, a.id LIMIT 50`, [tenantId]);
  return rows;
}

/** Une passe : chaque organisation qui a activé l'horodatage. */
async function horodaterEnAttente() {
  if (!(await migrationPassee())) return 0;
  const { rows } = await db.query("SELECT tenant_id FROM settings WHERE key = 'horodatage_actif' AND value = 'true'");
  let n = 0;
  for (const { tenant_id: t } of rows) {
    for (const a of await enAttente(t)) {
      const h = await horodater(t, a.type, a.id, a.empreinte).catch((err) => { console.warn('[horodatage]', err.message); return null; });
      if (h && h.statut === 'obtenu') n += 1;
    }
  }
  return n;
}

let minuterie = null;
function demarrerHorodatage() {
  if (minuterie) return;
  const passe = () => horodaterEnAttente().then((n) => { if (n) console.log(`[horodatage] ${n} jeton(s) obtenu(s)`); }).catch((err) => console.warn('[horodatage]', err.message));
  setTimeout(passe, 60 * 1000).unref?.();
  minuterie = setInterval(passe, 15 * 60 * 1000);
  minuterie.unref?.();
}

/** Horodatages d'une organisation, les plus récents d'abord. */
async function lister(tenantId, { objetType = null, objetId = null } = {}) {
  const params = [tenantId];
  let filtre = '';
  if (objetType) { params.push(objetType); filtre += ` AND objet_type = $${params.length}`; }
  if (objetId) { params.push(Number(objetId)); filtre += ` AND objet_id = $${params.length}`; }
  const { rows } = await db.query(`SELECT * FROM horodatages WHERE tenant_id = $1${filtre} ORDER BY created_at DESC LIMIT 500`, params);
  const attente = await enAttente(tenantId).catch(() => []);
  return { horodatages: rows.map(vers), en_attente: attente.length, reglages: await reglages(tenantId) };
}

/** Jeton brut (.tsr) d'un horodatage obtenu. */
async function jeton(tenantId, id) {
  const { rows } = await db.query("SELECT * FROM horodatages WHERE id = $1 AND tenant_id = $2 AND statut = 'obtenu'", [Number(id), tenantId]);
  return rows[0] || null;
}

/** Horodate maintenant tout ce qui attend (bouton « Horodater maintenant »). */
async function horodaterOrganisation(tenantId) {
  const r = await reglages(tenantId);
  if (!r.actif) throw Object.assign(new Error("L'horodatage est désactivé : activez-le dans Configuration › Archivage & preuve."), { status: 409 });
  const resultats = [];
  for (const a of await enAttente(tenantId)) resultats.push(await horodater(tenantId, a.type, a.id, a.empreinte, { url: r.url }));
  return { obtenus: resultats.filter((h) => h.statut === 'obtenu').length, echecs: resultats.filter((h) => h.statut === 'echec').map((h) => h.erreur) };
}

module.exports = {
  TSA_DEFAUT, requete, analyserReponse, dateGeneralisee, horodater, horodaterEnAttente, demarrerHorodatage,
  lister, jeton, horodaterOrganisation, enAttente, http: axios,
};
