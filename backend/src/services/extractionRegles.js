// ============================================================================
// extractionRegles — lire un document comptable ou administratif SANS modèle.
//
// Rôle : produire, du texte d'un document (couche texte ou OCR), les champs
// dont le contrôle de conformité a besoin — nature (facture, devis,
// attestation), émetteur, destinataire, montants HT / TVA / TTC, dates,
// numéro, identifiants d'entreprise. C'est le repli quand aucun modèle de
// langage n'est configuré, et le filet quand il échoue ; avec un modèle, les
// deux se complètent (analyseService fusionne).
//
// Tout est PUR : pas de base, pas de réseau — éprouvé directement par les tests.
// ============================================================================
const { normaliser, trouverDates } = require('./indexSuggestionService');
const { NATURES } = require('../config/conformite');

const LONGUEUR_ANALYSEE = 20000;
const FORMES_SOCIALES = 'SARL|SA|SAS|SASU|GIE|SCI|SNC|ETS|EURL|SUARL|ONG';

/** Chiffres seuls d'une chaîne. */
const chiffres = (v) => String(v ?? '').replace(/\D/g, '');

/**
 * Montant lisible → nombre. Accepte « 2 891 000 », « 1.500,00 », « 1,500.50 »,
 * « 1500,5 » ; les espaces (insécables compris) et apostrophes sont des
 * séparateurs de milliers. Un seul séparateur suivi de 3 chiffres est un
 * séparateur de milliers (« 1.500 » = 1500), suivi de 1 ou 2 chiffres une
 * décimale. null si rien d'exploitable.
 */
function parseMontant(brut) {
  if (brut === null || brut === undefined) return null;
  if (typeof brut === 'number') return Number.isFinite(brut) ? brut : null;
  let s = String(brut).replace(/[\s  ']/g, '').replace(/[^\d.,-]/g, '');
  if (!/\d/.test(s)) return null;
  const negatif = s.startsWith('-');
  s = s.replace(/-/g, '');
  const point = s.lastIndexOf('.');
  const virgule = s.lastIndexOf(',');
  let decimal = null;
  if (point > -1 && virgule > -1) decimal = point > virgule ? '.' : ',';
  else if (virgule > -1) decimal = s.indexOf(',') === virgule && /,\d{1,2}$/.test(s) ? ',' : null;
  else if (point > -1) decimal = s.indexOf('.') === point && /\.\d{1,2}$/.test(s) ? '.' : null;
  let entier = s;
  let fraction = '';
  if (decimal) {
    const i = s.lastIndexOf(decimal);
    entier = s.slice(0, i);
    fraction = s.slice(i + 1);
  }
  entier = entier.replace(/[.,]/g, '');
  const n = Number(`${entier || '0'}${fraction ? `.${fraction}` : ''}`);
  if (!Number.isFinite(n)) return null;
  return negatif ? -n : n;
}

/** Devise d'après le texte : FCFA / XOF, EUR, USD ; défaut FCFA. */
function detecterDevise(texte) {
  if (/\b(?:FCFA|F\s?CFA|XOF|XAF)\b/i.test(texte)) return 'FCFA';
  if (/€|\bEUR\b|\beuros?\b/i.test(texte)) return 'EUR';
  if (/\$|\bUSD\b|\bdollars?\b/i.test(texte)) return 'USD';
  return 'FCFA';
}

const NOMBRE = '(\\d[\\d\\s\\u00a0\\u202f.,]*\\d|\\d)';

/** Premier montant derrière un des libellés ; ignore un pourcentage (« TVA 18 % »). */
function montantApres(texte, libelle) {
  const re = new RegExp(`(?:${libelle})\\s*(?:\\(?\\s*\\d+(?:[.,]\\d+)?\\s*%\\s*\\)?)?\\s*[:=]?\\s*${NOMBRE}`, 'gi');
  let m;
  while ((m = re.exec(texte))) {
    const suite = texte.slice(re.lastIndex, re.lastIndex + 4);
    if (/^\s*%/.test(suite)) continue;
    const n = parseMontant(m[1]);
    if (n !== null) return n;
  }
  return null;
}

/** Première valeur derrière un libellé, sur la même ligne. */
function valeurApres(texte, libelle, { max = 80, separateur = true } = {}) {
  // `separateur: false` : « valable jusqu'au 31/12/2025 » n'a pas de « : ».
  const re = new RegExp(`(?:${libelle})\\s*${separateur ? '[:=]\\s*' : '[:=]?\\s*'}([^\\n]{2,${max}})`, 'i');
  const m = re.exec(texte);
  return m ? m[1].trim() : null;
}

/** Nettoie un nom lu derrière un libellé : coupe aux identifiants et séparateurs. */
function nettoyerNom(valeur) {
  if (!valeur) return null;
  const coupe = valeur.split(/\s*(?:[,;|]|\s-\s|\bIFU\b|\bSIREN\b|\bSIRET\b|\bRCCM\b|\bN[°o]\b)/i)[0]
    .replace(/[.:]+$/, '').trim();
  return coupe.length >= 2 ? coupe : null;
}

function isoDansValeur(valeur) {
  if (!valeur) return null;
  const [d] = trouverDates(valeur, normaliser(valeur));
  return d ? d.iso : null;
}

/** Nature du document : facture | devis | attestation | autre, avec une confiance. */
function classerNature(texte) {
  const debut = texte.slice(0, 2500);
  const norm = normaliser(debut);
  const lignes = debut.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 4).map(normaliser).join(' ');
  const compte = (re, s = norm) => (s.match(re) || []).length;
  const score = {
    devis: compte(/\bdevis\b|\bproforma\b|\bpro forma\b/g) * 2 + (/\bdevis\b|\bproforma\b/.test(lignes) ? 5 : 0),
    facture: compte(/\bfacture\b/g) * 2 + compte(/\bnet a payer\b|\bmontant ttc\b/g) + (/\bfacture\b/.test(lignes) ? 5 : 0),
    attestation: compte(/\battestation\b|\bcertificat\b/g) * 2 + (/\battestation\b|\bcertificat\b/.test(lignes) ? 5 : 0),
  };
  // « Facture proforma » est un devis.
  if (/\bfacture\s+pro\s?forma\b/.test(norm)) { score.devis += 6; score.facture = Math.max(0, score.facture - 4); }
  // « Demande d'attestation », « demande de certificat » : une demande, pas
  // une attestation ; de même « réclamation sur facture », « relance de facture ».
  if (/\bdemande d.?(?:une\s+)?(?:attestation|certificat)\b/.test(lignes)) score.attestation = 0;
  if (/\b(?:reclamation|relance|contestation)\b[^.]{0,30}\bfacture\b/.test(lignes)) score.facture = 0;
  const [nature, valeur] = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  if (valeur < 2) return { nature: 'autre', confiance: 0.3 };
  return { nature, confiance: Math.min(0.9, 0.5 + valeur * 0.05) };
}

/**
 * Identifiants d'entreprise selon le référentiel du pays.
 * `declare` conserve ce qui est écrit dans le document même s'il est mal
 * formé — c'est ce que le contrôle de format examine.
 */
function lireIdentifiants(texte, ref) {
  const sortie = { identifiant: null, identifiant_declare: null, etablissement: null, etablissement_declare: null };
  const lire = (def) => {
    if (!def) return null;
    const re = new RegExp(`${def.motif.source}\\s*(?:n[°o]\\.?\\s*)?[:=]?\\s*([\\d][\\d\\s.\\-]{5,24})`, 'i');
    const m = re.exec(texte);
    return m ? chiffres(m[1]) : null;
  };
  const principal = lire(ref.principal);
  const etab = lire(ref.etablissement);
  if (principal) {
    sortie.identifiant_declare = principal;
    if (principal.length === ref.principal.longueur) sortie.identifiant = principal;
  }
  if (etab) {
    sortie.etablissement_declare = etab;
    if (etab.length === ref.etablissement.longueur) sortie.etablissement = etab;
  }
  // SIREN absent mais SIRET valide : le SIREN en est le début.
  if (!sortie.identifiant && sortie.etablissement && ref.principal) {
    sortie.identifiant = sortie.etablissement.slice(0, ref.principal.longueur);
  }
  return sortie;
}

function lireParties(texte) {
  const libellesEmetteur = '(?:fournisseur|[ée]metteur|[ée]mis\\s+par|vendeur|prestataire|raison\\s+sociale|soci[ée]t[ée]|entreprise|soumissionnaire|demandeur|cocontractant)';
  const libellesDestinataire = '(?:client|destinataire|factur[ée]e?\\s+[àa]|adress[ée]e?\\s+[àa]|acheteur|donneur\\s+d[\'’]ordre|b[ée]n[ée]ficiaire)';
  let emetteur = nettoyerNom(valeurApres(texte, libellesEmetteur));
  if (!emetteur) {
    // Pas de libellé : une ligne d'en-tête qui porte une forme sociale. Une
    // ligne « Client : X SARL » ou « Bénéficiaire : X » désigne le
    // DESTINATAIRE : elle est écartée ; un autre libellé court est retiré.
    const reDest = new RegExp(`^\\s*${libellesDestinataire}\\s*:`, 'i');
    const reForme = new RegExp(`\\b(?:${FORMES_SOCIALES})\\b`);
    for (const ligne of texte.split(/\r?\n/).slice(0, 8)) {
      if (!reForme.test(ligne) || reDest.test(ligne)) continue;
      const sansLibelle = ligne.replace(/^\s*[^:\n]{1,30}:\s*/, '');
      const m = new RegExp(`^\\s*(.{2,70}?\\b(?:${FORMES_SOCIALES})\\b)`).exec(sansLibelle);
      if (m) { emetteur = nettoyerNom(m[1]); break; }
    }
  }
  const destinataire = nettoyerNom(valeurApres(texte, libellesDestinataire));
  const adresseE = valeurApres(texte, '(?:adresse\\s+(?:de\\s+l[\'’][ée]metteur|du\\s+fournisseur|du\\s+si[èe]ge)|si[èe]ge\\s+social)', { max: 150 });
  const adresseD = valeurApres(texte, '(?:adresse\\s+(?:du\\s+client|du\\s+destinataire|de\\s+facturation))', { max: 150 });
  return { emetteur_nom: emetteur, emetteur_adresse: adresseE, destinataire_nom: destinataire, destinataire_adresse: adresseD };
}

function lireDates(texte, norm) {
  const libEcheance = '[ée]ch[ée]ance|valable\\s+jusqu[\'’]?\\s*au|valide\\s+jusqu[\'’]?\\s*au|date\\s+(?:de\\s+)?validit[ée]|date\\s+(?:d[\'’])?expiration|date\\s+limite|expire\\s+le|fin\\s+de\\s+validit[ée]|validit[ée]';
  const libEmission = 'date\\s+(?:de\\s+(?:la\\s+)?)?(?:facture|facturation|devis|d[\'’]?[ée]mission|[ée]mission|du\\s+document|de\\s+d[ée]livrance|de\\s+signature)|[ée]mis(?:e)?\\s+le|[ée]tabli(?:e)?\\s+le';
  let echeance = null;
  const vEch = valeurApres(texte, libEcheance, { max: 40, separateur: false });
  echeance = isoDansValeur(vEch);
  let emission = isoDansValeur(valeurApres(texte, libEmission, { max: 40 }));
  if (!emission) {
    const fait = /fait\s+(?:[àa]\s+[^\n,]{1,40},?\s*)?le\s+([^\n]{6,40})/i.exec(texte);
    emission = fait ? isoDansValeur(fait[1]) : null;
  }
  if (!emission) {
    // Première date du texte qui n'est pas celle de l'échéance.
    const toutes = trouverDates(texte, norm);
    const premiere = toutes.find((d) => d.iso !== echeance);
    emission = premiere ? premiere.iso : null;
  }
  return { date_emission: emission, date_echeance: echeance };
}

function lireNumero(texte) {
  const m = /(?:n[°o]\s*(?:de\s+)?(?:facture|devis|attestation|pi[èe]ce|document)|(?:facture|devis|attestation)\s+n[°o]|r[ée]f[ée]rence)\s*[:=]?\s*(?=[A-Z0-9/\-._]*\d)([A-Z0-9][A-Z0-9/\-._]{1,30})/i.exec(texte);
  return m ? m[1].replace(/[.,;:]+$/, '') : null;
}

/**
 * Analyse un texte.
 * @param {string} brut
 * @param {{ referentiel: object }} ctx  référentiel d'identification (config/conformite)
 * @returns {{ nature, confiance, donnees }}  donnees : voir migration 030
 */
function extraireParRegles(brut, { referentiel } = {}) {
  const texte = String(brut || '').slice(0, LONGUEUR_ANALYSEE);
  const norm = normaliser(texte);
  const ref = referentiel || { principal: null, etablissement: null };
  const { nature, confiance } = classerNature(texte);
  const ht = montantApres(texte, 'montant\\s*(?:net\\s*)?h\\.?\\s?t\\.?(?:\\s*total)?|total\\s*h\\.?\\s?t\\.?|sous[-\\s]?total\\s*h\\.?\\s?t\\.?|(?:montant|total)\\s*hors\\s*taxes?|prix\\s*h\\.?\\s?t\\.?');
  const tva = montantApres(texte, '(?:montant\\s*(?:de\\s*la\\s*)?)?t\\.?v\\.?a\\.?');
  let ttc = montantApres(texte, 'montant\\s*(?:total\\s*)?t\\.?t\\.?c\\.?|total\\s*t\\.?t\\.?c\\.?|net\\s*[àa]\\s*payer|total\\s*toutes\\s*taxes\\s*comprises|prix\\s*t\\.?t\\.?c\\.?');
  // TTC absent mais HT et TVA lus : il s'en déduit.
  if (ttc === null && ht !== null && tva !== null) ttc = Math.round((ht + tva) * 100) / 100;
  const montants = { montant_ht: ht, montant_tva: tva, montant_ttc: ttc };
  const aDesMontants = Object.values(montants).some((v) => v !== null);
  return {
    nature,
    confiance,
    donnees: {
      ...lireIdentifiants(texte, ref),
      ...lireParties(texte),
      ...montants,
      devise: aDesMontants ? detecterDevise(texte) : null,
      ...lireDates(texte, norm),
      numero_document: lireNumero(texte),
    },
  };
}

module.exports = { extraireParRegles, parseMontant, detecterDevise, classerNature, chiffres, NATURES };
