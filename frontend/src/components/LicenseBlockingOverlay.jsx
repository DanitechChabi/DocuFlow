import React, { useState } from 'react';
import { AlertTriangle, CreditCard, Mail, MessageCircle, Lock, RefreshCw, KeyRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLicense } from '../contexts/LicenseContext';

// Un client bloqué doit avoir un MOYEN DE SORTIE sur cet écran, sinon la
// boucle est sans issue : il paie via le lien externe, revient… et rien ne se
// passe — ni re-vérification, ni accès à l'écran d'activation. Il ne restait
// que le redémarrage de l'application, que rien n'indique. D'où les deux
// actions ci-dessous : « Revérifier » (le paiement vient peut-être d'être
// enregistré côté serveur) et l'accès direct à /license (activation d'une
// nouvelle clé, empreinte machine, support).
const LicenseBlockingOverlay = ({ message }) => {
  const license = useLicense();
  const [verifie, setVerifie] = useState(false);

  const reverifier = async () => {
    setVerifie(true);
    try {
      // force : interroge le serveur de licence sans attendre la marge de
      // fraîcheur de l'artefact — c'est le geste « je viens de payer ».
      await license.check(true);
    } catch {
      // Le contexte garde son état ; l'utilisateur peut réessayer. Une erreur
      // de transport ne doit pas transformer ce bouton en écran d'erreur.
    } finally {
      setVerifie(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md animate-fade-in">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-scale-in border border-slate-200">
        <div className="bg-red-50 p-8 text-center border-b border-red-100">
          <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <Lock size={32} />
          </div>
          <h2 className="text-2xl font-black text-slate-900 mb-2">Licence Expirée ou Absente</h2>
          <p className="text-slate-600 leading-relaxed">
            {message || "L'accès aux services de DocuFlow est temporairement suspendu. Veuillez renouveler votre licence pour continuer à utiliser l'application."}
          </p>
        </div>

        <div className="p-8 space-y-6">
          <div className="space-y-3">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest text-center mb-4">Options de renouvellement</p>

            <a
              href="https://getdocuflow.vercel.app/tarifs"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 p-4 bg-docuflow-secondary text-white rounded-2xl font-bold hover:bg-blue-700 transition-all shadow-lg hover:shadow-blue-200 group"
            >
              <CreditCard size={20} className="group-hover:scale-110 transition-transform" />
              <span>Voir les tarifs et renouveler</span>
              <div className="ml-auto opacity-50 group-hover:opacity-100 transition-opacity">
                <span className="text-lg">→</span>
              </div>
            </a>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={reverifier}
                disabled={verifie}
                className="flex items-center gap-3 p-4 bg-slate-50 text-slate-700 rounded-2xl font-semibold hover:bg-slate-100 transition-all border border-slate-200 disabled:opacity-60"
              >
                <RefreshCw size={20} className={`text-blue-500 ${verifie ? 'animate-spin' : ''}`} />
                <span>{verifie ? 'Vérification…' : 'Revérifier maintenant'}</span>
              </button>
              <Link
                to="/license"
                className="flex items-center gap-3 p-4 bg-slate-50 text-slate-700 rounded-2xl font-semibold hover:bg-slate-100 transition-all border border-slate-200"
              >
                <KeyRound size={20} className="text-amber-500" />
                <span>Écran d'activation</span>
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <a
                href="https://wa.me/2290153736265"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-4 bg-slate-50 text-slate-700 rounded-2xl font-semibold hover:bg-slate-100 transition-all border border-slate-200"
              >
                <MessageCircle size={20} className="text-green-500" />
                <span>WhatsApp</span>
              </a>
              <a
                href="mailto:chabidaniel093@gmail.com"
                className="flex items-center gap-3 p-4 bg-slate-50 text-slate-700 rounded-2xl font-semibold hover:bg-slate-100 transition-all border border-slate-200"
              >
                <Mail size={20} className="text-blue-500" />
                <span>Email</span>
              </a>
            </div>
          </div>

          <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 flex items-start gap-3">
            <AlertTriangle size={18} className="text-amber-600 mt-0.5 flex-shrink-0" />
            <p className="text-[11px] text-amber-700 leading-relaxed">
              L'accès aux documents et aux fonctions d'indexation est bloqué jusqu'à l'activation d'une clé de licence valide.
              Après règlement, utilisez « Revérifier maintenant » ou l'écran d'activation avec la clé reçue par e-mail.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LicenseBlockingOverlay;
