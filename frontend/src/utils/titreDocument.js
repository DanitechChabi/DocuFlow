/**
 * Titre de l'onglet du navigateur : une seule autorité.
 *
 * CE QUI NE MARCHAIT PAS
 *
 * Deux composants écrivaient `document.title` sans se connaître : SettingsContext
 * y mettait « <nom du site> — Plateforme de gestion documentaire » au chargement
 * des réglages, et PageHeader tentait de préfixer le titre de la page. Le second
 * lisait la valeur laissée par le premier pour en extraire le nom du site.
 *
 * En React, les effets d'un composant enfant s'exécutent AVANT ceux de ses
 * parents. PageHeader (au fond de l'arbre) écrivait donc « Tableau de bord ·
 * DocuFlow », puis SettingsProvider (à la racine) écrasait tout avec « DocuFlow
 * — Plateforme de gestion documentaire ». Résultat : le titre de page
 * n'apparaissait jamais au montage, et la fonctionnalité entière était sans
 * effet visible — le défaut le plus coûteux de tous, puisqu'il ressemble à du
 * code qui marche.
 *
 * Le même couplage produisait une seconde anomalie. PageHeader reconstituait le
 * nom du site par `document.title.split('—')[0]`. Quand la valeur en place était
 * déjà un titre de page (« Documents · DocuFlow », sans tiret cadratin), ce
 * calcul renvoyait la chaîne entière : le titre suivant devenait « Profil ·
 * Documents · DocuFlow », puis s'allongeait à chaque navigation.
 *
 * CE QUE FAIT CE MODULE
 *
 * Il détient les deux morceaux — le nom du site et le titre de la page courante
 * — et recompose `document.title` à chaque changement de l'un ou de l'autre.
 * L'ordre dans lequel les deux écrivains se manifestent n'a plus d'importance :
 * quel que soit celui qui parle en dernier, le titre affiché reste correct.
 *
 * POURQUOI UN JETON DE PROPRIÉTÉ
 *
 * Une page qui se démonte doit retirer son titre, mais seulement s'il est encore
 * le sien. Sans cette vérification, l'ordre « la nouvelle page s'annonce, puis
 * l'ancienne se retire » effacerait un titre tout juste posé et laisserait
 * l'onglet au nom nu du site. React garantit aujourd'hui l'ordre inverse, mais
 * cette garantie n'est pas contractuelle : le jeton rend le module correct sans
 * en dépendre.
 */

const NOM_DEFAUT = 'DocuFlow';
const DESCRIPTIF = 'Plateforme de gestion documentaire';

let nomSite = NOM_DEFAUT;
let titrePage = null;
let proprietaire = null;

/**
 * « Documents · DocuFlow » sur une page identifiée, « DocuFlow — Plateforme de
 * gestion documentaire » sinon.
 *
 * Deux séparateurs, deux rôles : le point médian sépare la page du produit, le
 * tiret cadratin sépare le produit de son descriptif. Le descriptif ne suit pas
 * le titre de page — dans la largeur d'un onglet, il ne resterait plus rien du
 * nom de la page, qui est précisément l'information utile quand dix onglets sont
 * ouverts.
 */
export const composerTitre = () =>
  titrePage ? `${titrePage} · ${nomSite}` : `${nomSite} — ${DESCRIPTIF}`;

const appliquer = () => {
  // Garde pour les tests hors navigateur (Node), où `document` n'existe pas :
  // les fonctions de ce module restent alors appelables sans lever.
  if (typeof document !== 'undefined') document.title = composerTitre();
};

/** Appelé par SettingsContext quand les réglages de l'organisation arrivent. */
export const definirNomSite = (nom) => {
  nomSite = nom || NOM_DEFAUT;
  appliquer();
};

/**
 * Déclare le titre de la page affichée.
 * @param {symbol|object} jeton  Identité de l'appelant, à rendre au démontage.
 */
export const definirTitrePage = (jeton, titre) => {
  proprietaire = jeton;
  titrePage = titre || null;
  appliquer();
};

/** Retire le titre de page, à condition qu'il appartienne encore à l'appelant. */
export const libererTitrePage = (jeton) => {
  if (proprietaire !== jeton) return;
  proprietaire = null;
  titrePage = null;
  appliquer();
};

/** Remise à zéro — réservée aux tests. */
export const reinitialiserTitre = () => {
  nomSite = NOM_DEFAUT;
  titrePage = null;
  proprietaire = null;
};
