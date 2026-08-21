import React from 'react';
import { Building2, Calendar, Hash, Type, AlignLeft, CheckSquare, List, User, FileText } from 'lucide-react';
import { toneClass } from '../utils/requestOptions';

/**
 * DynamicRequestField — rendu d'un champ de demande depuis sa définition.
 *
 * POURQUOI CE COMPOSANT EXISTE
 *
 * RequestForm.jsx décrivait ses sept champs en JSX, un bloc par champ. Ajouter
 * « Numéro de TVA » pour une organisation exigeait donc de modifier ce fichier
 * et de redéployer le frontend — alors que ce vocabulaire est propre au métier de
 * chaque organisation. Les définitions viennent désormais de la base
 * (`request_field_definitions`, migration 016) et ce composant les rend.
 *
 * LE CHOIX DE L'ICÔNE SUIT LE TYPE, PAS LE NOM
 *
 * Les sept champs d'origine avaient chacun son icône, choisie à la main. Les
 * conserver aurait obligé à maintenir une table nom → icône que tout champ
 * nouvellement créé aurait manquée : il se serait affiché sans icône, visiblement
 * différent des sept autres. L'icône dérive donc du TYPE, ce qui vaut pour un
 * champ créé à l'instant comme pour les champs d'origine — au prix de deux
 * icônes changées (« nom de l'entreprise » et « année » perdent leur pictogramme
 * spécifique au profit de celui de leur type). Les deux champs les plus
 * reconnaissables gardent malgré tout le leur, par leur clé technique, qui est
 * figée par trigger et ne peut donc pas dériver.
 */

// Icône par type. `text` reçoit Type plutôt qu'aucune icône : un champ sans
// pictogramme au milieu de champs qui en portent se lit comme un défaut d'affichage.
const ICONES_TYPE = {
  text: Type,
  textarea: AlignLeft,
  number: Hash,
  date: Calendar,
  boolean: CheckSquare,
  select: List,
  multiselect: List,
  user: User,
  document: FileText,
};

// Exception assumée à la règle ci-dessus, pour les deux champs dont l'icône fait
// partie de la reconnaissance visuelle du formulaire. La clé technique d'un champ
// système est figée par trigger (migration 016) : cette table ne peut pas devenir
// obsolète par un renommage.
const ICONES_NOM = {
  nom_entreprise: Building2,
  annee: Calendar,
};

const iconePour = (field) => ICONES_NOM[field.name] || ICONES_TYPE[field.field_type] || Type;

/**
 * @param {object} field définition décorée par le backend ({ options } résolues)
 * @param {*} value valeur courante
 * @param {function} onChange (name, value) → void
 * @param {Array} users comptes de l'organisation, pour les champs de type `user`
 */
const DynamicRequestField = ({ field, value, onChange, users = [] }) => {
  const Icone = iconePour(field);
  const type = field.field_type;

  // Un champ long ou à plusieurs valeurs occupe les deux colonnes : un textarea
  // sur une demi-largeur donne une zone de saisie plus étroite que haute.
  const pleineLargeur = type === 'textarea' || type === 'multiselect'
    || field.name === 'nom_entreprise' || field.name === 'priorite';

  const label = (
    <label
      htmlFor={`champ-${field.name}`}
      className="block text-xs font-bold text-slate-500 uppercase tracking-widest ml-1"
    >
      {field.label}
      {/* L'astérisque est doublée d'un `required` sur le contrôle : seule, elle
          n'est qu'une convention typographique que rien n'impose au navigateur. */}
      {field.required && <span className="text-red-400 ml-0.5" aria-hidden="true">*</span>}
    </label>
  );

  // `aria-describedby` relie la description au contrôle : sans lui, un lecteur
  // d'écran annonce le libellé seul et la précision reste invisible pour son
  // utilisateur, alors qu'elle est précisément ce qui lève l'ambiguïté.
  const idDescription = field.description ? `aide-${field.name}` : undefined;
  const description = field.description && (
    <p id={idDescription} className="text-[11px] text-slate-400 ml-1">{field.description}</p>
  );

  const commun = {
    id: `champ-${field.name}`,
    name: field.name,
    required: field.required,
    'aria-describedby': idDescription,
    onChange: (e) => onChange(field.name, e.target.value),
  };

  let controle;
  switch (type) {
    case 'textarea':
      controle = (
        <textarea
          {...commun}
          className="input-premium min-h-[5.5rem] resize-y"
          value={value ?? ''}
          placeholder={field.placeholder || ''}
          minLength={field.min_length ?? undefined}
          maxLength={field.max_length ?? undefined}
        />
      );
      break;

    case 'number':
      controle = (
        <div className="relative">
          <Icone size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            {...commun}
            type="number"
            className="input-premium pl-12"
            value={value ?? ''}
            placeholder={field.placeholder || ''}
            // `annee` portait min/max en dur dans l'ancien formulaire. Les bornes
            // sont désormais celles de la définition ; à défaut, aucune n'est
            // imposée — inventer une plage refuserait des saisies légitimes sur
            // un champ dont on ignore la nature.
            min={field.min_length ?? undefined}
            max={field.max_length ?? undefined}
          />
        </div>
      );
      break;

    case 'date':
      controle = (
        <div className="relative">
          <Icone size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input {...commun} type="date" className="input-premium pl-12" value={value ?? ''} />
        </div>
      );
      break;

    case 'boolean':
      controle = (
        <label className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100 cursor-pointer">
          <input
            {...commun}
            type="checkbox"
            className="w-4 h-4 accent-docuflow-secondary"
            checked={value === true}
            onChange={(e) => onChange(field.name, e.target.checked)}
          />
          <span className="text-sm text-slate-600">{field.placeholder || 'Oui'}</span>
        </label>
      );
      break;

    case 'select':
      // La priorité garde ses boutons colorés : c'est le seul champ dont la
      // valeur porte un ton, et un menu déroulant ferait perdre le repère visuel
      // du degré d'urgence.
      if (field.name === 'priorite') {
        controle = (
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`champ-${field.name}`}>
            {(field.options || []).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onChange(field.name, option.value)}
                aria-pressed={value === option.value}
                className={`flex-1 min-w-[5rem] py-2.5 rounded-xl text-xs font-bold transition-all ${
                  value === option.value
                    ? `${toneClass(option.tone)} ring-2 ring-offset-1`
                    : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        );
      } else {
        controle = (
          <select {...commun} className="input-premium" value={value ?? ''}>
            {/* L'entrée vide n'est proposée que si le champ est facultatif :
                l'offrir sur un champ obligatoire laisserait choisir « rien »
                pour se faire refuser à l'envoi. */}
            {!field.required && <option value="">Sélectionner…</option>}
            {(field.options || []).map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        );
      }
      break;

    case 'multiselect': {
      const selection = Array.isArray(value) ? value : [];
      controle = (
        <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`champ-${field.name}`}>
          {(field.options || []).map((option) => {
            const actif = selection.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={actif}
                onClick={() => onChange(
                  field.name,
                  actif ? selection.filter((v) => v !== option.value) : [...selection, option.value]
                )}
                className={`px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                  actif
                    ? 'bg-docuflow-secondary text-white'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      );
      break;
    }

    case 'user':
      controle = (
        <select {...commun} className="input-premium" value={value ?? ''}>
          {!field.required && <option value="">Sélectionner…</option>}
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.full_name || u.username}</option>
          ))}
        </select>
      );
      break;

    default:
      controle = (
        <div className="relative">
          <Icone size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            {...commun}
            type="text"
            className="input-premium pl-12"
            value={value ?? ''}
            placeholder={field.placeholder || ''}
            minLength={field.min_length ?? undefined}
            maxLength={field.max_length ?? undefined}
            // Le motif de validation défini par l'administrateur est appliqué par
            // le navigateur AVANT l'envoi : le refus arrive à côté du champ fautif
            // plutôt qu'en bandeau d'erreur après un aller-retour réseau. Le
            // serveur le revérifie — c'est lui qui fait autorité.
            pattern={field.pattern || undefined}
          />
        </div>
      );
  }

  return (
    <div className={`space-y-1.5 ${pleineLargeur ? 'sm:col-span-2' : ''}`}>
      {label}
      {controle}
      {description}
    </div>
  );
};

export default DynamicRequestField;
