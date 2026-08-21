import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useTitrePage } from '../hooks/useTitrePage';

/**
 * En-tête de page : où l'utilisateur se trouve, d'où il vient, ce qu'il peut y faire.
 *
 * POURQUOI CE COMPOSANT
 *
 * Les onze pages de l'application déclaraient chacune leur propre en-tête, avec
 * quatre tailles de titre différentes (text-xl, text-2xl, text-3xl, text-4xl) et
 * `font-black` partout. Résultat : le titre de « Journal d'audit » était plus
 * petit que celui du tableau de bord sans que rien ne le justifie, et comme tout
 * était en graisse maximale, plus rien ne ressortait. La hiérarchie ne se lisait
 * plus, et un utilisateur arrivant sur une page par un lien ne savait pas à quel
 * niveau de l'application il venait d'atterrir.
 *
 * Le composant impose donc une seule forme : fil d'Ariane, titre, sous-titre,
 * actions. Les pages décrivent leur contenu, pas leur mise en forme.
 *
 * LE FIL D'ARIANE N'EST PAS DÉCORATIF
 *
 * Il répond à la question « comment je remonte ? ». Sans lui, la seule issue
 * depuis un panneau d'administration est le bouton Retour du navigateur — qui
 * ramène à la page précédente, pas au niveau supérieur, et ce n'est pas la même
 * chose. Chaque segment sauf le dernier est un lien réel : le dernier est la
 * page courante, et un lien vers soi-même n'apprend rien à personne.
 *
 * LE TITRE DE L'ONGLET SUIT LE TITRE DE LA PAGE
 *
 * Sans cela, dix onglets DocuFlow ouverts portaient tous « <nom du site> —
 * Plateforme de gestion documentaire » et étaient donc strictement indiscernables
 * dans la barre de tâches.
 *
 * La composition du titre est déléguée à utils/titreDocument, et la mécanique
 * d'annonce au hook useTitrePage — que les écrans publics, dépourvus d'en-tête
 * de page, appellent directement. Ce composant a longtemps écrit
 * `document.title` lui-même, en relisant la valeur en place pour y retrouver le
 * nom du site : deux écrivains sans arbitre, dont l'ordre d'exécution — enfant
 * avant parent — faisait gagner SettingsContext. Le titre de page était donc
 * écrasé au montage et n'apparaissait jamais. Voir l'en-tête de
 * utils/titreDocument pour le détail.
 */
const PageHeader = ({
  title,
  subtitle,
  icon: Icon,
  breadcrumb = [],
  actions,
  // Titre d'onglet distinct quand le titre affiché est trop long ou contextuel
  // (« Demande n° 41 — Société X » tient mal dans un onglet).
  documentTitle,
}) => {
  useTitrePage(documentTitle || title);

  return (
    <header className="mb-6">
      {breadcrumb.length > 0 && (
        <nav aria-label="Fil d'Ariane" className="mb-2">
          <ol className="flex items-center gap-1 flex-wrap text-[13px]">
            {breadcrumb.map((segment, i) => {
              const dernier = i === breadcrumb.length - 1;
              return (
                <li key={`${segment.to || segment.label}-${i}`} className="flex items-center gap-1">
                  {i > 0 && (
                    <ChevronRight size={13} className="text-slate-300 flex-shrink-0" aria-hidden="true" />
                  )}
                  {dernier || !segment.to ? (
                    // aria-current annonce la position aux lecteurs d'écran : sans
                    // lui, le fil se lit comme une liste de liens dont un seul,
                    // inexplicablement, ne réagit pas.
                    <span className="text-slate-500 font-medium" aria-current={dernier ? 'page' : undefined}>
                      {segment.label}
                    </span>
                  ) : (
                    <Link
                      to={segment.to}
                      className="text-slate-500 hover:text-docuflow-secondary font-medium rounded transition-colors"
                    >
                      {segment.label}
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2">
            {Icon && <Icon size={22} className="text-docuflow-secondary flex-shrink-0" aria-hidden="true" />}
            <span className="truncate">{title}</span>
          </h1>
          {subtitle && (
            <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>
        )}
      </div>
    </header>
  );
};

export default PageHeader;
