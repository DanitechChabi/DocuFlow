import React, { useState, useEffect, useRef } from 'react';
import { FileText, Image as ImageIcon, FileSpreadsheet, FileArchive, File, Maximize2, Download, X, Loader2 } from 'lucide-react';

/**
 * Aperçu de document — vignette et vue plein écran.
 *
 * Deux contraintes ont dicté cette implémentation.
 *
 * 1. MONTAGE PARESSEUX OBLIGATOIRE. Une vue dynamique regroupe couramment
 *    plusieurs centaines de documents. Monter une <iframe> PDF par fiche
 *    instancie autant de lecteurs PDF dans le navigateur : l'onglet consomme
 *    des gigaoctets et se fige. L'observateur d'intersection ne monte donc
 *    l'aperçu que lorsque la vignette entre réellement dans le champ de vision,
 *    et le démonte lorsqu'elle en sort.
 *
 * 2. LES URL VIENNENT DU SERVEUR. `apercu_url` est calculée par le backend via
 *    storage.fileUrl : relative en mode bureau (le port change à chaque
 *    lancement), absolue en mode hébergé. Reconstruire l'URL ici casserait l'un
 *    des deux modes — voir backend/src/helpers/publicUrl.js.
 */

const TYPES_IMAGE = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/avif', 'image/svg+xml'];

/**
 * Extension en minuscules, tolérante à l'absence de nom.
 *
 * `null` est ici le cas ORDINAIRE, pas l'exception : un document non numérisé
 * traverse le LEFT JOIN sans correspondance, donc `original_name` arrive à null.
 * Un paramètre par défaut (`nom = ''`) ne couvre pas ce cas — il ne se déclenche
 * que sur `undefined` — et `null.split('.')` fait alors tomber toute la page :
 * une seule fiche sans fichier suffisait à vider la vue dynamique.
 */
function extension(nom) {
  return String(nom || '').split('.').pop().toLowerCase();
}

/** Icône et libellé de repli, quand le format ne se prévisualise pas. */
function descriptionFormat(mime, nom) {
  const ext = extension(nom);
  if (mime === 'application/pdf' || ext === 'pdf') return { Icone: FileText, libelle: 'PDF' };
  if (TYPES_IMAGE.includes(mime)) return { Icone: ImageIcon, libelle: 'Image' };
  if (/sheet|excel|csv/.test(mime || '') || ['xls', 'xlsx', 'csv'].includes(ext)) return { Icone: FileSpreadsheet, libelle: 'Tableur' };
  if (/zip|compressed|tar|rar/.test(mime || '') || ['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return { Icone: FileArchive, libelle: 'Archive' };
  if (/word|document/.test(mime || '') || ['doc', 'docx', 'odt'].includes(ext)) return { Icone: FileText, libelle: 'Document' };
  if (/^text\//.test(mime || '') || ['txt', 'md', 'log'].includes(ext)) return { Icone: FileText, libelle: 'Texte' };
  return { Icone: File, libelle: ext ? ext.toUpperCase() : 'Fichier' };
}

/** Ce que l'on sait rendre visuellement, par opposition à ce qu'on illustre. */
function modeApercu(mime, nom) {
  if (mime === 'application/pdf' || extension(nom) === 'pdf') return 'pdf';
  // Le SVG est exclu du rendu <img> : un SVG hostile peut embarquer du script,
  // et ces fichiers proviennent d'un téléversement utilisateur.
  if (TYPES_IMAGE.includes(mime) && mime !== 'image/svg+xml') return 'image';
  return 'aucun';
}

/**
 * Vignette d'aperçu. Ne monte son contenu lourd qu'une fois visible.
 *
 * @param {object}   props
 * @param {string}   props.url        URL fournie par le serveur (apercu_url)
 * @param {string}   props.mimeType   Type MIME du fichier
 * @param {string}   props.nomFichier Nom d'origine, pour déduire le format si le MIME manque
 * @param {function} props.onAgrandir Ouvre la vue plein écran
 * @param {string}   props.className  Classes additionnelles
 */
export const DocumentThumbnail = ({ url, mimeType, nomFichier, onAgrandir, className = '' }) => {
  const [visible, setVisible] = useState(false);
  const [enErreur, setEnErreur] = useState(false);
  const [charge, setCharge] = useState(false);
  const conteneurRef = useRef(null);

  // Normalisé une fois : le reste du composant l'insère dans des libellés, où un
  // « Aperçu de null » serait lu tel quel par un lecteur d'écran.
  const nom = nomFichier || '';
  const mode = modeApercu(mimeType, nom);
  const { Icone, libelle } = descriptionFormat(mimeType, nom);

  useEffect(() => {
    const noeud = conteneurRef.current;
    if (!noeud) return;

    // IntersectionObserver manque sur les navigateurs anciens : on affiche alors
    // sans différer plutôt que de ne rien afficher du tout.
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }

    const observateur = new IntersectionObserver(
      ([entree]) => setVisible(entree.isIntersecting),
      // La marge anticipe le défilement : l'aperçu est prêt quand la fiche
      // arrive à l'écran, au lieu d'apparaître après coup.
      { rootMargin: '200px 0px' }
    );
    observateur.observe(noeud);
    return () => observateur.disconnect();
  }, []);

  const indisponible = !url || mode === 'aucun' || enErreur;

  return (
    <div ref={conteneurRef} className={`doc-thumb ${indisponible ? 'doc-thumb-empty' : ''} ${className}`}>
      {indisponible ? (
        <>
          <Icone size={22} />
          <span>{url ? libelle : 'Non numérisé'}</span>
        </>
      ) : (
        <>
          {!charge && (
            <span className="absolute inset-0 flex items-center justify-center text-slate-300">
              <Loader2 size={18} className="animate-spin" />
            </span>
          )}
          {visible && mode === 'image' && (
            <img
              src={url}
              alt={`Aperçu de ${nom || 'document'}`}
              loading="lazy"
              decoding="async"
              onLoad={() => setCharge(true)}
              onError={() => setEnErreur(true)}
            />
          )}
          {visible && mode === 'pdf' && (
            <iframe
              // Les paramètres masquent la barre d'outils et le panneau latéral
              // du lecteur intégré : dans une vignette de 200 px, ils occupent
              // toute la surface et cachent le document lui-même.
              src={`${url}#toolbar=0&navpanes=0&scrollbar=0&view=FitH&page=1`}
              title={`Aperçu de ${nom || 'document'}`}
              tabIndex={-1}
              onLoad={() => setCharge(true)}
              onError={() => setEnErreur(true)}
            />
          )}
          {onAgrandir && (
            <div className="doc-thumb-overlay">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onAgrandir(); }}
                className="btn btn-sm btn-secondary"
                title="Agrandir l'aperçu"
              >
                <Maximize2 size={13} /> Agrandir
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

/**
 * Aperçu plein écran. Sépare volontairement le rendu de la vignette : ici
 * l'iframe garde sa barre d'outils, puisque l'utilisateur veut lire le document.
 */
export const DocumentPreviewLightbox = ({ url, mimeType, nomFichier, titre, onClose }) => {
  const nom = nomFichier || '';
  const mode = modeApercu(mimeType, nom);
  const { Icone, libelle } = descriptionFormat(mimeType, nom);

  // Échap ferme la vue. Sans cela, la seule sortie est le bouton de fermeture —
  // et l'aperçu occupe tout l'écran, ce qui donne une impression de blocage.
  useEffect(() => {
    const surTouche = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Aperçu : ${titre || nom || 'document'}`}>
      <div className="dialog max-w-5xl h-[88vh]" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <div className="min-w-0">
            <h3 className="truncate">{titre || nom || 'Aperçu'}</h3>
            {nom && titre !== nom && (
              <p className="text-xs text-slate-400 truncate">{nom}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {url && (
              <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-secondary">
                <Download size={14} /> Télécharger
              </a>
            )}
            <button type="button" onClick={onClose} className="btn btn-sm btn-ghost btn-icon" aria-label="Fermer l'aperçu">
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="dialog-body surface-sunken flex items-center justify-center p-0">
          {mode === 'image' && (
            <img src={url} alt={`Aperçu de ${nom || 'document'}`} className="max-w-full max-h-full object-contain" />
          )}
          {mode === 'pdf' && (
            <iframe src={url} title={`Aperçu de ${nom || 'document'}`} className="w-full h-full border-0" />
          )}
          {mode === 'aucun' && (
            <div className="empty-state">
              <span className="empty-state-icon"><Icone size={22} /></span>
              <p className="font-medium text-slate-600">Aperçu indisponible pour ce format ({libelle})</p>
              <p className="text-sm">Téléchargez le fichier pour l'ouvrir dans son application.</p>
              {url && (
                <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary mt-1">
                  <Download size={15} /> Télécharger le fichier
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DocumentThumbnail;
