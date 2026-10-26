// ============================================================================
// registreOfficielService — contrôle au registre officiel (INSEE SIRENE, France).
//
// FACULTATIF : réglage conformite_verifier_registre, référentiel « France »
// et clé INSEE_API_KEY dans l'environnement du serveur. Pour chaque document
// analysé qui porte un SIRET (ou un SIREN), on interroge l'API officielle :
//
//   registre_introuvable  le numéro n'existe pas — faux établissement ou
//                         numéro inventé (critique)
//   registre_ferme        établissement fermé ou entreprise cessée (haute)
//   nom_incoherent        le nom du document n'est pas celui du registre (moyenne)
//   adresse_incoherente   l'adresse du document n'est pas celle du registre (moyenne)
//
// Chaque numéro n'est interrogé qu'une fois par passage. Une erreur réseau
// ou un quota dépassé ne lève AUCUNE alerte : le doute ne vaut pas accusation.
// `http` est exposé pour que les tests substituent le réseau.
// ============================================================================
const axios = require('axios');
const { alerte, cleNom } = require('./alerteFabrique');

const URL_BASE = 'https://api.insee.fr/api-sirene/3.11';
const DELAI_MS = 5000;
const http = { get: (...args) => axios.get(...args) };

const chiffres = (v) => String(v ?? '').replace(/\D/g, '');

/** « 12 rue des Lilas 75011 Paris » depuis l'adresse d'établissement INSEE. */
function adresseOfficielle(a = {}) {
  const voie = [a.numeroVoieEtablissement, a.typeVoieEtablissement, a.libelleVoieEtablissement].filter(Boolean).join(' ').trim();
  const ville = [a.codePostalEtablissement, a.libelleCommuneEtablissement].filter(Boolean).join(' ').trim();
  return [voie, ville].filter(Boolean).join(' ').trim();
}

/** Nom et état de l'unité légale (période la plus récente d'abord). */
function infosLegales(unite = {}) {
  const p = (unite.periodesUniteLegale || [])[0] || {};
  return {
    etat: p.etatAdministratifUniteLegale || unite.etatAdministratifUniteLegale || null,
    denomination: p.denominationUniteLegale || p.nomUniteLegale || unite.denominationUniteLegale || unite.nomUniteLegale || null,
  };
}

/**
 * L'adresse du document contredit-elle celle du registre ? Code postal
 * différent, commune absente du texte, ou aucun mot de la voie en commun.
 */
function adresseDifferente(extraite, a = {}) {
  if (!extraite || !a || !Object.keys(a).length) return false;
  const norm = cleNom(extraite);
  if (!norm) return false;
  const postal = String(a.codePostalEtablissement || '').trim();
  const postalExtrait = (/\b\d{5}\b/.exec(extraite) || [])[0];
  if (postal && postalExtrait && postal !== postalExtrait) return true;
  const ville = cleNom(a.libelleCommuneEtablissement);
  if (ville && !norm.includes(ville)) return true;
  const mots = cleNom([a.numeroVoieEtablissement, a.typeVoieEtablissement, a.libelleVoieEtablissement].filter(Boolean).join(' '))
    .split(' ').filter((m) => m.length > 2 && !/^\d+$/.test(m));
  return mots.length > 0 && !mots.some((m) => norm.includes(m));
}

async function interroger(client, chemin) {
  try {
    const rep = await client.get(`${URL_BASE}${chemin}`, { timeout: DELAI_MS, validateStatus: (s) => s === 200 || s === 404 });
    return rep.status === 404 ? { introuvable: true } : { donnees: rep.data };
  } catch (err) {
    console.warn(`[registre] ${chemin} : ${err.message}`);
    return null; // doute : aucune alerte
  }
}

/**
 * Contrôle un ensemble de documents analysés.
 * @param {Array<{ id, nom?, nature, donnees }>} enregs
 * @param {{ cleApi?: string, client?: { get } }} [opts]
 * @returns {Promise<Array>} alertes (voir alerteFabrique)
 * @throws si la clé INSEE est absente (le recalcul le journalise et passe)
 */
async function controler(enregs, { cleApi = process.env.INSEE_API_KEY, client = null } = {}) {
  if (!cleApi) throw new Error('INSEE_API_KEY absente de l\'environnement du serveur.');
  const reseau = client || {
    get: (url, opts) => http.get(url, { ...opts, headers: { 'X-INSEE-Api-Key-Integration': cleApi, Accept: 'application/json' } }),
  };
  const alertes = [];
  const memoSiret = new Map();
  const memoSiren = new Map();

  for (const e of enregs) {
    const d = e.donnees || {};
    const siret = chiffres(d.etablissement);
    const siren = chiffres(d.identifiant) || (siret.length === 14 ? siret.slice(0, 9) : '');
    const nomDoc = e.nom || `document n° ${e.id}`;
    let adresse = {};
    let legal = { etat: null, denomination: null };

    if (siret.length === 14) {
      if (!memoSiret.has(siret)) memoSiret.set(siret, await interroger(reseau, `/siret/${siret}`));
      const r = memoSiret.get(siret);
      if (!r) continue;
      if (r.introuvable) {
        alertes.push(alerte('registre_introuvable', 'critique',
          `Le SIRET ${siret} de « ${nomDoc} » est introuvable au registre officiel (faux établissement ou numéro inventé).`,
          [e.id], 'etablissement', siret, null, 'Le numéro n\'existe pas : traiter le document comme suspect.'));
        continue;
      }
      const etab = r.donnees?.etablissement || {};
      adresse = etab.adresseEtablissement || {};
      if ((etab.periodesEtablissement || [])[0]?.etatAdministratifEtablissement === 'F') {
        alertes.push(alerte('registre_ferme', 'haute',
          `Le SIRET ${siret} de « ${nomDoc} » correspond à un établissement fermé.`,
          [e.id], 'etablissement', siret, null, 'Document potentiellement antidaté ou falsifié.'));
      }
      legal = infosLegales(etab.uniteLegale);
    } else if (siren.length === 9) {
      if (!memoSiren.has(siren)) memoSiren.set(siren, await interroger(reseau, `/siren/${siren}`));
      const r = memoSiren.get(siren);
      if (!r) continue;
      if (r.introuvable) {
        alertes.push(alerte('registre_introuvable', 'critique',
          `Le SIREN ${siren} de « ${nomDoc} » est introuvable au registre officiel.`,
          [e.id], 'identifiant', siren, null, 'L\'entreprise n\'existe pas ou le numéro est factice.'));
        continue;
      }
      legal = infosLegales(r.donnees?.uniteLegale);
    } else {
      continue;
    }

    if (legal.etat === 'C') {
      alertes.push(alerte('registre_ferme', 'haute',
        `L'entreprise de « ${nomDoc} » est déclarée cessée au registre officiel.`,
        [e.id], siret ? 'etablissement' : 'identifiant', siret || siren, null,
        'Vérifier la validité d\'un document émis par une entreprise inactive.'));
    }
    if (legal.denomination && d.emetteur_nom) {
      const officiel = cleNom(legal.denomination);
      const lu = cleNom(d.emetteur_nom);
      if (officiel && lu && !lu.includes(officiel) && !officiel.includes(lu)) {
        alertes.push(alerte('nom_incoherent', 'moyenne',
          `Le nom « ${d.emetteur_nom} » de « ${nomDoc} » diffère du nom officiel « ${legal.denomination} ».`,
          [e.id], 'emetteur_nom', d.emetteur_nom, legal.denomination,
          'Possible usurpation d\'identité, ou simple erreur de nom.'));
      }
    }
    if (adresseDifferente(d.emetteur_adresse, adresse)) {
      alertes.push(alerte('adresse_incoherente', 'moyenne',
        `L'adresse « ${d.emetteur_adresse} » de « ${nomDoc} » diffère de l'adresse officielle « ${adresseOfficielle(adresse) || 'indisponible'} ».`,
        [e.id], 'emetteur_adresse', d.emetteur_adresse, adresseOfficielle(adresse),
        'Vérifier la cohérence de l\'établissement émetteur.'));
    }
  }
  return alertes;
}

module.exports = { controler, adresseDifferente, adresseOfficielle, infosLegales, http };
