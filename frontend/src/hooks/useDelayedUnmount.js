import { useEffect, useState } from 'react';

// Garde un composant monté le temps de son animation de sortie avant de le
// retirer du DOM. Sans ça, `{actif && <Modal/>}` démonte instantanément dès
// que `actif` repasse à false — aucune classe `animate-*-out` n'a le temps
// de jouer.
export function useDelayedUnmount(actif, duree = 200) {
  const [rendu, setRendu] = useState(actif);
  const [fermeture, setFermeture] = useState(false);

  useEffect(() => {
    let minuteur;
    if (actif) {
      setRendu(true);
      setFermeture(false);
    } else if (rendu) {
      setFermeture(true);
      minuteur = setTimeout(() => {
        setRendu(false);
        setFermeture(false);
      }, duree);
    }
    return () => clearTimeout(minuteur);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actif, duree]);

  return [rendu, fermeture];
}
