import { useSettings } from '../../contexts/SettingsContext';

// Fond partagé des écrans d'authentification : grille + halos dérivés des
// couleurs de l'organisation. Avant cette extraction, Login suivait la
// marque mais Register/CompanyRegister avaient du bleu codé en dur — un
// visiteur changeant d'écran voyait deux chartes différentes.
const AuthBackdrop = () => {
  const settings = useSettings();
  const secondary = settings.secondary_color || '#3b82f6';
  const primary = settings.primary_color || '#0f172a';

  return (
    <>
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(${secondary}03 1px, transparent 1px), linear-gradient(90deg, ${secondary}03 1px, transparent 1px)`,
          backgroundSize: '64px 64px',
        }}
      />
      <div
        className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full blur-3xl pointer-events-none animate-float"
        style={{ backgroundColor: `${secondary}15` }}
      />
      <div
        className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full blur-3xl pointer-events-none animate-float delay-300"
        style={{ backgroundColor: `${primary}08` }}
      />
    </>
  );
};

export default AuthBackdrop;
