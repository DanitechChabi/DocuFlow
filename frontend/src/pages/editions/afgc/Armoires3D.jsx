import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, X, MapPin } from 'lucide-react';

// ============================================================================
// Le couloir des armoires, en 3D (CSS 3D, sans bibliothèque) : chaque armoire
// métallique à deux portes, ses étagères et, dedans, un classeur par semaine
// de production qu'elle contient — dans l'ordre du rangement, de haut en bas,
// de gauche à droite. Un clic ouvre les portes ; un dossier recherché ouvre
// son armoire et allume le classeur de sa semaine.
// Le nombre d'étagères se règle (ETAGERES) pour coller aux armoires réelles.
// Les mouvements sont coupés si le système demande moins d'animations.
// ============================================================================

export const ETAGERES = 4;
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

const jour = (iso) => new Date(`${iso}T12:00:00Z`);
const plus = (iso, n) => { const d = jour(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const court = (iso) => { const d = jour(iso); return `${d.getUTCDate()} ${MOIS[d.getUTCMonth()]}`; };

/** Les semaines (vendredis) d'une armoire, avec les lettres aux bornes. */
export function semainesDe(a) {
  const res = [];
  for (let s = a.debut_semaine, i = 0; s <= a.fin_semaine && i < 200; s = plus(s, 7), i += 1) {
    const premiere = s === a.debut_semaine;
    const derniere = s === a.fin_semaine;
    const de = premiere && a.debut_lettre ? a.debut_lettre : 'A';
    const a2 = derniere && a.fin_lettre ? a.fin_lettre : 'Z';
    res.push({ semaine: s, au: plus(s, 6), lettres: de === 'A' && a2 === 'Z' ? null : `${de}–${a2}` });
  }
  return res;
}

/** Les classeurs répartis sur les étagères, dans l'ordre. */
function rayons(semaines) {
  // Au moins deux classeurs par étagère : une semaine de production remplit un bon pan d'étagère.
  const parEtagere = Math.max(2, Math.ceil(semaines.length / ETAGERES));
  return Array.from({ length: ETAGERES }, (_, k) => semaines.slice(k * parEtagere, (k + 1) * parEtagere));
}

const numero = (nom) => (String(nom).match(/\d+/) || [String(nom).slice(0, 2)])[0];

const Armoire = ({ a, ouverte, eclairee, semaineVisee, onClick, delai }) => {
  const etageres = useMemo(() => rayons(semainesDe(a)), [a]);
  return (
    <button type="button" onClick={onClick}
      className={`a3d-socle ${ouverte ? 'a3d-ouverte' : ''} ${eclairee ? 'a3d-eclairee' : ''}`}
      style={{ '--delai': `${delai}s` }}
      aria-label={`${a.nom}${a.lieu ? `, ${a.lieu}` : ''} : ${ouverte ? 'fermer' : 'ouvrir'}`} aria-pressed={ouverte}>
      <div className="a3d">
        {/* Intérieur : fond, étagères, classeurs */}
        <div className="a3d-face a3d-fond">
          {etageres.map((rayon, k) => (
            <div key={k} className="a3d-etagere">
              {rayon.map((s, i) => (
                <span key={s.semaine} className={`a3d-classeur ${semaineVisee === s.semaine ? 'a3d-classeur-vise' : ''}`}
                  style={{ '--i': i + k * 3 }} title={`Semaine du ${court(s.semaine)} au ${court(s.au)}${s.lettres ? ` — lettres ${s.lettres}` : ''}`}>
                  <span className="a3d-classeur-texte">{court(s.semaine)}</span>
                </span>
              ))}
            </div>
          ))}
        </div>
        <div className="a3d-face a3d-gauche" />
        <div className="a3d-face a3d-droite" />
        <div className="a3d-face a3d-dessus" />
        <div className="a3d-face a3d-dessous" />
        {/* Portes : charnières aux bords, poignées au centre */}
        <div className="a3d-porte a3d-porte-g"><span className="a3d-poignee" /><span className="a3d-aeration" /></div>
        <div className="a3d-porte a3d-porte-d"><span className="a3d-poignee" /><span className="a3d-aeration" /></div>
        <div className="a3d-plaque">{numero(a.nom)}</div>
        <div className="a3d-plinthe" />
      </div>
      <div className="a3d-ombre" />
    </button>
  );
};

/**
 * Le couloir : toutes les armoires du plan, dans l'ordre. `cible` (nom de
 * l'armoire, semaine) ouvre l'armoire d'un dossier recherché.
 */
const Armoires3D = ({ armoires, cible = null, onFermerCible }) => {
  const [ouverte, setOuverte] = useState(null);
  const scene = useRef(null);
  useEffect(() => {
    if (!cible) return;
    const a = armoires.find((x) => x.nom.toLowerCase() === String(cible.nom).toLowerCase());
    if (!a) return;
    setOuverte(a.id);
    // Amène l'armoire au centre du couloir.
    setTimeout(() => scene.current?.querySelector(`[data-armoire="${a.id}"]`)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }), 200);
  }, [cible, armoires]);

  const choisie = armoires.find((a) => a.id === ouverte);
  const lieu = [...new Set(armoires.map((a) => a.lieu).filter(Boolean))].join(' · ');
  return (
    <div className="rounded-3xl overflow-hidden border-2 border-slate-200 bg-gradient-to-b from-slate-100 to-slate-200 mb-4">
      <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
        <MapPin size={16} className="text-violet-600" />
        <span className="text-sm font-black text-slate-800">{lieu || 'Couloir des archives'}</span>
        <span className="text-sm font-semibold text-slate-600">— cliquez une armoire pour l'ouvrir</span>
        {cible && (
          <span className="ml-auto inline-flex items-center gap-2 rounded-xl bg-green-600 text-white px-3 py-1.5 text-sm font-black">
            Dossier recherché : {cible.nom}{cible.semaine ? `, classeur du ${court(cible.semaine)}` : ''}
            <button type="button" onClick={onFermerCible} className="p-0.5 rounded hover:bg-white/20" aria-label="Fermer"><X size={14} /></button>
          </span>
        )}
      </div>
      <div ref={scene} className="couloir overflow-x-auto">
        <div className="couloir-scene">
          {armoires.map((a, i) => (
            <div key={a.id} data-armoire={a.id} className="couloir-place">
              <Armoire a={a} delai={Math.min(i, 10) * 0.08}
                ouverte={ouverte === a.id} eclairee={cible && cible.nom.toLowerCase() === a.nom.toLowerCase()}
                semaineVisee={cible && cible.nom.toLowerCase() === a.nom.toLowerCase() ? cible.semaine : null}
                onClick={() => setOuverte((o) => (o === a.id ? null : a.id))} />
              <div className="couloir-etiquette">{a.nom}</div>
            </div>
          ))}
        </div>
        <div className="couloir-sol" />
      </div>
      {choisie && (
        <div className="bg-white border-t-2 border-slate-200 px-5 py-4 animate-fade-in-up">
          <div className="flex items-center gap-2">
            <Archive size={18} className="text-violet-600" />
            <span className="text-base font-black text-slate-900">{choisie.nom}</span>
            {choisie.lieu && <span className="text-sm font-semibold text-slate-600">· {choisie.lieu}</span>}
            <span className="ml-auto text-sm font-bold text-slate-600">{semainesDe(choisie).length} semaine{semainesDe(choisie).length > 1 ? 's' : ''}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {semainesDe(choisie).map((s) => (
              <span key={s.semaine} className={`rounded-lg border px-2 py-1 text-xs font-bold ${cible?.semaine === s.semaine && cible?.nom?.toLowerCase() === choisie.nom.toLowerCase() ? 'bg-green-600 border-green-600 text-white' : 'bg-slate-50 border-slate-200 text-slate-700'}`}>
                {court(s.semaine)} → {court(s.au)}{s.lettres ? ` · ${s.lettres}` : ''}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default Armoires3D;
