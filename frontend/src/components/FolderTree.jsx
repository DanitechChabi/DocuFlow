import React, { useState, useMemo } from 'react';
import {
  ChevronRight, ChevronDown, Folder, FolderOpen, FolderPlus,
  Pencil, Trash2, Check, X, AlertTriangle, CornerUpLeft,
} from 'lucide-react';

/**
 * FolderTree — arborescence des dossiers documentaires.
 *
 * Le backend renvoie une liste PLATE, ordonnée en parcours d'arbre, où chaque
 * entrée porte `parent_id`, `depth`, `path` et `path_ids`. Cette forme est
 * délibérée : elle alimente directement un <select> de filtre, là où un arbre
 * imbriqué obligerait chaque appelant à l'aplatir. La hiérarchie est donc
 * reconstruite ici, une seule fois, pour l'affichage.
 *
 * Trois décisions méritent d'être expliquées.
 *
 * 1. LE DÉPLIAGE EST À ÉTAT LOCAL, ET PAR DÉFAUT REPLIÉ AU-DELÀ DU PREMIER
 *    NIVEAU. Un archiviste ouvre ce panneau pour retrouver un classement, pas
 *    pour lire deux cents lignes : tout déplier d'emblée noierait la racine.
 *
 * 2. LE DÉPLACEMENT PASSE PAR UN <select>, PAS PAR UN GLISSER-DÉPOSER. Le
 *    glissement est déjà utilisé dans les vues dynamiques pour reclasser un
 *    document ; le réemployer ici pour déplacer un DOSSIER rendrait le geste
 *    ambigu. Et une liste reste atteignable au clavier.
 *
 * 3. LA SUPPRESSION D'UN DOSSIER PEUPLÉ DEMANDE CONFIRMATION. `parent_id` est en
 *    ON DELETE SET NULL : sans confirmation, les sous-dossiers remonteraient à la
 *    racine, ce qui ressemble à une perte de classement alors qu'ils ne sont que
 *    déplacés. Le backend répond 409 dans ce cas ; on affiche le choix.
 */

/** Reconstruit la hiérarchie à partir de la liste plate. */
function construireArbre(dossiers) {
  const parId = new Map(dossiers.map((d) => [d.id, { ...d, enfants: [] }]));
  const racines = [];
  for (const noeud of parId.values()) {
    const parent = noeud.parent_id ? parId.get(noeud.parent_id) : null;
    // Un parent absent de la liste (donnée héritée incohérente) ne doit pas
    // faire disparaître le dossier : il remonte à la racine.
    if (parent) parent.enfants.push(noeud);
    else racines.push(noeud);
  }
  return racines;
}

/**
 * Une ligne de l'arbre, et ses enfants. Récursif : la profondeur est bornée à
 * dix niveaux côté backend, donc la pile ne peut pas filer.
 */
const Noeud = ({
  noeud, profondeur, deplies, onBasculer, isAdmin,
  dossierActif, onSelectionner,
  edition, setEdition, onRenommer,
  ajoutSous, setAjoutSous, onCreer,
  deplacement, setDeplacement, onDeplacer, destinations,
  suppression, setSuppression, onSupprimer,
}) => {
  const ouvert = deplies.has(noeud.id);
  const aDesEnfants = noeud.enfants.length > 0;
  const actif = String(dossierActif) === String(noeud.id);

  return (
    <li>
      <div
        className={`flex items-center gap-1 rounded-lg pr-1 group ${actif ? 'bg-[var(--df-accent-10)]' : 'hover:bg-[var(--df-surface-hover)]'}`}
        // L'indentation est calculée et non figée en classes : Tailwind ne
        // génère pas de classe pour une valeur dynamique (pl-[calc(…)] variable),
        // et dix niveaux de classes pl-* seraient à maintenir à la main.
        style={{ paddingLeft: `${profondeur * 1.15}rem` }}
      >
        {/* Le chevron garde sa place même sans enfant : sinon les noms des
            dossiers vides se décalent de leurs frères. */}
        <button
          type="button"
          onClick={() => aDesEnfants && onBasculer(noeud.id)}
          className={`btn-icon btn-sm shrink-0 ${aDesEnfants ? 'text-slate-400 hover:text-slate-700' : 'invisible'}`}
          aria-label={ouvert ? 'Replier' : 'Déplier'}
          aria-expanded={aDesEnfants ? ouvert : undefined}
          tabIndex={aDesEnfants ? 0 : -1}
        >
          {ouvert ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        {edition === noeud.id ? (
          <RenommerLigne
            valeurInitiale={noeud.name}
            onValider={(nom) => onRenommer(noeud.id, nom)}
            onAnnuler={() => setEdition(null)}
          />
        ) : (
          <>
            <button
              type="button"
              onClick={() => onSelectionner(actif ? '' : noeud.id)}
              className="flex items-center gap-2 min-w-0 flex-1 py-1.5 text-left"
              title={noeud.path || noeud.name}
            >
              {ouvert && aDesEnfants
                ? <FolderOpen size={15} className="text-docuflow-secondary shrink-0" />
                : <Folder size={15} className="text-slate-400 shrink-0" />}
              <span className={`text-sm truncate ${actif ? 'font-semibold text-docuflow-secondary' : 'text-slate-700'}`}>
                {noeud.name}
              </span>
              {noeud.orphelin && (
                <span className="badge-warn shrink-0" title="Ce dossier était rattaché à un parent introuvable ; il est affiché à la racine.">
                  <AlertTriangle size={11} /> Détaché
                </span>
              )}
              {noeud.doc_count > 0 && (
                <span className="badge-neutral shrink-0">{noeud.doc_count}</span>
              )}
            </button>

            {isAdmin && (
              // Les actions n'apparaissent qu'au survol ou au focus clavier :
              // affichées en permanence, quatre boutons par ligne sur deux cents
              // lignes transforment l'arbre en mur de commandes.
              <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
                <button type="button" onClick={() => setAjoutSous(noeud.id)}
                  className="btn-icon btn-sm btn-ghost" title="Nouveau sous-dossier">
                  <FolderPlus size={13} />
                </button>
                <button type="button" onClick={() => setEdition(noeud.id)}
                  className="btn-icon btn-sm btn-ghost" title="Renommer">
                  <Pencil size={13} />
                </button>
                <button type="button" onClick={() => setDeplacement(noeud.id)}
                  className="btn-icon btn-sm btn-ghost" title="Déplacer">
                  <CornerUpLeft size={13} />
                </button>
                <button type="button" onClick={() => setSuppression(noeud)}
                  className="btn-icon btn-sm btn-ghost text-slate-400 hover:text-[var(--df-danger)]" title="Supprimer">
                  <Trash2 size={13} />
                </button>
              </span>
            )}
          </>
        )}
      </div>

      {ajoutSous === noeud.id && (
        <div style={{ paddingLeft: `${(profondeur + 1) * 1.15 + 1.6}rem` }} className="py-1">
          <CreerLigne
            placeholder={`Sous-dossier de « ${noeud.name} »`}
            onValider={(nom) => onCreer(nom, noeud.id)}
            onAnnuler={() => setAjoutSous(null)}
          />
        </div>
      )}

      {deplacement === noeud.id && (
        <div style={{ paddingLeft: `${(profondeur + 1) * 1.15 + 1.6}rem` }} className="py-1">
          <DeplacerLigne
            noeud={noeud}
            destinations={destinations(noeud)}
            onValider={(parentId) => onDeplacer(noeud.id, parentId)}
            onAnnuler={() => setDeplacement(null)}
          />
        </div>
      )}

      {suppression?.id === noeud.id && (
        <div style={{ paddingLeft: `${(profondeur + 1) * 1.15 + 1.6}rem` }} className="py-1">
          <SupprimerLigne
            noeud={noeud}
            onValider={(recursif) => onSupprimer(noeud.id, recursif)}
            onAnnuler={() => setSuppression(null)}
          />
        </div>
      )}

      {ouvert && aDesEnfants && (
        <ul>
          {noeud.enfants.map((enfant) => (
            <Noeud
              key={enfant.id}
              noeud={enfant}
              profondeur={profondeur + 1}
              {...{
                deplies, onBasculer, isAdmin, dossierActif, onSelectionner,
                edition, setEdition, onRenommer, ajoutSous, setAjoutSous, onCreer,
                deplacement, setDeplacement, onDeplacer, destinations,
                suppression, setSuppression, onSupprimer,
              }}
            />
          ))}
        </ul>
      )}
    </li>
  );
};

/** Saisie en ligne d'un nom, à la création. */
const CreerLigne = ({ placeholder, onValider, onAnnuler }) => {
  const [nom, setNom] = useState('');
  const valider = () => { if (nom.trim()) onValider(nom.trim()); };
  return (
    <div className="flex items-center gap-1.5">
      <input
        autoFocus
        className="input-premium flex-1 !h-8 text-sm"
        placeholder={placeholder}
        value={nom}
        onChange={(e) => setNom(e.target.value)}
        // Entrée valide, Échap annule : sans cela, la seule sortie est la souris,
        // alors que l'utilisateur a les mains sur le clavier pour saisir un nom.
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); valider(); }
          if (e.key === 'Escape') onAnnuler();
        }}
      />
      <button type="button" onClick={valider} disabled={!nom.trim()}
        className="btn btn-sm btn-primary" title="Créer">
        <Check size={13} />
      </button>
      <button type="button" onClick={onAnnuler} className="btn btn-sm btn-ghost btn-icon" title="Annuler">
        <X size={13} />
      </button>
    </div>
  );
};

/** Saisie en ligne d'un nom, au renommage. */
const RenommerLigne = ({ valeurInitiale, onValider, onAnnuler }) => {
  const [nom, setNom] = useState(valeurInitiale);
  const valider = () => { if (nom.trim()) onValider(nom.trim()); };
  return (
    <div className="flex items-center gap-1.5 flex-1 py-1">
      <input
        autoFocus
        className="input-premium flex-1 !h-8 text-sm"
        value={nom}
        onChange={(e) => setNom(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); valider(); }
          if (e.key === 'Escape') onAnnuler();
        }}
      />
      <button type="button" onClick={valider} disabled={!nom.trim()}
        className="btn btn-sm btn-primary" title="Renommer">
        <Check size={13} />
      </button>
      <button type="button" onClick={onAnnuler} className="btn btn-sm btn-ghost btn-icon" title="Annuler">
        <X size={13} />
      </button>
    </div>
  );
};

/** Choix de la destination d'un déplacement. */
const DeplacerLigne = ({ noeud, destinations, onValider, onAnnuler }) => {
  const [cible, setCible] = useState('');
  return (
    <div className="flex items-center gap-1.5">
      <select
        autoFocus
        className="input-premium flex-1 !h-8 text-sm"
        value={cible}
        onChange={(e) => setCible(e.target.value)}
        aria-label={`Déplacer « ${noeud.name} » vers`}
      >
        <option value="">— Racine —</option>
        {destinations.map((d) => (
          <option key={d.id} value={d.id}>{d.path || d.name}</option>
        ))}
      </select>
      <button type="button" onClick={() => onValider(cible === '' ? null : Number(cible))}
        className="btn btn-sm btn-primary" title="Déplacer">
        <Check size={13} />
      </button>
      <button type="button" onClick={onAnnuler} className="btn btn-sm btn-ghost btn-icon" title="Annuler">
        <X size={13} />
      </button>
    </div>
  );
};

/**
 * Confirmation de suppression. Le texte énonce la conséquence exacte, parce
 * qu'elle n'est pas devinable : les documents sont DÉCLASSÉS, pas supprimés.
 */
const SupprimerLigne = ({ noeud, onValider, onAnnuler }) => {
  const nbEnfants = noeud.enfants.length;
  return (
    <div className="surface-sunken rounded-lg p-2.5 space-y-2 border border-[var(--df-border)]">
      <p className="text-xs text-slate-600">
        Supprimer « <span className="font-semibold">{noeud.name}</span> » ?
        {noeud.doc_count > 0 && (
          <> Ses <span className="font-semibold">{noeud.doc_count}</span> document(s) ne seront pas supprimés,
          mais déclassés (sans dossier).</>
        )}
      </p>
      {nbEnfants > 0 && (
        <p className="text-xs text-[var(--df-warn)] flex items-start gap-1.5">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          Ce dossier contient {nbEnfants} sous-dossier(s).
        </p>
      )}
      <div className="flex items-center gap-1.5 flex-wrap">
        {nbEnfants > 0 ? (
          <>
            <button type="button" onClick={() => onValider(false)} className="btn btn-sm btn-secondary">
              Remonter les sous-dossiers à la racine
            </button>
            <button type="button" onClick={() => onValider(true)} className="btn btn-sm btn-danger">
              Supprimer toute la branche
            </button>
          </>
        ) : (
          <button type="button" onClick={() => onValider(false)} className="btn btn-sm btn-danger">
            <Trash2 size={13} /> Supprimer
          </button>
        )}
        <button type="button" onClick={onAnnuler} className="btn btn-sm btn-ghost">Annuler</button>
      </div>
    </div>
  );
};

/**
 * @param {object}   props
 * @param {Array}    props.dossiers      Liste plate renvoyée par getFolders()
 * @param {boolean}  props.isAdmin       Autorise création / renommage / déplacement / suppression
 * @param {string}   props.dossierActif  Identifiant du dossier filtré (ou '')
 * @param {function} props.onSelectionner Change le filtre courant
 * @param {function} props.onCreer       (nom, parentId) => Promise
 * @param {function} props.onRenommer    (id, nom) => Promise
 * @param {function} props.onDeplacer    (id, parentId) => Promise
 * @param {function} props.onSupprimer   (id, recursif) => Promise
 */
const FolderTree = ({
  dossiers = [], isAdmin = false, dossierActif = '',
  onSelectionner, onCreer, onRenommer, onDeplacer, onSupprimer,
}) => {
  const arbre = useMemo(() => construireArbre(dossiers), [dossiers]);

  // Le premier niveau est déplié d'emblée : un panneau entièrement replié
  // n'apprend rien sur le classement. Les niveaux profonds restent fermés.
  const [deplies, setDeplies] = useState(() => new Set());
  const [initialise, setInitialise] = useState(false);
  if (!initialise && dossiers.length) {
    setDeplies(new Set(dossiers.filter((d) => d.depth === 0).map((d) => d.id)));
    setInitialise(true);
  }

  const [edition, setEdition] = useState(null);
  const [ajoutSous, setAjoutSous] = useState(null);
  const [ajoutRacine, setAjoutRacine] = useState(false);
  const [deplacement, setDeplacement] = useState(null);
  const [suppression, setSuppression] = useState(null);

  const basculer = (id) => setDeplies((prec) => {
    const suivant = new Set(prec);
    suivant.has(id) ? suivant.delete(id) : suivant.add(id);
    return suivant;
  });

  /**
   * Destinations valides pour un déplacement : tout sauf le dossier lui-même et
   * sa propre descendance. Le backend refuse déjà ces cas (un cycle détacherait
   * la branche de la racine), mais les proposer dans la liste serait offrir une
   * action vouée à l'échec.
   */
  const destinations = (noeud) => dossiers.filter((d) =>
    d.id !== noeud.id && !(d.path_ids || []).includes(noeud.id)
  );

  const apres = (promesse) => Promise.resolve(promesse).then(() => {
    setEdition(null); setAjoutSous(null); setAjoutRacine(false);
    setDeplacement(null); setSuppression(null);
  });

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onSelectionner('')}
          className={`text-xs font-medium ${dossierActif === '' ? 'text-docuflow-secondary font-semibold' : 'text-slate-500 hover:text-slate-700'}`}
        >
          Tous les dossiers
        </button>
        {isAdmin && !ajoutRacine && (
          <button type="button" onClick={() => setAjoutRacine(true)} className="btn btn-sm btn-ghost">
            <FolderPlus size={13} /> Nouveau dossier
          </button>
        )}
      </div>

      {ajoutRacine && (
        <CreerLigne
          placeholder="Nom du dossier (ex. Archives 2026)"
          onValider={(nom) => apres(onCreer(nom, null))}
          onAnnuler={() => setAjoutRacine(false)}
        />
      )}

      {dossiers.length === 0 ? (
        <p className="text-xs text-slate-400 py-3 text-center">
          Aucun dossier. {isAdmin ? 'Créez-en un pour organiser vos documents.' : ''}
        </p>
      ) : (
        <ul className="max-h-80 overflow-y-auto modal-scrollbar -ml-1">
          {arbre.map((racine) => (
            <Noeud
              key={racine.id}
              noeud={racine}
              profondeur={0}
              deplies={deplies}
              onBasculer={basculer}
              isAdmin={isAdmin}
              dossierActif={dossierActif}
              onSelectionner={onSelectionner}
              edition={edition}
              setEdition={setEdition}
              onRenommer={(id, nom) => apres(onRenommer(id, nom))}
              ajoutSous={ajoutSous}
              setAjoutSous={setAjoutSous}
              onCreer={(nom, parentId) => apres(onCreer(nom, parentId)).then(() => {
                // Le parent est déplié après coup : sans cela, le sous-dossier
                // tout juste créé n'apparaît nulle part et l'action semble
                // n'avoir rien fait.
                setDeplies((prec) => new Set(prec).add(parentId));
              })}
              deplacement={deplacement}
              setDeplacement={setDeplacement}
              onDeplacer={(id, parentId) => apres(onDeplacer(id, parentId))}
              destinations={destinations}
              suppression={suppression}
              setSuppression={setSuppression}
              onSupprimer={(id, recursif) => apres(onSupprimer(id, recursif))}
            />
          ))}
        </ul>
      )}
    </div>
  );
};

export default FolderTree;
