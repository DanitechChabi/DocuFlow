import { useSettings } from '../../contexts/SettingsContext';

// Badge de marque partagé par les écrans d'authentification : carré dégradé
// primaire/sombre avec halo, logo de l'organisation si disponible, sinon
// l'icône fournie. Même traitement sur connexion, inscription et création
// d'espace, pour qu'un visiteur qui passe de l'un à l'autre reste chez la
// même organisation plutôt que de retomber sur un badge rond générique bleu.
const AuthBrandMark = ({ icon: Icon, logoSrc, size = 'lg' }) => {
  const settings = useSettings();
  const primary = settings.primary_color || '#0f172a';
  const dark = settings.dark_color || '#1e293b';
  const secondary = settings.secondary_color || '#3b82f6';
  const dim = size === 'lg' ? 'w-20 h-20' : 'w-16 h-16';
  const imgDim = size === 'lg' ? 'w-16 h-16' : 'w-12 h-12';
  const iconSize = size === 'lg' ? 36 : 28;

  return (
    <div className="relative inline-flex mb-5">
      <div
        className="absolute -inset-3 rounded-full blur-xl opacity-30 animate-glow-pulse"
        style={{ background: `linear-gradient(135deg, ${secondary}, ${primary})` }}
      />
      <div
        className={`relative ${dim} rounded-2xl shadow-lg flex items-center justify-center overflow-hidden`}
        style={{ background: `linear-gradient(135deg, ${primary}, ${dark})` }}
      >
        {logoSrc ? (
          <img src={logoSrc} alt="Logo" className={`${imgDim} object-contain`} />
        ) : (
          <Icon size={iconSize} className="text-white" />
        )}
      </div>
    </div>
  );
};

export default AuthBrandMark;
