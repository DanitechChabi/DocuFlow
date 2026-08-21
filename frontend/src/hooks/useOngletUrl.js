import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Onglet actif porté par l'URL plutôt que par l'état local.
 *
 * CE QUI NE MARCHAIT PAS
 *
 * Les deux portails d'administration gardaient leur onglet dans un `useState`.
 * Trois conséquences, toutes vécues par l'utilisateur :
 *
 *   • F5 ramenait au premier onglet. Un administrateur en train de configurer
 *     les réglages rechargeait la page et se retrouvait sur la liste des
 *     utilisateurs, sans comprendre pourquoi.
 *   • L'adresse n'était pas partageable. « Va voir dans Administration, onglet
 *     Métadonnées » ne peut pas se transmettre par un lien : il faut décrire le
 *     chemin en mots, et l'autre doit le refaire à la main.
 *   • Le bouton Retour du navigateur sautait par-dessus les onglets. Après avoir
 *     parcouru quatre panneaux, Retour ne revenait pas au panneau précédent mais
 *     quittait la page entière — geste presque toujours involontaire, et qui fait
 *     perdre le travail de saisie en cours.
 *
 * POURQUOI `?onglet=` ET NON UNE SOUS-ROUTE
 *
 * Une sous-route (/admin-portal/reglages) serait plus canonique, mais imposerait
 * de découper deux pages de 550 et 1380 lignes en autant de composants montés
 * séparément — donc de rejouer leurs chargements de données à chaque changement
 * d'onglet, alors qu'ils partagent aujourd'hui un état commun. Le paramètre de
 * requête obtient les trois bénéfices ci-dessus sans toucher à la structure.
 *
 * REMPLACER PLUTÔT QU'EMPILER, POUR LE PREMIER RENDU SEULEMENT
 *
 * Quand l'URL ne porte pas encore d'onglet, on y inscrit le défaut avec
 * `replace` : sans cela, la simple arrivée sur la page créerait une entrée
 * d'historique en double, et le premier Retour ne ferait rien de visible. Les
 * changements d'onglet suivants, eux, empilent — c'est précisément ce qui rend le
 * bouton Retour utile.
 *
 * @param {string[]} onglets  Identifiants admis, dans l'ordre d'affichage.
 * @param {string}   cle      Nom du paramètre d'URL.
 */
export function useOngletUrl(onglets, cle = 'onglet') {
  const [params, setParams] = useSearchParams();

  const defaut = onglets[0];
  const brut = params.get(cle);

  // Un identifiant inconnu — onglet renommé depuis, lien tronqué, URL bricolée —
  // retombe sur le défaut au lieu de n'afficher aucun panneau. Une page
  // d'administration vide se lit comme une panne, alors que seule l'adresse est
  // fautive.
  const actif = useMemo(
    () => (brut && onglets.includes(brut) ? brut : defaut),
    [brut, onglets, defaut]
  );

  const changer = useCallback(
    (id) => {
      if (!onglets.includes(id)) return;
      setParams(
        (precedents) => {
          const suivants = new URLSearchParams(precedents);
          // Le défaut n'est pas écrit dans l'URL : /admin-portal reste une adresse
          // propre, et le lien qu'on copie ne porte de paramètre que lorsqu'il
          // désigne réellement autre chose que l'entrée normale de la page.
          if (id === defaut) suivants.delete(cle);
          else suivants.set(cle, id);
          return suivants;
        },
        // Empiler : c'est ce qui permet au bouton Retour de traverser les onglets.
        { replace: false }
      );
    },
    [onglets, defaut, cle, setParams]
  );

  return [actif, changer];
}

export default useOngletUrl;
