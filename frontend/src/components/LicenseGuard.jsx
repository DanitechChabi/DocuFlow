import React from 'react';
import { useLocation } from 'react-router-dom';
import { useLicense } from '../contexts/LicenseContext';
import LicenseBlockingOverlay from './LicenseBlockingOverlay';

const LicenseGuard = ({ children }) => {
  // Les DEUX hooks d'abord, sans condition au-dessus d'eux. Un `return` glissé
  // entre les deux change le nombre de hooks appelés d'un rendu à l'autre :
  // React associe alors l'état par position et lève « Rendered fewer hooks than
  // expected », c'est-à-dire l'écran « Une erreur est survenue ».
  const license = useLicense();
  const location = useLocation();

  if (!license) return <>{children}</>;

  const { allowed, loading, desktop, message } = license;

  // On ne bloque JAMAIS sur le web (SaaS)
  if (!desktop) return <>{children}</>;

  // On laisse passer si on est sur la page de licence pour permettre l'activation
  const isLicensePage = location.pathname === '/license';
  if (isLicensePage) return <>{children}</>;

  // On ne bloque pas pendant le chargement initial pour éviter le clignotement
  if (loading) return <>{children}</>;

  // Si la licence n'est pas autorisée, on affiche l'overlay de blocage
  if (!allowed) {
    return <LicenseBlockingOverlay message={message} />;
  }

  return <>{children}</>;
};

export default LicenseGuard;
