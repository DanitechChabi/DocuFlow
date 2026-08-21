import { useEffect, useRef } from 'react';
import { definirTitrePage, libererTitrePage } from '../utils/titreDocument';

/**
 * Déclare le titre de l'onglet pour la durée de vie du composant appelant.
 *
 * POURQUOI UN HOOK ET PAS SEULEMENT PageHeader
 *
 * PageHeader portait cette logique, et la portait bien — mais il ne couvrait que
 * les pages construites autour d'un en-tête aligné à gauche. Or les écrans
 * publics (connexion, inscription, activation de licence, page introuvable) sont
 * des cartes centrées : y insérer un en-tête de page pour obtenir un titre
 * d'onglet reviendrait à modifier une mise en page pour un effet qui ne s'y voit
 * pas.
 *
 * Ces écrans restaient donc muets, et c'est précisément là que ça coûte le plus
 * cher. Un utilisateur a rarement dix tableaux de bord ouverts ; il a en revanche
 * couramment un onglet de connexion oublié parmi d'autres, et une page d'aide
 * qu'il vient d'ouvrir pour y revenir plus tard. Tous portaient le même
 * « DocuFlow — Plateforme de gestion documentaire ».
 *
 * Le hook expose donc la mécanique seule, et PageHeader n'en est plus qu'un
 * appelant parmi d'autres.
 *
 * TITRE VIDE = PAS D'ANNONCE
 *
 * Passer `null` (ou une chaîne vide) laisse le titre courant en place au lieu
 * d'imposer le nom nu du site. C'est ce qui permet d'écrire l'appel une seule
 * fois, au sommet du composant — donc sans enfreindre les règles des hooks —
 * alors même que le titre dépend d'un état pas encore chargé : pendant la
 * résolution d'une entreprise, mieux vaut le titre générique que le mot
 * « undefined » dans la barre de tâches.
 *
 * @param {string|null|undefined} titre  Titre court, sans le nom du site.
 */
export function useTitrePage(titre) {
  // Jeton d'identité de cette instance, stable pour toute sa durée de vie. Il
  // permet au démontage de ne rendre le titre que s'il est encore le nôtre :
  // pendant une navigation, deux pages coexistent brièvement, et le départ de
  // l'ancienne ne doit pas effacer l'annonce de la nouvelle.
  //
  // Initialisation paresseuse : `useRef(Symbol(...))` fabriquerait un symbole à
  // chaque rendu pour n'en garder que le premier.
  const reference = useRef(null);
  if (reference.current === null) reference.current = Symbol('titre-page');
  const jeton = reference.current;

  useEffect(() => {
    if (!titre) return undefined;
    definirTitrePage(jeton, titre);
    // Sans cette libération, la navigation vers une page qui ne déclare pas de
    // titre conserverait celui de la page précédente — un titre faux, donc pire
    // qu'un titre générique.
    return () => libererTitrePage(jeton);
  }, [titre, jeton]);
}

export default useTitrePage;
