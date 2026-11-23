import React, { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

/** Un bandeau discret quand l'appareil perd le réseau, qui s'efface au retour. */
const BandeauConnexion = () => {
  const [enLigne, setEnLigne] = useState(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
  useEffect(() => {
    const maj = () => setEnLigne(navigator.onLine !== false);
    window.addEventListener('online', maj);
    window.addEventListener('offline', maj);
    return () => { window.removeEventListener('online', maj); window.removeEventListener('offline', maj); };
  }, []);
  if (enLigne) return null;
  return (
    <div role="status" className="bg-amber-100 text-amber-900 text-sm px-4 py-2 flex items-center justify-center gap-2 print:hidden">
      <WifiOff size={16} /> Pas de connexion : les dernières pages restent lisibles, mais rien ne peut être enregistré pour l'instant.
    </div>
  );
};

export default BandeauConnexion;
