import React from 'react';
import { Search, ArrowRightLeft, BookOpenCheck } from 'lucide-react';
import { edition } from '../../../editions';

// ============================================================================
// Cadre des pages de connexion et d'inscription de l'AFGC : à gauche, le
// panneau aux couleurs de l'AFGC (bleu nuit, vert, jaune — celles de son
// site) ; à droite, le formulaire. Sur téléphone, le panneau se réduit à un
// bandeau au-dessus du formulaire.
// ============================================================================

const NUIT = '#091422';
const VERT = '#2C9C0A';
const JAUNE = '#F8D500';

const POINTS = [
  { icone: Search, texte: 'Demandez un dossier en tapant le nom de l\'entreprise.' },
  { icone: ArrowRightLeft, texte: 'Suivez-le : demandé, transmis, retourné.' },
  { icone: BookOpenCheck, texte: 'Retrouvez ce qui est sorti, pour qui et pourquoi.' },
];

const CadreConnexion = ({ children, enHaut = false }) => (
  <div className="min-h-screen flex flex-col lg:flex-row bg-slate-50">
    {/* Panneau de marque */}
    <aside className="relative overflow-hidden lg:w-[44%] lg:min-h-screen text-white px-6 py-6 sm:px-10 sm:py-7 lg:px-14 lg:py-12 flex flex-col"
      style={{ background: `radial-gradient(120% 90% at 0% 0%, #13263d 0%, ${NUIT} 55%, #050b14 100%)` }}>
      {/* Halo vert et jaune, discrets */}
      <div aria-hidden="true" className="absolute -right-24 -bottom-24 w-80 h-80 rounded-full opacity-25 blur-3xl" style={{ background: VERT }} />
      <div aria-hidden="true" className="absolute right-10 top-1/3 w-40 h-40 rounded-full opacity-10 blur-2xl" style={{ background: JAUNE }} />

      <div className="relative flex items-center gap-3">
        <img src={edition?.logoConnexion || '/editions/afgc/embleme-blanc.png'} alt="" className="w-11 h-11 object-contain" />
        <div className="text-[11px] sm:text-xs font-bold leading-snug text-white/90">
          L'Africaine des Garanties<br />et du Cautionnement
        </div>
      </div>

      <div className="relative mt-5 sm:mt-8 lg:mt-auto lg:mb-auto">
        <div className="text-xs font-bold" style={{ color: JAUNE }}>Archives</div>
        <h2 className="mt-2 text-[1.75rem] sm:text-4xl lg:text-5xl font-bold uppercase leading-[1.05] tracking-tight text-white">
          Vos dossiers,<br /><span style={{ color: JAUNE }}>en un clic.</span>
        </h2>
        <ul className="hidden sm:block mt-8 space-y-4 max-w-sm">
          {POINTS.map(({ icone: Icone, texte }) => (
            <li key={texte} className="flex items-start gap-3 text-sm text-white/80 leading-relaxed">
              <span className="mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${VERT}33`, color: '#7ee05a' }}>
                <Icone size={15} />
              </span>
              {texte}
            </li>
          ))}
        </ul>
      </div>

      <p className="relative hidden lg:block text-[11px] text-white/40">
        Service des archives · {new Date().getFullYear()}
      </p>
    </aside>

    {/* Formulaire */}
    <main className={`flex-1 flex items-start justify-center px-4 py-6 sm:px-8 sm:py-8 lg:py-12 ${enHaut ? 'lg:pt-[12vh]' : 'lg:items-center'}`}>
      <div className="w-full max-w-lg animate-fade-in-up">{children}</div>
    </main>
  </div>
);

export default CadreConnexion;
